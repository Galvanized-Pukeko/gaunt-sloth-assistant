import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIMessageChunk, HumanMessage, ToolMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';

/**
 * [[TUI-C106]] — **the measured cause of the nameless tool rows in
 * [issue #445](https://github.com/pukeko-robotics/gaunt-sloth/issues/445): a turn that crosses a
 * `streamFromInput` boundary.**
 *
 * An approval-gated tool suspends the graph. `stream()` returns with the call announced and its
 * result not yet produced; `GthAgentRunner.resolveToolInterrupts` collects the human's decision and
 * continues the SAME turn through `streamResume()`. The gated call's `ToolMessage` therefore always
 * lands in the second stream. While the plain-surface observer was built per stream, that second
 * observer had never seen the producer message, so the arguments it had already accumulated were
 * thrown away and the row rendered `gth_checklist()`.
 *
 * The split is what makes it diagnosable: an UNGATED tool in the same turn is announced and
 * returns inside one stream, and always named. That is the control this file carries, and it is why
 * the reproduction shows `gth_checklist()` one line above `gth_grep(pattern=EXT-6)`.
 *
 * These cells drive the real agent across the real `stream()` → `streamResume()` pair rather than
 * asserting on the observer alone, because the observer was never wrong: its LIFETIME was.
 *
 * ---
 *
 * **This file also carries [[TUI-C105]]'s labelled residual**, moved here from
 * `toolDisplayPreviewDepth.spec.ts`. That residual was written as a rendering question — a call
 * whose arguments never reached the display layer leaves `toolOutputPreviewLines: 0` with one line
 * that names nothing — and it could not have been closed where it was written, because the cause
 * was upstream of every rendering module. The first cell below is what actually closes it: at any
 * preview depth, the surviving line now carries the arguments, because they are no longer thrown
 * away at the stream boundary.
 */

const consoleUtilsMock = {
  displayInfo: vi.fn(),
  displayToolIndication: vi.fn(),
};
vi.mock('#src/utils/consoleUtils.js', () => consoleUtilsMock);

const systemUtilsMock = {
  waitForEscape: vi.fn(),
  stopWaitingForEscape: vi.fn(),
  getUseColour: vi.fn(() => false),
  stdout: { isTTY: false, write: vi.fn() },
  env: {},
};
vi.mock('#src/utils/systemUtils.js', () => systemUtilsMock);

const runConfig: RunnableConfig = { configurable: { thread_id: 't1' } };

/** The `streamMode: 'messages'` shape the agent consumes: `[message, metadata]` pairs. */
function streamOf(messages: unknown[]) {
  return (async function* () {
    for (const message of messages) yield [message, {}];
  })();
}

/** A gated call, announced in one stream and answered in the next — the shape under test. */
const gatedCallChunk = () =>
  new AIMessageChunk({
    content: '',
    tool_call_chunks: [
      {
        name: 'gth_checklist',
        args: '{"items":[{"content":"Examine the diff","status":"pending"}]}',
        id: 'gated-1',
        index: 0,
        type: 'tool_call_chunk',
      },
    ],
  });

/**
 * An agent whose graph yields one scripted stream per call, in order — `stream()` drains the
 * first, `streamResume()` the second, exactly as a suspended turn does.
 */
async function agentOverStreams(scripts: unknown[][]) {
  const { GthAbstractAgent } = await import('#src/core/GthAbstractAgent.js');
  class TestAgent extends GthAbstractAgent {
    async init(): Promise<void> {
      /* the graph is injected directly */
    }
  }
  const agent = new TestAgent(() => {});
  let next = 0;

  (agent as any).config = { writeBinaryOutputsToFile: false };

  (agent as any).agent = {
    async stream() {
      return streamOf(scripts[next++] ?? []);
    },
  };
  return agent;
}

/** Drain a text stream to completion — the rows are emitted as a side effect of draining it. */
async function drain(stream: { [Symbol.asyncIterator](): AsyncIterator<string> }): Promise<string> {
  let text = '';
  for await (const chunk of stream) text += chunk;
  return text;
}

const rows = (): string[] =>
  consoleUtilsMock.displayToolIndication.mock.calls.map((c) => (c[0] as string).split('\n')[1]);

describe('plain tool indication across a suspended turn (TUI-C106)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    systemUtilsMock.getUseColour.mockReturnValue(false);
  });

  it('names a gated call whose result arrives in the RESUMED stream', async () => {
    const agent = await agentOverStreams([
      // Stream 1: the model announces the call, then the graph suspends at the approval gate.
      [gatedCallChunk()],
      // Stream 2: the human answered, the tool ran, and its result lands here.
      [
        new ToolMessage({
          content: 'checklist saved',
          tool_call_id: 'gated-1',
          name: 'gth_checklist',
        }),
      ],
    ]);

    await drain(await agent.stream([new HumanMessage('review it')], runConfig));
    expect(rows()).toEqual([]); // nothing has returned yet — the call is still at the gate

    await drain(await agent.streamResume({ decision: 'approve' }, runConfig));

    expect(rows()).toHaveLength(1);
    // The ARGUMENTS survive the boundary. This is the assertion the defect failed: the row read
    // `gth_checklist()` because the resumed stream's observer had never seen the producer.
    expect(rows()[0]).toContain('gth_checklist(items=');
    expect(rows()[0]).toContain('Examine the diff');
  });

  it('CONTROL: an ungated call inside one stream is named exactly as before', async () => {
    // The other half of the reproduction — same turn, no gate, no boundary, always named. It is
    // what proves the turn lifetime is the variable and not the rendering.
    const agent = await agentOverStreams([
      [
        new AIMessageChunk({
          content: '',
          tool_call_chunks: [
            {
              name: 'gth_grep',
              args: '{"pattern":"EXT-6"}',
              id: 'ungated-1',
              index: 0,
              type: 'tool_call_chunk',
            },
          ],
        }),
        new ToolMessage({ content: 'src/a.ts:1: EXT-6', tool_call_id: 'ungated-1' }),
      ],
    ]);

    await drain(await agent.stream([new HumanMessage('grep it')], runConfig));

    expect(rows()).toEqual([expect.stringContaining('gth_grep(pattern=EXT-6)')]);
  });

  it('starts a NEW turn clean, so one turn cannot supply the next turn arguments', async () => {
    // The lifetime is the turn, not the session. `stream()` opens a turn and must drop whatever
    // the previous one left announced-but-unanswered, or a later same-name call inherits it.
    const agent = await agentOverStreams([
      [gatedCallChunk()], // turn 1 announces a call that never returns
      [
        new ToolMessage({
          content: 'checklist saved',
          tool_call_id: 'gated-1',
          name: 'gth_checklist',
        }),
      ], // turn 2
    ]);

    await drain(await agent.stream([new HumanMessage('first turn')], runConfig));
    await drain(await agent.stream([new HumanMessage('second turn')], runConfig));

    expect(rows()).toHaveLength(1);
    // Positively pinned, not merely "does not contain": the row still names the tool, from the
    // result's own name, and carries no arguments. A bare absence assertion would pass on a row
    // that said nothing at all.
    expect(rows()[0]).toContain('gth_checklist()');
    expect(rows()[0]).not.toContain('Examine the diff');
  });

  it('drops the turn tracking on /clear, with the rest of the turn state', async () => {
    const agent = await agentOverStreams([
      [gatedCallChunk()],
      [
        new ToolMessage({
          content: 'checklist saved',
          tool_call_id: 'gated-1',
          name: 'gth_checklist',
        }),
      ],
    ]);

    await drain(await agent.stream([new HumanMessage('review it')], runConfig));
    // The user asked for the conversation to be forgotten before answering the gate.
    agent.clearRaterClarifications();
    await drain(await agent.streamResume({ decision: 'approve' }, runConfig));

    expect(rows()).toHaveLength(1);
    // Positively pinned, not merely "does not contain": the row still names the tool, from the
    // result's own name, and carries no arguments. A bare absence assertion would pass on a row
    // that said nothing at all.
    expect(rows()[0]).toContain('gth_checklist()');
    expect(rows()[0]).not.toContain('Examine the diff');
  });
});
