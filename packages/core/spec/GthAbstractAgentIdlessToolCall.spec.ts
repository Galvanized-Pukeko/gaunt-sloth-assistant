import { describe, expect, it } from 'vitest';
import { AIMessageChunk, ToolMessage } from '@langchain/core/messages';
import type { AgentStreamEvent } from '#src/core/types.js';

/**
 * [[TUI-C106]] — **what the typed event stream does with a call whose id never reached the merged
 * message**, and the decision recorded on `flushAggregated` in `GthAbstractAgent`.
 *
 * A provider may stream tool-call deltas that carry no tool-call id. LangChain does not put such a
 * call in `tool_calls` at all — `collapseToolCallChunks` files it under `invalid_tool_calls`
 * instead, id-less — so `flushAggregated` never announces it, and both of its loops skip it
 * deliberately: announcing one means MINTING an id, and [[EXT-47]] requires a promoted call's id to
 * be stable and wire-derived, without fabricating.
 *
 * The call is not lost by that. Its `ToolMessage` still carries a real, wire-derived
 * `tool_call_id`, so a `tool_result` is emitted and every renderer draws a row from it. What such a
 * row lacked was a NAME — the Ink reducer's placeholder has none, so the row read `(tool)()`, which
 * is worse than the plain surface's `name()`. The result now carries the tool's own name, which is
 * the only name that will ever arrive for such a call.
 */

/** The chunk stream shape `streamWithEvents` consumes: `[message, metadata]` pairs. */
function streamOf(messages: unknown[]) {
  return (async function* () {
    for (const message of messages) yield [message, {}];
  })();
}

/** Drive one scripted stream through a bare agent and collect every event, in order. */
async function eventsOf(messages: unknown[]): Promise<AgentStreamEvent[]> {
  const { GthAbstractAgent } = await import('#src/core/GthAbstractAgent.js');
  class TestAgent extends GthAbstractAgent {
    async init(): Promise<void> {
      /* the graph is injected directly */
    }
  }
  const agent = new TestAgent(() => {}) as unknown as {
    config: unknown;
    agent: unknown;
    streamWithEvents: (messages: unknown[], runConfig: unknown) => AsyncGenerator<AgentStreamEvent>;
  };
  agent.config = { writeBinaryOutputsToFile: false };
  agent.agent = {
    async stream() {
      return streamOf(messages);
    },
  };
  const events: AgentStreamEvent[] = [];
  for await (const event of agent.streamWithEvents([], { configurable: { thread_id: 't' } })) {
    events.push(event);
  }
  return events;
}

const GH_RESULT = 'Full contents of acme/widgets/src/tenant/Community.ts@main:\n\nbody';

describe('streamWithEvents — a tool call with no id of its own (TUI-C106)', () => {
  it('does not announce it, and names it on the RESULT instead', async () => {
    const events = await eventsOf([
      new AIMessageChunk({
        content: '',
        // No `id` on the delta: LangChain collapses this into `invalid_tool_calls`, id-less.
        tool_call_chunks: [
          {
            name: 'gth_gh_read_file',
            args: '{"path":"src/tenant/Community.ts"}',
            index: 0,
            type: 'tool_call_chunk',
          },
        ],
      }),
      new ToolMessage({
        content: GH_RESULT,
        tool_call_id: 'wire-derived-1',
        name: 'gth_gh_read_file',
      }),
    ]);

    // No id was minted to announce it with — the EXT-47 rule, kept.
    expect(events.filter((e) => e.type === 'tool_start')).toEqual([]);

    // But the call is NOT silent: its result arrives under the id the wire supplied, carrying the
    // name the row will be drawn with.
    const results = events.filter((e) => e.type === 'tool_result');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: 'wire-derived-1', name: 'gth_gh_read_file' });
  });

  it('names an announced call on its result too, without disturbing the announcement', async () => {
    const events = await eventsOf([
      new AIMessageChunk({
        content: '',
        tool_call_chunks: [
          {
            id: 'c1',
            name: 'read_file',
            args: '{"path":"notes.txt"}',
            index: 0,
            type: 'tool_call_chunk',
          },
        ],
      }),
      new ToolMessage({ content: 'notes body', tool_call_id: 'c1', name: 'read_file' }),
    ]);

    expect(events.filter((e) => e.type === 'tool_start')).toEqual([
      { type: 'tool_start', id: 'c1', name: 'read_file' },
    ]);
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({
      id: 'c1',
      name: 'read_file',
    });
  });

  it('invents no name when the result carries none', async () => {
    const events = await eventsOf([
      new ToolMessage({ content: 'orphan body', tool_call_id: 'orphan' }),
    ]);

    const result = events.find((e) => e.type === 'tool_result');
    expect(result).toMatchObject({ id: 'orphan' });
    expect(result).not.toHaveProperty('name');
  });
});
