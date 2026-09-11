import { describe, expect, it } from 'vitest';
import type { AgentStreamEvent } from '@gaunt-sloth/core/core/types.js';
import { AcpUpdateMapper } from '#src/modules/acp/acpUpdates.js';
import { AcpV1UpdateMapper } from '#src/modules/acp/acpUpdatesV1.js';

/**
 * [[EXT-167]] — **what an ACP client is told when the session compacts the conversation mid-turn.**
 *
 * The runtime folds the older history and retries when the provider rejects a turn for size, and
 * says so on the stream with a `context_compacted` event. An editor has already rendered the tool
 * calls that preceded the fold, so the bridge owes it a line in the conversation at that point —
 * not silence, which would present the answer made after the fold as though nothing had happened
 * to the history behind it.
 *
 * Both dialects are covered because they are two hand-written mappers over one event stream, and a
 * notice one of them dropped would be exactly the divergence this pairing exists to prevent.
 */

type Update = Record<string, unknown>;

function mapAll(
  mapper: { map(event: AgentStreamEvent): unknown[] },
  events: AgentStreamEvent[]
): Update[] {
  return events.flatMap((event) => mapper.map(event) as Update[]);
}

const compacted: AgentStreamEvent = {
  type: 'context_compacted',
  cause: 'context_overflow',
  compaction: {
    changed: true,
    removedCount: 9,
    keptCount: 6,
    keepRecent: 6,
    summaryText: 'SUMMARY',
    before: { messages: 15, characters: 40210 },
    after: { messages: 7, characters: 3120 },
  },
};

/** The text an update carries, whether as one block (a chunk) or a list of them (a message). */
function textOf(update: Update): string {
  const content = update.content as { text?: string } | Array<{ text?: string }>;
  const blocks = Array.isArray(content) ? content : [content];
  return blocks.map((block) => block?.text ?? '').join('');
}

const mappers: Array<[string, () => { map(event: AgentStreamEvent): unknown[] }]> = [
  ['v2', () => new AcpUpdateMapper()],
  ['v1', () => new AcpV1UpdateMapper()],
];

describe.each(mappers)(
  '[[EXT-167]] ACP %s — a compaction applied mid-turn',
  (_dialect, makeMapper) => {
    it('puts one line in the conversation, carrying the fold and its numbers', () => {
      const updates = mapAll(makeMapper(), [compacted]);

      expect(updates).toHaveLength(1);
      // A message of the agent's own about the session, on the same channel the failed-turn and
      // remembered-approval lines use — whichever spelling of it this dialect has.
      expect(String(updates[0].sessionUpdate)).toMatch(/^agent_message(_chunk)?$/);
      expect(typeof updates[0].messageId).toBe('string');
      const text = textOf(updates[0]);
      expect(text).toContain('Context overflowed — conversation compacted');
      expect(text).toContain('9 older messages were folded into a summary');
      expect(text).toContain(
        'Model context: 15 messages (~40,210 characters) → 7 messages (~3,120 characters).'
      );
      expect(text).toContain('Nothing already on screen was undone');
    });

    it('closes the open text run: the answer made after the fold is a NEW message', () => {
      const updates = mapAll(makeMapper(), [
        { type: 'text', delta: 'before ' },
        compacted,
        { type: 'text', delta: 'after' },
      ]);

      const chunks = updates.filter((u) => u.sessionUpdate === 'agent_message_chunk');
      const ids = new Set(updates.map((u) => u.messageId));
      // Three distinct identities: the text before, the notice, the text after. A client that had
      // considered the first message whole is not told to append the post-fold answer to it.
      expect(ids.size).toBe(3);
      expect(chunks[0].messageId).not.toBe(chunks[chunks.length - 1].messageId);
    });

    it('control: without the fold between them, two text deltas are one message', () => {
      // Pins that the split above is CAUSED by the event, not by every delta being its own message.
      const updates = mapAll(makeMapper(), [
        { type: 'text', delta: 'before ' },
        { type: 'text', delta: 'after' },
      ]);
      expect(new Set(updates.map((u) => u.messageId)).size).toBe(1);
    });
  }
);
