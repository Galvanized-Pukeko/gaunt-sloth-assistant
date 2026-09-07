import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearLangSmithEnv, LANGSMITH_ENV_PREFIXES } from '../vitest.setup.js';

/**
 * OPS-30 — the unit suite must not be able to reach LangSmith, and the pin has to be testable
 * without depending on the environment the suite happens to run in.
 *
 * The clear itself runs once, in the setup file, before any spec — so a spec that only asserted
 * `process.env.LANGCHAIN_TRACING_V2` is undefined would pass on every machine where nobody had
 * exported it, which is most of them. That assertion cannot fail for the reason it names. So the
 * mechanism is exercised directly against a synthetic environment, where the inputs are ours, and
 * the seam is proven separately by running the affected spec file with the variables exported
 * (recorded in the node).
 */
describe('OPS-30 — LangSmith configuration is cleared for the unit suite', () => {
  /** Every spelling the langsmith 0.9 gate actually reads, from its own resolver. */
  const langSmithNames = [
    'LANGSMITH_TRACING',
    'LANGSMITH_TRACING_V2',
    'LANGCHAIN_TRACING',
    'LANGCHAIN_TRACING_V2',
    'LANGSMITH_API_KEY',
    'LANGCHAIN_API_KEY',
    'LANGSMITH_ENDPOINT',
    'LANGCHAIN_ENDPOINT',
    'LANGSMITH_PROJECT',
    'LANGCHAIN_PROJECT',
    'LANGSMITH_SESSION',
    'LANGCHAIN_SESSION',
    'LANGSMITH_RUNS_ENDPOINTS',
  ];

  const populated = (): NodeJS.ProcessEnv => ({
    ...Object.fromEntries(langSmithNames.map((name) => [name, 'set'])),
    // Neighbours that must survive. `LANG` and `LANGUAGE` are the discriminating pair: they share
    // four letters with the prefixes and belong to the user's locale, so a sweep written as
    // `startsWith('LANG')` would silently unset the machine's locale mid-suite.
    LANG: 'en_NZ.UTF-8',
    LANGUAGE: 'en_NZ:en',
    PATH: '/usr/bin',
    HOME: '/home/nobody',
    FORCE_COLOR: '3',
  });

  it('removes every LangSmith variable and reports each one it removed', () => {
    const env = populated();
    const cleared = clearLangSmithEnv(env);

    for (const name of langSmithNames) {
      expect(env[name], `${name} should have been deleted`).toBeUndefined();
      expect(name in env, `${name} should be absent, not merely undefined`).toBe(false);
      expect(cleared).toContain(name);
    }
    expect(cleared).toHaveLength(langSmithNames.length);
  });

  it('leaves everything else alone, including the locale variables that share a stem', () => {
    const env = populated();
    clearLangSmithEnv(env);

    expect(env.LANG).toBe('en_NZ.UTF-8');
    expect(env.LANGUAGE).toBe('en_NZ:en');
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/nobody');
    expect(env.FORCE_COLOR).toBe('3');
  });

  it('covers a variable this langsmith release has not invented yet, under either prefix', () => {
    // The point of sweeping the prefix rather than listing names: a knob added by a future
    // release is already covered, and a list would not have been.
    const env: NodeJS.ProcessEnv = {
      LANGSMITH_SOMETHING_NEW: 'set',
      LANGCHAIN_SOMETHING_NEW: 'set',
      KEEP: 'set',
    };
    const cleared = clearLangSmithEnv(env);

    expect(cleared.sort()).toEqual(['LANGCHAIN_SOMETHING_NEW', 'LANGSMITH_SOMETHING_NEW']);
    // Deleted, not merely listed: without this the whole cell passes against a function that
    // reports names and removes none, which the first cell would then be alone in catching.
    expect('LANGSMITH_SOMETHING_NEW' in env).toBe(false);
    expect('LANGCHAIN_SOMETHING_NEW' in env).toBe(false);
    expect(env.KEEP).toBe('set');
  });

  it('reports nothing only when there was nothing to clear', () => {
    // The empty case is asserted against a populated one in the same cell deliberately. An empty
    // result on an empty environment is also what a function that always returns nothing produces,
    // so on its own this cell would pin the absence of a report rather than its accuracy.
    const empty: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
    expect(clearLangSmithEnv(empty)).toEqual([]);
    expect(empty.PATH).toBe('/usr/bin');

    expect(clearLangSmithEnv({ LANGSMITH_API_KEY: 'set' })).toEqual(['LANGSMITH_API_KEY']);
  });

  it('sweeps both prefixes, so neither spelling can be dropped unnoticed', () => {
    expect([...LANGSMITH_ENV_PREFIXES].sort()).toEqual(['LANGCHAIN_', 'LANGSMITH_']);
  });
});

/**
 * OPS-112 — the CALL, not the function.
 *
 * The block above proves `clearLangSmithEnv` clears whatever environment it is handed. Nothing
 * proved the setup file still *calls* it, and that call is now the single enforcement point:
 * OPS-111 removed the hand-deletions that used to shadow it, and three specs
 * (`rootResumeOption`, `execWriteOutputToFile.e2e`, `apiBin`) carry comments naming it as the
 * reason their runs are hermetic. Comment the call out and, on any machine that exports no
 * tracing variables — every CI cell included — the entire suite stays green while those three
 * comments go on describing a guarantee that no longer exists.
 *
 * **Why the obvious assertion is not this test.** Asserting that `process.env` holds no
 * `LANGSMITH_`/`LANGCHAIN_` key passes whether or not the clear ran, on every machine that never
 * had one. It cannot fail for the reason it names, so it measures the machine and not the code.
 * Do not "simplify" the cells below into that one.
 *
 * **What is done instead.** Seed the real environment, then re-evaluate the setup module against
 * it. The clear is a module-scope side effect, so an evaluation that removes the seed can only
 * have executed the call — and removing the call turns this red on a machine with nothing
 * exported, which is the whole point.
 *
 * **Why re-evaluating the setup file is safe.** Its only other module-scope statement is
 * `applyTuiColour(false)`, which writes `chalk.level` and never `process.env`, and only when the
 * level would actually change; under vitest chalk already sits at 0, so it is an identity
 * operation. The file installs no hooks, so nothing is registered twice. chalk itself lives in
 * `node_modules` and is externalized, so `vi.resetModules()` does not hand the re-evaluated
 * module a second copy of it.
 */
describe('OPS-112 — the setup file still invokes the clear', () => {
  /**
   * One flag per prefix. Flags rather than key-shaped names on purpose: a dropped `apiKey` falls
   * back to `process.env` in this repo, so nothing here should put a value under a `*_API_KEY`
   * name, and every assertion below is on presence, never on a value.
   */
  const seeds = ['LANGCHAIN_TRACING_V2', 'LANGSMITH_TRACING'] as const;

  /**
   * Seed, re-evaluate `vitest.setup.ts`, and report which seeds survived. Restoration is by
   * `delete` when the name was absent — an assignment would leave the name present with the
   * string "undefined" and quietly re-arm tracing for every spec that follows in this file.
   */
  async function survivingSeedsAfterSetupReimport(): Promise<string[]> {
    const priorlyPresent = seeds.filter((name) => name in process.env);
    const priorValues = new Map(priorlyPresent.map((name) => [name, process.env[name]]));
    for (const name of seeds) process.env[name] = 'true';

    try {
      vi.resetModules();
      await import('../vitest.setup.js');
      return seeds.filter((name) => name in process.env);
    } finally {
      for (const name of seeds) {
        if (priorValues.has(name)) process.env[name] = priorValues.get(name);
        else delete process.env[name];
      }
      vi.resetModules();
    }
  }

  it('takes a seeded tracing variable back out when the module is evaluated', async () => {
    const survivors = await survivingSeedsAfterSetupReimport();

    // Absence, asserted as `in`, is what discriminates a delete from an assignment of undefined —
    // and a surviving seed here means the module body no longer calls clearLangSmithEnv, because
    // this test put the variables there itself a moment earlier.
    expect(survivors, 'vitest.setup.ts evaluated without clearing the seeded variables').toEqual(
      []
    );
  });

  it('leaves nothing behind for the specs that run after it', async () => {
    // Seeds through the helper itself rather than relying on the cell above having run first.
    // Reading process.env without seeding it passes on any machine that exports no tracing
    // variables — which is every CI cell — so under a `.concurrent`, a reorder, or the deletion
    // of the cell above, that form would go on passing while the restore was never exercised at
    // all. That is the unfailable assertion this whole block exists to avoid, so the call below
    // is not redundant with the previous cell: it is what gives this assertion something to be
    // wrong about, and it must not be removed as duplication.
    await survivingSeedsAfterSetupReimport();

    // A regressed restore would switch tracing on for the rest of this file — the exact condition
    // OPS-30 exists to prevent. `in` is what discriminates a delete from an assignment of
    // undefined, which would leave the name present carrying the string "undefined".
    for (const name of seeds) {
      expect(name in process.env, `${name} leaked out of the re-import cell`).toBe(false);
    }
  });

  it('is still the file the vitest config declares as a setup file', () => {
    // A complement to the cells above, covering a different mutation: they prove the file clears
    // the environment when evaluated, and this proves the root vitest config still declares it as
    // a setup file. The assertion is a read of the config text, so what it establishes is the
    // declaration — not that the runner resolved the entry and evaluated it. Deleting or
    // repointing the setupFiles entry leaves the file itself perfectly correct and every other
    // cell here green, while no spec is protected any more.
    const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
    const setupFile = fileURLToPath(new URL('../vitest.setup.ts', import.meta.url));
    const config = readFileSync(resolve(repoRoot, 'vitest.config.ts'), 'utf8');

    const entries = config.match(/setupFiles:\s*\[([^\]]*)\]/);
    expect(entries, 'no setupFiles array found in vitest.config.ts').not.toBeNull();

    // Both sides go through resolve()/fileURLToPath rather than comparing a POSIX literal, so the
    // Windows cell compares the same separators the rest of the suite does.
    const resolved = [...entries![1].matchAll(/['"]([^'"]+)['"]/g)].map((match) =>
      resolve(repoRoot, match[1])
    );
    expect(resolved).toContain(setupFile);
  });
});
