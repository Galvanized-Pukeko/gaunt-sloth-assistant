/**
 * [[EXT-174]] — **the AG-UI server compacts and retries once on a context overflow, through the same
 * seam every other surface uses, and tells the browser where the fold happened.**
 *
 * Every cell here runs the REAL server: `startAgUiServer` bound to an OS-chosen port, a real
 * `GthLangChainAgent` built with the agent package's real `createResolvers()`, a real `MemorySaver`,
 * and a real graph — driven over HTTP exactly as a browser drives it, with the SSE the encoder wrote
 * read back off the socket. The one thing scripted is the model, and it overflows the way a provider
 * does: by throwing `@langchain/core`'s own `ContextOverflowError` out of a turn call, so the failure
 * reaches the seam through the same classification a live provider's would. A sentinel that
 * bypassed classification would prove the retry wiring and nothing about whether a real overflow
 * reaches it.
 *
 * The measurement is `requests[]` — what the model actually received on each attempt. A smaller
 * retry is the point of the recovery, so it is asserted as a number (messages AND characters), never
 * as "a compaction happened": a retry that resends the same messages is an infinite loop with extra
 * steps.
 *
 * Both resume paths get their own cells, not only the fresh turn. A resumed conversation is by
 * definition not short, so an overflow on resume is at least as likely as one on a fresh turn — and
 * the retry after a resume is the case with something to get wrong: the client's value has already
 * been delivered to the suspended tool by the time the model throws, so the retry has to continue
 * from that state rather than resume again or resend the history.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatGenerationChunk } from '@langchain/core/outputs';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import { ContextOverflowError } from '@langchain/core/errors';
import type { GthConfig } from '@gaunt-sloth/core/config.js';
import { conversationSize, isCompactionSummary } from '@gaunt-sloth/core/core/compaction.js';

// The server's banners and warnings go nowhere; the seam's status channel is read through
// `defaultStatusCallback`, which is what the server hands the seam.
const consoleUtilsMock = {
  display: vi.fn(),
  displayInfo: vi.fn(),
  displayWarning: vi.fn(),
  displayError: vi.fn(),
  displaySuccess: vi.fn(),
  displayDebug: vi.fn(),
  defaultStatusCallback: vi.fn(),
};
vi.mock('@gaunt-sloth/core/utils/consoleUtils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@gaunt-sloth/core/utils/consoleUtils.js')>();
  return { ...actual, ...consoleUtilsMock };
});

/**
 * The delegation pin. The shared retry loop is wrapped so a cell can see that the server reached
 * it — a copy of the loop written into the server would pass every other cell here and fail this
 * one — and `beforeEach` makes the wrapper call through, so every cell still drives the REAL seam.
 */
type SeamModule = typeof import('@gaunt-sloth/core/core/contextOverflowSeam.js');
const seamActual = vi.hoisted(() => ({ current: undefined as SeamModule | undefined }));
const retryEventTurnOnContextOverflowMock = vi.fn();
vi.mock('@gaunt-sloth/core/core/contextOverflowSeam.js', async (importOriginal) => {
  const actual = await importOriginal<SeamModule>();
  seamActual.current = actual;
  return { ...actual, retryEventTurnOnContextOverflow: retryEventTurnOnContextOverflowMock };
});

/** The client tool the resume cells suspend on, and the call id the model gives it. */
const CLIENT_TOOL = 'capture';
const CLIENT_CALL_ID = 'call-capture-1';
const RESUME_VALUE = 'photo-bytes-from-the-browser';

/**
 * A model that can be told to overflow, and to call a client tool. `requests` records the messages
 * of every TURN call as the model received them — recorded BEFORE the overflow decision, so a failed
 * attempt's prompt is measurable too. Summary calls are recognised by the compaction prompt's opening
 * `<role>` block and counted separately: "exactly one compaction" is an assertion about that counter.
 */
class ScriptedOverflowModel extends BaseChatModel {
  requests: BaseMessage[][] = [];
  summaryCalls = 0;
  /** How many of the NEXT turn calls throw a context overflow. */
  overflowsRemaining = 0;
  /** Whether the next turn call that carries no result for the client tool should call it. */
  callClientToolOnce = false;

  constructor() {
    super({});
  }
  _llmType(): string {
    return 'scripted';
  }
  bindTools(): this {
    return this;
  }
  async _generate(messages: BaseMessage[]) {
    const last = messages[messages.length - 1];
    const lastText = typeof last?.content === 'string' ? last.content : '';
    if (HumanMessage.isInstance(last) && lastText.startsWith('<role>')) {
      this.summaryCalls++;
      return { generations: [{ message: new AIMessage('SUMMARY'), text: 'SUMMARY' }] };
    }
    this.requests.push(messages);
    if (this.overflowsRemaining > 0) {
      this.overflowsRemaining--;
      throw new ContextOverflowError("This model's maximum context length is 100 tokens.");
    }
    const clientResultPresent = messages.some(
      (m) => ToolMessage.isInstance(m) && m.tool_call_id === CLIENT_CALL_ID
    );
    if (this.callClientToolOnce && !clientResultPresent) {
      this.callClientToolOnce = false;
      return {
        generations: [
          {
            message: new AIMessage({
              content: '',
              tool_calls: [{ name: CLIENT_TOOL, args: {}, id: CLIENT_CALL_ID }],
            }),
            text: '',
          },
        ],
      };
    }
    const lastHuman = [...messages].reverse().find((m) => HumanMessage.isInstance(m));
    const ask = typeof lastHuman?.content === 'string' ? lastHuman.content : '';
    const message = new AIMessage(`answer: ${ask.slice(0, 12)}`);
    return { generations: [{ message, text: message.content as string }] };
  }
}

/**
 * A model that streams PART of an answer and then overflows — a provider failing mid-stream, which
 * is the one way a fold can arrive while the server has a text run or a reasoning message open on
 * the wire. Turn calls stream through `_streamResponseChunks`, because the graph's messages mode
 * asks the model for tokens; the summary is a plain `invoke` and still lands in `_generate`, as
 * does every non-overflowing turn call, so the rest of the script is inherited unchanged.
 */
class MidStreamOverflowModel extends ScriptedOverflowModel {
  /** What is streamed before the overflow — answer text, or an unterminated `<think>` block. */
  partial = 'partial ';
  async *_streamResponseChunks(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun
  ): AsyncGenerator<ChatGenerationChunk> {
    if (this.overflowsRemaining > 0) {
      this.overflowsRemaining--;
      this.requests.push(messages);
      yield new ChatGenerationChunk({
        message: new AIMessageChunk({ content: this.partial }),
        text: this.partial,
      });
      await runManager?.handleLLMNewToken(this.partial);
      throw new ContextOverflowError("This model's maximum context length is 100 tokens.");
    }
    const result = await this._generate(messages);
    const text = String(result.generations[0].message.content);
    yield new ChatGenerationChunk({ message: new AIMessageChunk({ content: text }), text });
    await runManager?.handleLLMNewToken(text);
  }
}

/** Config as the `api` command hands it to the server: a real agent, no tools beyond the run's. */
function serverConfig(model: BaseChatModel): GthConfig {
  return {
    llm: model,
    modelProviderType: 'openai',
    streamOutput: true,
    contentSource: 'file',
    requirementSource: 'file',
    filesystem: 'none',
    useColour: false,
    writeOutputToFile: false,
    writeBinaryOutputsToFile: false,
    streamSessionInferenceLog: false,
    canInterruptInferenceWithEsc: false,
    includeCurrentDateAfterGuidelines: false,
    injectModelContext: false,
    noDefaultPrompts: true,
  } as unknown as GthConfig;
}

/** Long enough that folding it is measurable in characters as well as in message count. */
const PADDING = ' ' + 'x'.repeat(400);

type WireMessage = {
  id: string;
  role: string;
  content?: string;
  toolCalls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  toolCallId?: string;
};

/** Five exchanges, so the history is comfortably longer than the kept tail. */
function longHistory(): WireMessage[] {
  const out: WireMessage[] = [];
  ['one', 'two', 'three', 'four', 'five'].forEach((text, i) => {
    out.push({ id: `u${i}`, role: 'user', content: text + PADDING });
    out.push({ id: `a${i}`, role: 'assistant', content: `answer: ${text}` + PADDING });
  });
  return out;
}

const SIX: WireMessage = { id: 'u6', role: 'user', content: 'SIX' + PADDING };

/** The client tool as CopilotKit's `useFrontendTool` declares it on the run input. */
const CLIENT_TOOLS = [
  {
    name: CLIENT_TOOL,
    description: 'Take a photo.',
    parameters: { type: 'object', properties: {} },
  },
];

/** The history a client holds after fulfilling the client tool: the call, then its result. */
function historyAfterClientTool(): WireMessage[] {
  return [
    ...longHistory(),
    SIX,
    {
      id: 'a6',
      role: 'assistant',
      content: '',
      toolCalls: [
        { id: CLIENT_CALL_ID, type: 'function', function: { name: CLIENT_TOOL, arguments: '{}' } },
      ],
    },
    { id: 't6', role: 'tool', toolCallId: CLIENT_CALL_ID, content: RESUME_VALUE },
  ];
}

type AgUiEvent = { type: string } & Record<string, unknown>;

/** POST a run and read every SSE event the server wrote, in order. */
async function postRun(port: number, body: Record<string, unknown>): Promise<AgUiEvent[]> {
  const res = await fetch(`http://127.0.0.1:${port}/agents/gth/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice('data: '.length)) as AgUiEvent);
}

const typesOf = (events: AgUiEvent[]): string[] => events.map((e) => e.type);
const indexOfType = (events: AgUiEvent[], type: string): number =>
  events.findIndex((e) => e.type === type);
const folds = (events: AgUiEvent[]): AgUiEvent[] =>
  events.filter((e) => e.type === 'CUSTOM' && e.name === 'context_compacted');
const answerText = (events: AgUiEvent[]): string =>
  events
    .filter((e) => e.type === 'TEXT_MESSAGE_CONTENT')
    .map((e) => String(e.delta))
    .join('');
const withoutSystem = (request: BaseMessage[]): BaseMessage[] =>
  request.filter((m) => !SystemMessage.isInstance(m));
const noticesFrom = (): string[] =>
  consoleUtilsMock.defaultStatusCallback.mock.calls.map((call) => String(call[1] ?? ''));

describe('[[EXT-174]] the AG-UI server compacts, announces the fold on the wire, and retries once', () => {
  let server: Server | undefined;
  let port = 0;
  let model: ScriptedOverflowModel;

  beforeEach(async () => {
    vi.resetAllMocks();
    // The pin calls through: a reset strips the implementation, so it is re-applied here and every
    // cell below drives the real loop. The import runs the mock factory, which is what captures
    // the real module — the factory is lazy, so nothing has captured it before the first import.
    await import('@gaunt-sloth/core/core/contextOverflowSeam.js');
    retryEventTurnOnContextOverflowMock.mockImplementation(
      seamActual.current!.retryEventTurnOnContextOverflow
    );
    model = new ScriptedOverflowModel();
    const { startAgUiServer } = await import('#src/modules/apiAgUiModule.js');
    server = await startAgUiServer(serverConfig(model), 0, '127.0.0.1');
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    const closing = server;
    server = undefined;
    if (closing) await new Promise<void>((resolve) => closing.close(() => resolve()));
  });

  /**
   * What every recovered run must satisfy, whichever way the turn started: the numbers are the real
   * ones, the fold is announced once and before the answer, the retry is smaller and continues the
   * same turn, and the run ends as a success.
   */
  function expectRecoveredRun(events: AgUiEvent[], failedAt: number) {
    expect(typesOf(events)[0]).toBe('RUN_STARTED');
    expect(typesOf(events).at(-1)).toBe('RUN_FINISHED');
    expect(indexOfType(events, 'RUN_ERROR')).toBe(-1);

    // Exactly two turn attempts from the overflow on, and exactly one compaction between them.
    expect(model.requests.length).toBe(failedAt + 2);
    expect(model.summaryCalls).toBe(1);
    const failed = conversationSize(model.requests[failedAt]);
    const retried = conversationSize(model.requests[failedAt + 1]);
    expect(retried.messages).toBeLessThan(failed.messages);
    expect(retried.characters).toBeLessThan(failed.characters);

    // One fold, on the wire as a CUSTOM event, announced BEFORE the answer's text message.
    const announced = folds(events);
    expect(announced).toHaveLength(1);
    expect(events.indexOf(announced[0])).toBeLessThan(indexOfType(events, 'TEXT_MESSAGE_START'));
    const value = announced[0].value as {
      cause: string;
      compaction: { changed: boolean; removedCount: number; before: unknown; after: unknown };
      notice: { title: string; lines: string[]; tone: string };
    };
    expect(value.cause).toBe('context_overflow');
    expect(value.compaction.changed).toBe(true);
    expect(value.compaction.removedCount).toBeGreaterThan(0);
    // The numbers on the event are the numbers the model was actually sent: `before` is the prompt
    // that overflowed and `after` the prompt that answered, each measured off the model's own
    // record. The request carries the static system prompt in front, which the graph state the
    // event was read from does not, so that one message is dropped on both sides — and nothing
    // else.
    expect(value.compaction.before).toEqual(
      conversationSize(withoutSystem(model.requests[failedAt]))
    );
    expect(value.compaction.after).toEqual(
      conversationSize(withoutSystem(model.requests[failedAt + 1]))
    );
    // The rendered notice rides along, so a client can show the sentence without inventing one.
    expect(value.notice.title).toMatch(/context overflowed/i);
    expect(value.notice.lines.join(' ')).toMatch(/folded into a summary/i);
    expect(value.notice.tone).toBe('warn');

    // The retry's prompt is the compacted one: a summary at its head, and the user's pending turn
    // present exactly once — a re-send rather than a continuation would have duplicated it.
    const retryRequest = model.requests[failedAt + 1];
    expect(retryRequest.some((m) => isCompactionSummary(m))).toBe(true);
    expect(
      retryRequest.filter((m) => HumanMessage.isInstance(m) && String(m.content).startsWith('SIX'))
    ).toHaveLength(1);

    // The answer arrived as ordinary text events, and the status channel carried the one line.
    expect(answerText(events)).toContain('answer:');
    expect(noticesFrom().some((n) => /context overflowed.*folded into a summary/i.test(n))).toBe(
      true
    );
  }

  it('recovers a fresh turn: retries with a measurably smaller prompt, announces the fold before the answer, and answers', async () => {
    model.overflowsRemaining = 1;
    const events = await postRun(port, {
      threadId: 'thread-fresh',
      runId: 'run-1',
      messages: [...longHistory(), SIX],
    });

    expectRecoveredRun(events, 0);
    expect(answerText(events)).toContain('answer: SIX');
    expect(String(model.requests[1].at(-1)?.content)).toContain('SIX');
  });

  it('reaches the shared seam rather than a loop of its own, with this request as the host', async () => {
    model.overflowsRemaining = 1;
    await postRun(port, {
      threadId: 'thread-pin',
      runId: 'run-1',
      messages: [...longHistory(), SIX],
    });

    expect(retryEventTurnOnContextOverflowMock).toHaveBeenCalledTimes(1);
    const [attemptTurn, host] = retryEventTurnOnContextOverflowMock.mock.calls[0] as [
      unknown,
      { agent: unknown; runConfig: unknown; model: unknown; statusUpdate: unknown },
    ];
    expect(typeof attemptTurn).toBe('function');
    // The seam is handed THIS run's thread and THIS server's model, so what it folds is the
    // conversation that overflowed — the same `thread_id` the agent was driven with.
    expect(host.model).toBe(model);
    expect(host.runConfig).toEqual(
      expect.objectContaining({
        configurable: expect.objectContaining({ thread_id: expect.any(String) }),
      })
    );
    expect(host.agent).toEqual(expect.objectContaining({ streamWithEvents: expect.any(Function) }));
    expect(host.statusUpdate).toBe(consoleUtilsMock.defaultStatusCallback);
  });

  /**
   * The two resume shapes the handler accepts, each driving `streamWithEventsResume`: the explicit
   * `forwardedProps.command.resume`, and CopilotKit's re-run with the tool result trailing the
   * history. The first run suspends the graph on the client tool; the second resumes it, the model
   * overflows on the resumed turn, and the retry must continue from the delivered result.
   */
  const resumeShapes: Array<[string, (history: WireMessage[]) => Record<string, unknown>]> = [
    [
      'forwardedProps.command.resume',
      (messages) => ({ messages, forwardedProps: { command: { resume: RESUME_VALUE } } }),
    ],
    ['a trailing tool message (the CopilotKit shape)', (messages) => ({ messages })],
  ];

  for (const [shape, resumeBody] of resumeShapes) {
    it(`recovers an overflow on a RESUME (${shape}): the client's result is what the retry continues from`, async () => {
      // Run 1: the model calls the client tool, the graph suspends for the browser, the run ends
      // with the call announced and no result.
      model.callClientToolOnce = true;
      const first = await postRun(port, {
        threadId: 'thread-resume',
        runId: 'run-1',
        messages: [...longHistory(), SIX],
        tools: CLIENT_TOOLS,
      });
      expect(typesOf(first).at(-1)).toBe('RUN_FINISHED');
      expect(
        first.filter((e) => e.type === 'TOOL_CALL_START' && e.toolCallName === CLIENT_TOOL)
      ).toHaveLength(1);
      expect(indexOfType(first, 'TOOL_CALL_RESULT')).toBe(-1);
      expect(model.requests).toHaveLength(1);

      // Run 2: the browser fulfilled the tool and resumes. The resumed turn overflows.
      model.overflowsRemaining = 1;
      const events = await postRun(port, {
        threadId: 'thread-resume',
        runId: 'run-2',
        tools: CLIENT_TOOLS,
        ...resumeBody(historyAfterClientTool()),
      });

      expectRecoveredRun(events, 1);

      // The prompt that overflowed already carried the client's result — the resume was delivered
      // to the suspended tool before the model threw — and so does the retry: it CONTINUED from
      // that state rather than resuming again or re-sending the history.
      const deliveredTo = (request: BaseMessage[]) =>
        request.some(
          (m) =>
            ToolMessage.isInstance(m) &&
            m.tool_call_id === CLIENT_CALL_ID &&
            String(m.content) === RESUME_VALUE
        );
      expect(deliveredTo(model.requests[1])).toBe(true);
      expect(deliveredTo(model.requests[2])).toBe(true);
      // The client tool was called once across both runs, and nothing in the resumed run replayed
      // it: no second call to the browser, and no echo of the result the browser itself supplied.
      expect(events.filter((e) => e.type === 'TOOL_CALL_START')).toHaveLength(0);
      expect(
        events.filter((e) => e.type === 'TOOL_CALL_RESULT' && e.toolCallId === CLIENT_CALL_ID)
      ).toHaveLength(0);
    });
  }

  it('ends the run on a SECOND overflow with the stated reason — one fold, one retry, no loop', async () => {
    model.overflowsRemaining = 2;
    const events = await postRun(port, {
      threadId: 'thread-twice',
      runId: 'run-1',
      messages: [...longHistory(), SIX],
    });

    // Two attempts and no third; one compaction, not two.
    expect(model.requests.length).toBe(2);
    expect(model.summaryCalls).toBe(1);

    // The browser was told about the one fold that happened, was never handed an answer, and the
    // run ended as an error carrying the seam's own reason in the protocol's `code` field — the
    // exhausted site, not the site that first classified the throw.
    expect(folds(events)).toHaveLength(1);
    expect(indexOfType(events, 'TEXT_MESSAGE_START')).toBe(-1);
    expect(indexOfType(events, 'RUN_FINISHED')).toBe(-1);
    const error = events.find((e) => e.type === 'RUN_ERROR');
    expect(error).toBeDefined();
    expect(error?.code).toBe('context_overflow@runner.overflow-compact-exhausted');
    expect(String(error?.message)).toMatch(/maximum context length/);
    expect(noticesFrom().some((n) => /overflowed again after compacting/i.test(n))).toBe(true);
  });

  it('announces nothing when there is nothing left to fold, and ends the run at that site', async () => {
    // No history: the pending turn alone is shorter than the kept tail, so the mechanism reports
    // `changed: false` and there is no smaller prompt to retry with.
    model.overflowsRemaining = 1;
    const events = await postRun(port, {
      threadId: 'thread-short',
      runId: 'run-1',
      messages: [SIX],
    });

    expect(model.requests.length).toBe(1);
    expect(model.summaryCalls).toBe(0);
    expect(folds(events)).toHaveLength(0);
    const error = events.find((e) => e.type === 'RUN_ERROR');
    expect(error?.code).toBe('context_overflow@runner.overflow-compact');
  });

  /**
   * A fold that arrives with a message still open on the wire closes it first. The client's
   * verifier rejects a `TEXT_MESSAGE_START` while another text message is in progress, and the
   * answer the retry produces is a NEW message rather than an append to the one the client holds —
   * so the open text run (or reasoning message) must END before the `CUSTOM` event, and the answer
   * must start a message of its own after it.
   */
  const openMessages: Array<[string, string, string, string]> = [
    ['a text run', 'partial ', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_END'],
    ['a reasoning message', '<think>hmm', 'REASONING_MESSAGE_START', 'REASONING_MESSAGE_END'],
  ];

  for (const [what, partial, startType, endType] of openMessages) {
    it(`closes ${what} left open by the failed attempt before announcing the fold`, async () => {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      const streaming = new MidStreamOverflowModel();
      streaming.partial = partial;
      model = streaming;
      const { startAgUiServer } = await import('#src/modules/apiAgUiModule.js');
      server = await startAgUiServer(serverConfig(streaming), 0, '127.0.0.1');
      port = (server.address() as AddressInfo).port;

      streaming.overflowsRemaining = 1;
      const events = await postRun(port, {
        threadId: 'thread-midstream',
        runId: 'run-1',
        messages: [...longHistory(), SIX],
      });

      // The run recovered, with the same budget: two attempts, one compaction, a smaller retry.
      expect(typesOf(events).at(-1)).toBe('RUN_FINISHED');
      expect(streaming.requests.length).toBe(2);
      expect(streaming.summaryCalls).toBe(1);
      expect(conversationSize(streaming.requests[1]).characters).toBeLessThan(
        conversationSize(streaming.requests[0]).characters
      );

      // The partial reached the wire and was open when the overflow arrived …
      const foldAt = events.indexOf(folds(events)[0]);
      expect(foldAt).toBeGreaterThan(0);
      const opened = events.findIndex((e) => e.type === startType);
      expect(opened).toBeGreaterThanOrEqual(0);
      expect(opened).toBeLessThan(foldAt);
      // … and was closed BEFORE the fold was announced, with the id it was opened under.
      const openedId = events[opened].messageId;
      const closed = events.findIndex((e) => e.type === endType && e.messageId === openedId);
      expect(closed).toBeGreaterThan(opened);
      expect(closed).toBeLessThan(foldAt);
      // The answer is a new text message after the fold, not an append to the closed one.
      const answerStart = events.findLastIndex((e) => e.type === 'TEXT_MESSAGE_START');
      expect(answerStart).toBeGreaterThan(foldAt);
      expect(events[answerStart].messageId).not.toBe(openedId);
      expect(answerText(events)).toContain('answer: SIX');
    });
  }

  it('leaves a failure that is NOT an overflow entirely alone — the control that must survive', async () => {
    // Without this, a seam that compacted on every thrown error would pass every cell above.
    vi.spyOn(model, '_generate').mockRejectedValueOnce(new Error('the provider is on fire'));
    const events = await postRun(port, {
      threadId: 'thread-fire',
      runId: 'run-1',
      messages: [...longHistory(), SIX],
    });

    expect(model.summaryCalls).toBe(0);
    expect(folds(events)).toHaveLength(0);
    const error = events.find((e) => e.type === 'RUN_ERROR');
    expect(String(error?.message)).toMatch(/on fire/);
    expect(error?.code ?? '').not.toMatch(/context_overflow/);
  });
});
