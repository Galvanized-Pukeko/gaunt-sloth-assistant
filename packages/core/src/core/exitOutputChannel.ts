/**
 * @module exitOutputChannel
 * TUI-C56 — the queue for output that must OUTLIVE the session's own screen.
 *
 * TUI-C48 put the whole interactive session in the terminal's alternate screen. Ink treats
 * alternate-screen teardown output as disposable by design: on unmount it restores the primary
 * buffer without replaying prior frames, so everything the session painted — every notice, every
 * answer — goes with the alternate buffer when the session ends. That is exactly what the
 * full-screen surface is for, and it is the right default for a conversation.
 *
 * It is the wrong default for the handful of things a user must still have AFTER the session:
 * a path they now have to go and open. The first of those is the `/debug-dump` archive, whose
 * in-frame notice is genuinely useful mid-session and completely gone the moment the user exits —
 * leaving them holding a diagnostic bundle they cannot find, with nothing having errored.
 *
 * So this is a channel, not a special case: a producer anywhere in the codebase can DEFER one
 * block of text, and the surface that owns the terminal drains it once the terminal is its
 * owner's again. Two halves, deliberately split:
 *
 * - **This module is the queue and nothing else.** No stream, no formatting, no policy about
 *   when a line is worth printing. That keeps it surface-agnostic and directly testable.
 * - **The surface owns the write.** Only the surface knows when its terminal is back (for the
 *   Ink TUI: after `waitUntilExit()` has resolved, which is after Ink has left the alternate
 *   screen) and whether writing is appropriate at all (a piped run must not get an extra line
 *   its caller did not ask for). See `writeDeferredExitOutput` in the TUI session module.
 *
 * A surface whose output already survives its own exit — the readline (`--no-tui`) session, which
 * never owned an alternate screen — simply never drains. Deferring is then a no-op that costs one
 * array entry and prints nothing, which is what keeps the producers surface-agnostic: `/debug-dump`
 * is one command with one behaviour, and the two surfaces differ only in whether the re-print is
 * needed at all.
 */

/**
 * Blocks of deferred text, in the order they were deferred. Module-level, like the single
 * subscriber in `toolOutputChannel`: one process hosts at most one interactive session, and no
 * server surface reaches a producer (the slash-command registry is built only by the two
 * interactive sessions).
 */
const deferred: string[] = [];

/**
 * Defer one block of text until the surface hands the terminal back.
 *
 * The text should stand on its own: it lands on a restored screen with none of the session's
 * framing around it and possibly a long scrollback above it, so a bare value with no label is not
 * enough for a reader to know what they are looking at.
 */
export function deferExitOutput(text: string): void {
  deferred.push(text);
}

/**
 * Take everything deferred so far, emptying the queue. Draining is destructive so a second drain
 * — a surface with more than one exit path reaching the drain twice — cannot double-print.
 */
export function drainExitOutput(): string[] {
  return deferred.splice(0, deferred.length);
}

/**
 * Discard anything deferred without emitting it. A surface calls this as it starts, so a block
 * deferred by something earlier in the same process can never surface at the end of a session
 * that had nothing to do with it.
 */
export function clearExitOutput(): void {
  deferred.length = 0;
}
