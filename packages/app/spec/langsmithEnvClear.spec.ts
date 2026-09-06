import { describe, it, expect } from 'vitest';
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
