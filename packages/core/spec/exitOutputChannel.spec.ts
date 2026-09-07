import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * TUI-C56 — the queue half of the exit-output channel.
 *
 * The channel is deliberately split: this module holds text and nothing else, and the surface
 * that owns the terminal decides when and whether to write it. So these cells are about the
 * queue's contract — order, destructive drain, discard — and the WHEN is asserted where it
 * actually lives, against the real unmount ordering, in
 * `packages/app/spec/tui/tuiSessionModule.spec.tsx`.
 */
describe('exitOutputChannel (TUI-C56)', () => {
  beforeEach(() => {
    // Fresh module instance per cell: the queue is module-level state, so without this a cell
    // that deferred and never drained would seed the next one.
    vi.resetModules();
  });

  it('drains what was deferred, in the order it was deferred', async () => {
    const { deferExitOutput, drainExitOutput } = await import('#src/core/exitOutputChannel.js');

    deferExitOutput('first');
    deferExitOutput('second');

    expect(drainExitOutput()).toEqual(['first', 'second']);
  });

  it('drains to an empty array when nothing was deferred', async () => {
    const { drainExitOutput } = await import('#src/core/exitOutputChannel.js');

    expect(drainExitOutput()).toEqual([]);
  });

  it('empties the queue on drain, so a second drain cannot double-print', async () => {
    // A surface may reach its drain point more than once (two exit paths, a retry). Whatever else
    // that costs, it must not print the archive path twice.
    const { deferExitOutput, drainExitOutput } = await import('#src/core/exitOutputChannel.js');

    deferExitOutput('only once');

    expect(drainExitOutput()).toEqual(['only once']);
    expect(drainExitOutput()).toEqual([]);
  });

  it('discards deferred text on clear, without returning it anywhere', async () => {
    // What a surface calls as it starts, so a block deferred earlier in the same process can
    // never surface at the end of a session that had nothing to do with it.
    const { clearExitOutput, deferExitOutput, drainExitOutput } =
      await import('#src/core/exitOutputChannel.js');

    deferExitOutput('from something else entirely');
    clearExitOutput();

    expect(drainExitOutput()).toEqual([]);
  });

  it('keeps deferring after a drain — the channel is reusable, not one-shot', async () => {
    const { deferExitOutput, drainExitOutput } = await import('#src/core/exitOutputChannel.js');

    deferExitOutput('before');
    drainExitOutput();
    deferExitOutput('after');

    expect(drainExitOutput()).toEqual(['after']);
  });
});
