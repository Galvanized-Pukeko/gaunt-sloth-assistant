import { applyTuiColour } from '#src/tui/colour.js';

/**
 * OPS-30 — the prefixes LangSmith resolves its configuration through. `getLangSmithEnvironmentVariable(name)`
 * reads `LANGSMITH_<name>` and falls back to `LANGCHAIN_<name>`, so every knob it has exists under
 * both spellings and a list of individual names is a list that the next release outruns.
 */
export const LANGSMITH_ENV_PREFIXES = ['LANGSMITH_', 'LANGCHAIN_'] as const;

/**
 * OPS-30 — take LangSmith's whole configuration out of `env`, and report what was taken.
 *
 * **The defect.** Five `gthWebFetchTool` specs replace the global with a one-shot `fetch` mock.
 * With tracing switched on and a key present, `tool.invoke()` starts a tracer that calls
 * `globalThis.fetch` *before* the tool body runs, so the tracer consumes the queued value; the
 * implementation's own call then resolves to `undefined`, and every assertion collapses into the
 * same "Unknown error" rejection. The mock is installed and is genuinely the global — it was
 * drained by a different caller, which is why probing the global proves nothing.
 *
 * **Why this is not a machine-local fix.** It reproduces in any process that exports the tracing
 * flag together with a key, on any machine, and the suite is green everywhere else. Clearing the
 * environment has a justification stronger than making a test pass: a unit suite must not be able
 * to POST run data to an external service.
 *
 * **Why a prefix sweep rather than a list of names.** Enumerate from the grammar, not from the
 * instances observed: the switch alone has four spellings (`TRACING` and `TRACING_V2` under both
 * prefixes), and the endpoint, project, session and key each have two. A list would also have to
 * be revisited on every langsmith bump, and nothing in this repo reads a variable under either
 * prefix — the only other mentions are process-spawning specs that already delete three of the
 * switches from the child's environment by hand.
 *
 * **Why not `test.env` in the vitest config.** The value that switches tracing off is the absence
 * of the variable, not a falsy value: the gate tests `=== 'true'`, so any assignment is a decision
 * where none was made, and a spec that later reads the environment would see one.
 */
export function clearLangSmithEnv(env: NodeJS.ProcessEnv): string[] {
  const cleared = Object.keys(env).filter((name) =>
    LANGSMITH_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
  for (const name of cleared) delete env[name];
  return cleared;
}

clearLangSmithEnv(process.env);

/**
 * OPS-33 — pin the colour environment for the unit suite, so no spec depends on ambient terminal
 * capability.
 *
 * **The problem.** Specs that render Ink compare frames to un-escaped strings — e.g.
 * `expect([...lines[0]].slice(21).join('')).toBe('┏┓         ┏┓┓   ┓')` in `spec/tui/LaunchBanner`.
 * Slicing by code-point index only lines up while the frame is plain text; once chalk emits SGR
 * the escapes shift every column and six such tests across `spec/tui/{App,LaunchBanner,PromptInput}`
 * fail.
 *
 * **What actually triggers it — measured, because it was twice mis-filed as a "colour terminal"
 * bug.** Vitest runs specs in worker processes whose stdout is a pipe, and chalk's vendored
 * `supports-color` returns early on `haveStream && !streamIsTTY && forceColor === undefined`. So
 * chalk sits at level 0 however capable the parent terminal is: a real PTY (Konsole, IntelliJ)
 * with no `FORCE_COLOR` is 69/69 green. An exported `FORCE_COLOR` is the only thing that
 * overrides that check — the same PTY with `FORCE_COLOR=3` is 6 failed / 63 passed. The terminal
 * is irrelevant; the variable is the whole trigger. TUI-C35 has just made `FORCE_COLOR` a
 * documented, first-class knob, so a developer exporting it is now a blessed configuration whose
 * first effect would be turning this suite red.
 *
 * **Why this is safe everywhere it is not needed.** Under vitest chalk is *already* at level 0, so
 * clamping to 0 is an identity operation in every environment that passes today; it can only
 * change behaviour in the environment that is currently broken.
 *
 * **Why the clamp and not `FORCE_COLOR=0` in `test.env`.** They are not equivalent, and the
 * difference is not stylistic. `FORCE_COLOR=0` is a *meaningful* value on CFG-30's ladder — rung 1,
 * "colour explicitly off" — not a neutral one. Setting it globally would feed a decision into the
 * production ladder under test in every spec that does not clear it first, quietly preempting the
 * NO_COLOR / config / TTY rungs that `spec/colourPrecedence` and friends exist to exercise. Going
 * through the shipped hook touches `chalk.level` only and never `process.env`, so the ladder specs
 * are untouched. (The node listed the env pin as an acceptable alternative; measuring the two
 * showed it is not, and this comment is here so it does not get "simplified" back.)
 *
 * **Why `applyTuiColour(false)` rather than assigning `chalk.level = 0` directly.** It is the same
 * end state reached through the production mechanism, so the pin cannot drift from what the app
 * means by "colour off", and it changes what no test asserts.
 *
 * **Why this file sits beside `package.json` rather than under `spec/`.** The root vitest config
 * collects every `.ts` and `.tsx` file under any package's `spec/` directory as a test file, so a
 * helper placed there would be collected too and fail with "No test suite found in file". Living
 * inside `packages/app` is also what lets `#src/…` resolve: the workspace resolver is
 * importer-aware and maps this file to the `app` package.
 *
 * Top level rather than a global `beforeEach`, because `spec/colourCrossSurface.e2e.spec.ts` drives
 * `chalk.level` itself and restores it — a per-test hook would race that.
 */
applyTuiColour(false);
