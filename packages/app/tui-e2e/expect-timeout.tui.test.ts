import path from 'node:path';
import { test, expect } from '@microsoft/tui-test';
import { settleSessionsAfterEach } from './fixtures/tmpHome.mjs';
import { configuredExpectTimeout } from './fixtures/expectTimeout.mjs';
import tuiTestConfig from './tui-test.config.js';

settleSessionsAfterEach(test);

// tui-test keeps process.cwd() at the invocation dir (this folder); the cli lives one level up.
const e2eDir = process.cwd();
const cli = path.resolve(e2eDir, '..', 'cli.js');
const fixture = (name: string): string => path.resolve(e2eDir, 'fixtures', name);

/** See `chat.tui.test.ts` for why `CI` is deleted rather than blanked. */
const envFor = (fixtureName: string): Record<string, string | undefined> => {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.CI;
  delete env.GTH_NO_TUI;
  env.TERM = 'xterm-256color';
  env.GTH_TUI_E2E_FIXTURE = fixture(fixtureName);
  return env;
};

/** The text `fixtures/expect-timeout.json` streams, after its `delayMs`. */
const LATE_MARKER = 'QA15-LATE-MARKER';

/**
 * The delay the fixture holds the marker back by. It has to sit strictly between the library's
 * 5000 ms fallback and the configured bound, with room on both sides: too small and the case passes
 * under either bound and proves nothing; too large and it eats into the per-test timeout.
 */
const FIXTURE_DELAY_MS = 7_000;

/** The bound the config asks for, read from the config rather than restated, so retuning it here is one edit. */
const DECLARED_EXPECT_TIMEOUT = tuiTestConfig.expect?.timeout;

/**
 * [[QA-15]] — the suite's own expect timeout, pinned by an assertion that needs it.
 *
 * `tui-test` reads `expect.timeout` into module state in the **main runner process**, and every
 * matcher runs in a **worker process** that never loaded it — so the whole suite polled for the
 * library's 5000 ms fallback while the config asked for more. `fixtures/expectTimeout.mjs` closes
 * that by loading the config in the worker; this file is what proves it, and the proof has to be an
 * assertion that genuinely needs longer than the old bound.
 *
 * **A green suite is not evidence for this.** A matcher that resolves in 200 ms resolves
 * identically under 5 s and under 15 s, so every other case in this suite would pass unchanged with
 * the fix reverted. Only a wait that exceeds 5000 ms can tell the two apart, which is why this case
 * deliberately costs about twelve seconds. Nothing else here is allowed to be that slow.
 *
 * The three assertions cover different things and none of them is redundant:
 *
 * - the *value* the matchers will use matches the config — proves `expectTimeout.mjs` loaded it;
 * - the marker becomes visible at all — proves the matchers resolve to the **same** physical config
 *   module the fixture populated, which is the actual defect and the one thing a reading of the
 *   sources cannot establish;
 * - the wait really exceeded 5000 ms — without it, shortening `FIXTURE_DELAY_MS` (or a fixture
 *   agent that stopped honouring `delayMs`) would leave a case that passes under both bounds and
 *   quietly stops testing anything.
 */
test.describe('gth chat TUI — the configured expect timeout binds in the worker', () => {
  test.use({
    program: { file: 'node', args: [cli, 'chat', '--tui'] },
    env: envFor('expect-timeout.json'),
    columns: 100,
    rows: 30,
  });

  test('a matcher waits the configured bound, not the 5 s library fallback', async ({
    terminal,
  }) => {
    expect(configuredExpectTimeout()).toBe(DECLARED_EXPECT_TIMEOUT);

    await expect(terminal.getByText('ready to chat')).toBeVisible();
    // Type, confirm the echo, then send Enter separately — Ink coalesces a "text\r" single write
    // into one input event, so the return must be its own keystroke.
    terminal.write('go');
    await expect(terminal.getByText('> go')).toBeVisible();

    // The fixture's clock starts here, on submit, so the wait below is measured from inside the
    // test body and does not depend on how long the harness took to get here.
    const submittedAt = Date.now();
    terminal.submit();
    await expect(terminal.getByText(LATE_MARKER)).toBeVisible();
    const waitedMs = Date.now() - submittedAt;

    expect(FIXTURE_DELAY_MS).toBeGreaterThan(5_000);
    expect(waitedMs).toBeGreaterThan(5_000);
  });
});
