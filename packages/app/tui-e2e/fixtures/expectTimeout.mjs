/**
 * [[QA-15]] — make the `expect.timeout` in `tui-test.config.ts` bind in the process the matchers
 * actually run in. Importing this module anywhere in a test file is the whole mechanism; there is
 * nothing to call.
 *
 * **The defect.** `@microsoft/tui-test` keeps its loaded config in module-level state
 * (`lib/config/config.js`) and `getExpectTimeout()` returns `loadedConfig?.expect.timeout ?? 5000`.
 * `loadConfig()` is called once, from `lib/runner/runner.js`, in the **main runner process**. Every
 * test body — and therefore every `toBeVisible` / `toHaveBgColor` / `toHaveFgColor`, the only three
 * callers of `getExpectTimeout()` — runs in a **worker process** forked by workerpool, and
 * `lib/runner/worker.js` never imports the config module at all. The worker's copy of
 * `loadedConfig` stays `undefined`, so every matcher in this suite polled for the 5000 ms fallback
 * while the config asked for 15000. That is why every recorded PTY failure here reads
 * `resolved to 0 elements after 5s`.
 *
 * **Why the config is loaded here rather than passed through.** The obvious shape — hand the value
 * to the worker the way `shellReadyTimeout` is handed over — is not reachable from outside the
 * library. `retries` and `timeout` never cross the process boundary at all (they are a loop
 * counter and a `poolPromise.timeout()` deadline, both consumed main-side); only
 * `shellReadyTimeout` is sent, as a positional argument of a `pool.exec("testWorker", [...])` call
 * whose argument list is fixed on both sides of the library. Preloading the worker is not reachable
 * either: workerpool's `resolveForkOptions` overwrites `forkOpts.execArgv` with a filtered list, so
 * a `--import` on the runner does not reach the fork. Calling `loadConfig()` from a module the test
 * files import is the one seam that is ours, and it lands in the right process because it runs
 * during the worker's own `await import(<test file>)`, before any test body or hook.
 *
 * **Coverage is a gate, not a habit.** A test file that does not reach this module silently keeps
 * the 5 s bound, and a suite where that is true of some files is worse than one where it is true
 * of all of them, because it looks fixed. `spec/tuiE2eExpectTimeoutWired.spec.ts` fails if any
 * `*.tui.test.ts` file stops reaching it, and if `tmpHome.mjs` — the module most of them reach it
 * through — stops importing it.
 *
 * **What this cannot check, and what does.** The guard below proves this module's own copy of the
 * library config is populated. It cannot prove the matchers resolve to the same physical module,
 * which is the actual defect; only an assertion that needs longer than the old bound can, and
 * `expect-timeout.tui.test.ts` is that assertion.
 */
import { getExpectTimeout, loadConfig } from '@microsoft/tui-test/lib/config/config.js';

const loaded = await loadConfig();

if (getExpectTimeout() !== loaded.expect.timeout) {
  throw new Error(
    `tui-test's expect timeout did not take: loadConfig() reported ${loaded.expect.timeout} ms but ` +
      `getExpectTimeout() returns ${getExpectTimeout()} ms. The library no longer keeps the loaded ` +
      `config in the module state its matchers read, so every matcher in this suite is back on the ` +
      `5000 ms fallback. See fixtures/expectTimeout.mjs (QA-15).`
  );
}

/**
 * The expect timeout the matchers in this process will actually use, in milliseconds.
 *
 * Read through the library's own accessor rather than from the config object, so it reports what a
 * matcher would get and not what the config asked for — those are the same number only because
 * this module made them so.
 */
export function configuredExpectTimeout() {
  return getExpectTimeout();
}
