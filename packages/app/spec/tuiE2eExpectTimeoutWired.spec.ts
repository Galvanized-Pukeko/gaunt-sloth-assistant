import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * QA-15 — every PTY e2e file must reach `fixtures/expectTimeout.mjs`.
 *
 * `tui-test` loads `tui-test.config.ts` in its main runner process and runs every matcher in a
 * worker process that never loads it, so `expect.timeout` reaches the matchers only because
 * `fixtures/expectTimeout.mjs` loads the config on the worker side. That module works by being
 * imported: a `*.tui.test.ts` file that does not reach it silently keeps the library's 5000 ms
 * fallback.
 *
 * That failure is invisible from a run. The suite stays green, because a matcher that resolves
 * quickly resolves identically under either bound — so a file added later with no import, or a
 * tidy-up that drops the one in `tmpHome.mjs`, would take two thirds of the budget away from a
 * whole file and change nothing anyone could see. This is the gate for that, and it is why the
 * import in those files is not dead weight however unused it looks.
 *
 * `expect-timeout.tui.test.ts` proves the timeout actually binds. This proves it binds *everywhere*.
 *
 * Resolved as a URL, never through a native path: a `D:\…` string is not a valid URL (OPS-39).
 */
const E2E_DIR = fileURLToPath(new URL('../tui-e2e/', import.meta.url));
const FIXTURE = 'expectTimeout.mjs';

const read = (name: string): string => readFileSync(`${E2E_DIR}${name}`, 'utf8');

/**
 * Whether a module's source imports `expectTimeout.mjs`, by any of the spellings that reach it.
 *
 * Matched on the specifier of a real `import` statement rather than on the bare filename, so a
 * mention of the module in a comment — which every one of these files carries, explaining why the
 * import is there — is not mistaken for the import itself.
 */
function importsFixture(source: string): boolean {
  return /^\s*import\s+(?:[^'"]*\sfrom\s+)?['"][^'"]*\/expectTimeout\.mjs['"]\s*;?\s*$/m.test(
    source
  );
}

describe('QA-15 the PTY e2e expect timeout is wired into every test file', () => {
  it('detects the import only when there is a real one', () => {
    // Control: without this the matcher could return true (or false) for everything and the
    // assertions below would pass whatever the suite actually contained.
    expect(importsFixture("import './fixtures/expectTimeout.mjs';")).toBe(true);
    expect(importsFixture("import './expectTimeout.mjs';")).toBe(true);
    expect(importsFixture('import "./fixtures/expectTimeout.mjs"')).toBe(true);
    expect(
      importsFixture("import { configuredExpectTimeout } from './fixtures/expectTimeout.mjs';")
    ).toBe(true);
    expect(importsFixture("import fs from 'node:fs';")).toBe(false);
    expect(importsFixture('// see fixtures/expectTimeout.mjs for why')).toBe(false);
    expect(importsFixture(' * through ./fixtures/expectTimeout.mjs')).toBe(false);
    // A file reaching it only through tmpHome.mjs has no import of its own; that link is asserted
    // separately below, and this must not paper over its absence.
    expect(
      importsFixture("import { settleSessionsAfterEach } from './fixtures/tmpHome.mjs';")
    ).toBe(false);
  });

  it('finds the PTY test files at all', () => {
    // An empty glob would make every per-file assertion below vacuously true, which is the exact
    // shape of a gate that cannot fail. The count is asserted as a floor rather than an equality so
    // adding a test file does not red this, while a rename or a moved directory does.
    expect(testFiles().length).toBeGreaterThanOrEqual(15);
  });

  it('every *.tui.test.ts file reaches the fixture, directly or through tmpHome.mjs', () => {
    const unwired = testFiles().filter((name) => {
      const source = read(name);
      return !importsFixture(source) && !/['"]\.\/fixtures\/tmpHome\.mjs['"]/.test(source);
    });
    expect(unwired).toEqual([]);
  });

  it('tmpHome.mjs imports the fixture, which is how most of them reach it', () => {
    // The link the test above accepts as sufficient for most files. Without this assertion, dropping
    // the import from tmpHome.mjs would leave that test green and the whole suite back on 5 s.
    expect(importsFixture(read('fixtures/tmpHome.mjs'))).toBe(true);
  });

  it('the fixture loads the config rather than restating a number', () => {
    // The module earns its place by calling the library's own loader, so `tui-test.config.ts` stays
    // the single place the value is written. A hardcoded number here would drift from the config
    // silently, and the config is what a reader believes.
    const source = read(`fixtures/${FIXTURE}`);
    expect(source).toMatch(/from\s+['"]@microsoft\/tui-test\/lib\/config\/config\.js['"]/);
    expect(source).toMatch(/await\s+loadConfig\(\)/);
  });
});

function testFiles(): string[] {
  return readdirSync(E2E_DIR).filter((name) => name.endsWith('.tui.test.ts'));
}
