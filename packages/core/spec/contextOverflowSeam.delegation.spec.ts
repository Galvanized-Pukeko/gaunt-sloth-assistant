/**
 * [[EXT-174]] — **the runner's overflow recovery IS the shared seam module, on both drivers.**
 *
 * The decision and the retry loop moved out of `GthAgentRunner` so the AG-UI server could reach
 * them without being driven through the runner. What keeps that from quietly becoming two
 * implementations again is this file: each driver's overflow path is proven to reach the module's
 * exported function — a copy of the decision pasted back into the runner would recover the turn
 * exactly as well and fail here. The wrapped functions call through, so the turn still genuinely
 * recovers; a stub that only recorded the call could not tell delegation from a dead path.
 *
 * The behaviour of the seam itself — one retry, the smaller prompt, the stated reason on a second
 * overflow — is pinned in `contextOverflowRetry.spec.ts`, and that the runner's OWN reason field is
 * written by the host hook is pinned there too (`runner.getTerminationReason()` reads the field).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ContextOverflowError } from '@langchain/core/errors';
import { MemorySaver } from '@langchain/langgraph';
import type { GthConfig } from '#src/config.js';
import type { AgentStreamEvent } from '#src/core/types.js';
import { classifyThrownTermination, terminationReasonOf } from '#src/core/terminationReason.js';

vi.mock('#src/utils/consoleUtils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#src/utils/consoleUtils.js')>();
  return {
    ...actual,
    display: vi.fn(),
    displayInfo: vi.fn(),
    displayWarning: vi.fn(),
    displayError: vi.fn(),
    displaySuccess: vi.fn(),
    displayDebug: vi.fn(),
    displayToolIndication: vi.fn(),
  };
});

type SeamModule = typeof import('#src/core/contextOverflowSeam.js');
const seamActual = vi.hoisted(() => ({ current: undefined as SeamModule | undefined }));
const handleContextOverflowMock = vi.fn();
const retryEventTurnOnContextOverflowMock = vi.fn();
vi.mock('#src/core/contextOverflowSeam.js', async (importOriginal) => {
  const actual = await importOriginal<SeamModule>();
  seamActual.current = actual;
  return {
    ...actual,
    handleContextOverflow: handleContextOverflowMock,
    retryEventTurnOnContextOverflow: retryEventTurnOnContextOverflowMock,
  };
});

/** A model that overflows once on demand, throwing the framework's own error type. */
class OverflowingModel extends BaseChatModel {
  requests: BaseMessage[][] = [];
  overflowsRemaining = 0;
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
      return { generations: [{ message: new AIMessage('SUMMARY'), text: 'SUMMARY' }] };
    }
    this.requests.push(messages);
    if (this.overflowsRemaining > 0) {
      this.overflowsRemaining--;
      throw new ContextOverflowError("This model's maximum context length is 100 tokens.");
    }
    const message = new AIMessage('answer: ok');
    return { generations: [{ message, text: 'answer: ok' }] };
  }
}

const BASE_CONFIG = {
  streamOutput: true,
  contentSource: 'file',
  requirementSource: 'file',
  filesystem: 'none',
  useColour: false,
  writeOutputToFile: false,
  writeBinaryOutputsToFile: false,
  streamSessionInferenceLog: false,
  canInterruptInferenceWithEsc: false,
  includeCurrentDateAfterGuidelines: true,
};

const PADDING = ' ' + 'x'.repeat(400);

describe('[[EXT-174]] both runner drivers reach the shared overflow seam', () => {
  let GthAgentRunner: typeof import('#src/core/GthAgentRunner.js').GthAgentRunner;
  const statusUpdate = vi.fn();

  beforeEach(async () => {
    vi.resetAllMocks();
    // Call through: the reset strips the implementations, and a wrapper that did not call the real
    // function would prove a call site and nothing about whether the turn recovers. The import runs
    // the (lazy) mock factory, which is what captures the real module.
    await import('#src/core/contextOverflowSeam.js');
    handleContextOverflowMock.mockImplementation(seamActual.current!.handleContextOverflow);
    retryEventTurnOnContextOverflowMock.mockImplementation(
      seamActual.current!.retryEventTurnOnContextOverflow
    );
    ({ GthAgentRunner } = await import('#src/core/GthAgentRunner.js'));
  });

  const makeRunner = async (model: OverflowingModel) => {
    const runner = new GthAgentRunner(statusUpdate, {
      resolveTools: vi.fn().mockResolvedValue([]),
      resolveMiddleware: async (m: unknown[] | undefined) => m ?? [],
    });
    const config = { ...BASE_CONFIG, llm: model } as unknown as GthConfig;
    await runner.init('chat', config, new MemorySaver());
    return runner;
  };

  const buildHistory = async (runner: InstanceType<typeof GthAgentRunner>) => {
    for (const text of ['one', 'two', 'three', 'four', 'five']) {
      await runner.processMessages([new HumanMessage(text + PADDING)]);
    }
  };

  it('the string driver decides through the module, with the runner as the host, and the turn recovers', async () => {
    const model = new OverflowingModel();
    const runner = await makeRunner(model);
    await buildHistory(runner);
    const turnsBefore = model.requests.length;

    model.overflowsRemaining = 1;
    const answer = await runner.processMessages([new HumanMessage('SIX' + PADDING)]);

    expect(answer).toContain('answer: ok');
    expect(model.requests.length).toBe(turnsBefore + 2);
    expect(handleContextOverflowMock).toHaveBeenCalledTimes(1);
    const [error, attempt, host] = handleContextOverflowMock.mock.calls[0] as [
      unknown,
      number,
      { agent: unknown; runConfig: unknown; model: unknown; statusUpdate: unknown },
    ];
    // What reaches the seam on this driver is the stream wrapper with the reason attached, not the
    // bare provider error — so it is read the way the seam reads it: the attached reason first.
    expect(terminationReasonOf(error)?.category ?? classifyThrownTermination(error).category).toBe(
      'context_overflow'
    );
    expect(attempt).toBe(0);
    expect(host.agent).toBe(runner.getAgent());
    expect(host.runConfig).toBe((runner as unknown as { runConfig: unknown }).runConfig);
    expect(host.model).toBe(model);
    expect(host.statusUpdate).toBe(statusUpdate);
  });

  it('the typed-event driver runs the module loop, with the runner as the host, and the turn recovers', async () => {
    const model = new OverflowingModel();
    const runner = await makeRunner(model);
    await buildHistory(runner);
    const turnsBefore = model.requests.length;

    model.overflowsRemaining = 1;
    const events: AgentStreamEvent[] = [];
    for await (const event of runner.processMessagesWithEvents([
      new HumanMessage('SIX' + PADDING),
    ])) {
      events.push(event);
    }

    expect(events.some((e) => e.type === 'context_compacted')).toBe(true);
    expect(events.some((e) => e.type === 'text' && e.delta.includes('answer: ok'))).toBe(true);
    expect(model.requests.length).toBe(turnsBefore + 2);
    expect(retryEventTurnOnContextOverflowMock).toHaveBeenCalledTimes(1);
    const [attemptTurn, host] = retryEventTurnOnContextOverflowMock.mock.calls[0] as [
      unknown,
      { agent: unknown; runConfig: unknown; model: unknown; statusUpdate: unknown },
    ];
    expect(typeof attemptTurn).toBe('function');
    expect(host.agent).toBe(runner.getAgent());
    expect(host.runConfig).toBe((runner as unknown as { runConfig: unknown }).runConfig);
    expect(host.model).toBe(model);
    expect(host.statusUpdate).toBe(statusUpdate);
  });
});
