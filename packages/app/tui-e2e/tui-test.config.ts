import { defineConfig } from '@microsoft/tui-test';

/**
 * PTY end-to-end config for the Ink TUI (Phase 2a Stage D). Tests live beside this file and
 * drive the real `gth chat` binary in a pseudo-terminal, fed by the deterministic fixture
 * agent (see `src/tui/fixtureAgent.ts`) so runs are hermetic and key-free. Kept entirely
 * separate from the vitest unit suite, which only globs the `spec` directories.
 *
 * **`expect.timeout` does not reach the matchers on its own.** `tui-test` loads this file in its
 * main runner process, and every matcher runs in a worker process that never loads it — so the
 * value below binds only because `fixtures/expectTimeout.mjs` loads the config again on that side,
 * and every test file reaches that module. Read it before changing the number, and do not treat a
 * green suite as evidence the number took: `expect-timeout.tui.test.ts` is the only case that can
 * tell 5 s from 15 s, and `spec/tuiE2eExpectTimeoutWired.spec.ts` is what keeps the wiring in place.
 */
export default defineConfig({
  testMatch: '**/*.tui.test.ts',
  // Streaming-TUI timing varies on slow CI; give async expect-poll room and retry twice there.
  //
  // The per-test cap has to hold a whole test whose last assertion then burns the full expect
  // budget, or a slow failure is killed as a bare `worker was terminated` and loses the terminal
  // snapshot that says what was actually on screen — the one output worth having from a flake.
  // Measured on this suite: the slowest passing test is under 8 s, of which 5 s is the fixed wait
  // tui-test does before running a test body, so a failing run needs roughly 8 + 15 here and the
  // rest is headroom for a loaded Windows runner.
  timeout: 45_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 2 : 0,
});
