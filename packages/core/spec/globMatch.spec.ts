import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compileGlob, compileGlobList } from '#src/utils/globMatch.js';

/**
 * CFG-70 — the path glob matcher.
 *
 * This file deliberately imports `node:fs` and NOT `node:path`: the module under test bans that
 * import, and a spec that resolved its own fixture paths through `join`/`resolve` would be
 * asserting a rule it breaks. `new URL(…, import.meta.url)` resolves relatively with no path
 * module at all.
 */
const GLOB_MATCH_SOURCE = new URL('../src/utils/globMatch.ts', import.meta.url);
const THIS_SPEC_SOURCE = new URL('./globMatch.spec.ts', import.meta.url);

/**
 * Matches an import of node's path module in any spelling TypeScript accepts here: a static import
 * clause, a dynamic import call, or a require call, naming either the prefixed or the bare
 * specifier — a detector that recognised only the prefixed one would wave through a file that
 * wrote the bare form, which is the same defect.
 *
 * The forbidden specifiers are deliberately NOT written out anywhere in this file: the two cells
 * below scan this file's own source, so a prose example would fail them. The control cell proves
 * the detector works by assembling the specifiers at run time.
 */
const PATH_MODULE_IMPORT = /(?:from|import|require)\s*\(?\s*['"](?:node:)?path(?:\/\w+)?['"]/;

describe('CFG-70 globMatch: the vocabulary', () => {
  it('`**` crosses a separator and `*` does not — on the same path', () => {
    const path = 'packages/core/src/utils/globMatch.ts';
    expect(compileGlob('packages/**/globMatch.ts').test(path)).toBe(true);
    expect(compileGlob('packages/*/globMatch.ts').test(path)).toBe(false);
  });

  it('`*` matches within one segment', () => {
    expect(compileGlob('packages/*/index.ts').test('packages/core/index.ts')).toBe(true);
    expect(compileGlob('src/*.ts').test('src/main.ts')).toBe(true);
    expect(compileGlob('src/*.ts').test('src/nested/main.ts')).toBe(false);
  });

  it('`?` matches exactly one character and never a separator', () => {
    expect(compileGlob('src/a?c.ts').test('src/abc.ts')).toBe(true);
    expect(compileGlob('src/a?c.ts').test('src/ac.ts')).toBe(false);
    expect(compileGlob('src/a?c.ts').test('src/abbc.ts')).toBe(false);
    expect(compileGlob('src?main.ts').test('src/main.ts')).toBe(false);
  });

  it('`{a,b}` alternates, and nests', () => {
    const pattern = compileGlob('packages/{core,agent}/src/**');
    expect(pattern.test('packages/core/src/x.ts')).toBe(true);
    expect(pattern.test('packages/agent/src/x.ts')).toBe(true);
    expect(pattern.test('packages/review/src/x.ts')).toBe(false);

    const nested = compileGlob('src/**/*.{ts,{tsx,mts}}');
    expect(nested.test('src/a/b.ts')).toBe(true);
    expect(nested.test('src/a/b.tsx')).toBe(true);
    expect(nested.test('src/a/b.mts')).toBe(true);
    expect(nested.test('src/a/b.js')).toBe(false);
  });

  it('an unclosed `{` is a literal brace, not a parse failure', () => {
    expect(compileGlob('src/{weird.ts').test('src/{weird.ts')).toBe(true);
    expect(compileGlob('src/{weird.ts').test('src/weird.ts')).toBe(false);
  });

  it('a leading `!` is consumed as negation and never applied by `test`', () => {
    const negative = compileGlob('!packages/core/**');
    expect(negative.negated).toBe(true);
    expect(negative.pattern).toBe('packages/core/**');
    // `test` answers "does the pattern match", NOT "is this path excluded" — the caller applies
    // the sense. A `test` that inverted here would make every list question read backwards.
    expect(negative.test('packages/core/src/x.ts')).toBe(true);

    expect(compileGlob('packages/core/**').negated).toBe(false);
  });

  it('matching is case-sensitive', () => {
    expect(compileGlob('packages/Core/**').test('packages/core/x.ts')).toBe(false);
    expect(compileGlob('packages/Core/**').test('packages/Core/x.ts')).toBe(true);
  });

  it('a `**` that is not a whole segment stays inside the segment', () => {
    // `**.ts` is `*.ts`: only a segment that is exactly `**` crosses a separator.
    expect(compileGlob('src/**.ts').test('src/main.ts')).toBe(true);
    expect(compileGlob('src/**.ts').test('src/nested/main.ts')).toBe(false);
    expect(compileGlob('src/a**b').test('src/axyzb')).toBe(true);
    expect(compileGlob('src/a**b').test('src/a/b')).toBe(false);
  });

  it('a trailing `**` matches zero segments as well as many', () => {
    const pattern = compileGlob('packages/core/**');
    expect(pattern.test('packages/core')).toBe(true);
    expect(pattern.test('packages/core/src/deeply/nested.ts')).toBe(true);
  });

  it('a leading `**` matches at any depth, including zero', () => {
    const pattern = compileGlob('**/build/**');
    expect(pattern.test('build/out.js')).toBe(true);
    expect(pattern.test('packages/agent/build/out.js')).toBe(true);
    expect(pattern.test('packages/agent/src/out.js')).toBe(false);
  });
});

describe('CFG-70 globMatch: a sibling prefix is not a match', () => {
  it('a directory pattern does not match a longer sibling directory name', () => {
    // The silent mis-scope this matcher exists to prevent: a naive "prefix, then anything"
    // implementation attaches vue-ui's guidelines to every review of vue-ui-legacy.
    const pattern = compileGlob('packages/vue-ui/**');
    expect(pattern.test('packages/vue-ui/src/Button.vue')).toBe(true);
    expect(pattern.test('packages/vue-ui-legacy/src/Button.vue')).toBe(false);
    expect(pattern.test('packages/vue-ui.backup/src/Button.vue')).toBe(false);
  });
});

describe('CFG-70 globMatch: characters outside the vocabulary are literal', () => {
  it('a `.` matches only a dot', () => {
    expect(compileGlob('src/a.b').test('src/a.b')).toBe(true);
    expect(compileGlob('src/a.b').test('src/axb')).toBe(false);
  });

  it('regex syntax in a pattern has no regex meaning', () => {
    expect(compileGlob('src/(a|b).ts').test('src/(a|b).ts')).toBe(true);
    expect(compileGlob('src/(a|b).ts').test('src/a.ts')).toBe(false);
    expect(compileGlob('src/[abc].ts').test('src/[abc].ts')).toBe(true);
    expect(compileGlob('src/[abc].ts').test('src/a.ts')).toBe(false);
    expect(compileGlob('src/a+.ts').test('src/a+.ts')).toBe(true);
    expect(compileGlob('src/a+.ts').test('src/aaa.ts')).toBe(false);
    expect(compileGlob('src/x$.ts').test('src/x$.ts')).toBe(true);
  });
});

describe('CFG-70 globMatch: pattern lists answer the two questions separately', () => {
  it('splits a list on the leading `!` so no caller re-parses it', () => {
    const list = compileGlobList([
      'packages/agent/**',
      '!packages/agent/**/build/**',
      'shared/*.ts',
    ]);

    expect(list.matchesPositive('packages/agent/src/x.ts')).toBe(true);
    expect(list.matchesNegative('packages/agent/src/x.ts')).toBe(false);

    expect(list.matchesPositive('packages/agent/gen/build/out.js')).toBe(true);
    expect(list.matchesNegative('packages/agent/gen/build/out.js')).toBe(true);

    expect(list.matchesPositive('shared/util.ts')).toBe(true);
    expect(list.matchesNegative('shared/util.ts')).toBe(false);

    expect(list.matchesPositive('docs/readme.md')).toBe(false);
  });

  it('a list of only negative patterns has no positive match', () => {
    const list = compileGlobList(['!packages/agent/**']);
    expect(list.matchesPositive('packages/agent/src/x.ts')).toBe(false);
    expect(list.matchesNegative('packages/agent/src/x.ts')).toBe(true);
  });
});

describe('CFG-70 globMatch: bounded time', () => {
  /**
   * Generous enough that a loaded CI runner cannot flake it, and far below the failure being
   * guarded against: the regex implementation this replaced took 163 SECONDS on the sibling-star
   * case below, so a real regression here is three to six orders of magnitude over the budget, not
   * a near miss.
   */
  const BUDGET_MS = 100;

  const longPath = `${Array.from({ length: 400 }, (_, index) => `segment${index}`).join('/')}/file.tsx`;

  it('resolves deep `**` runs with nested alternation against a long non-matching path', () => {
    const pattern = compileGlob('**/**/**/**/**/**/**/**/**/**/{a,{b,{c,d}}}*x*y*z/**/*.ts');
    const started = performance.now();
    expect(pattern.test(longPath)).toBe(false);
    expect(performance.now() - started).toBeLessThan(BUDGET_MS);
  });

  it('resolves a run of sibling `*` in one segment against a long non-matching segment', () => {
    // Nesting is not required for catastrophic backtracking: sibling `[^/]*` separated by literals
    // is enough, and this is the shape that actually hung.
    const pattern = compileGlob(`pkg/${'a*'.repeat(16)}b/x.ts`);
    const subject = `pkg/${'a'.repeat(255)}/x.ts`;
    const started = performance.now();
    expect(pattern.test(subject)).toBe(false);
    expect(performance.now() - started).toBeLessThan(BUDGET_MS);
  });

  it('still matches the sibling-`*` shape when it should', () => {
    // The bounded-time cells above both assert `false`; without this one, a matcher that always
    // returned false would pass them.
    expect(compileGlob('pkg/a*b*c/x.ts').test('pkg/aQQbZZc/x.ts')).toBe(true);
  });
});

describe('CFG-70 globMatch: the win32 import ban', () => {
  it('the detector below actually fires on an import it must catch', () => {
    // Assembled rather than written out, so this control cannot itself trip the two cells that
    // scan this file's source.
    const forbidden = `node:${'path'}`;
    expect(PATH_MODULE_IMPORT.test(`import { join } from '${forbidden}';`)).toBe(true);
    expect(PATH_MODULE_IMPORT.test(`const { join } = require('${forbidden}');`)).toBe(true);
    expect(PATH_MODULE_IMPORT.test(`const p = await import('${forbidden}');`)).toBe(true);
    // The bare specifier is the same defect and must not slip through.
    expect(PATH_MODULE_IMPORT.test(`import { join } from '${'path'}';`)).toBe(true);
    // …and an unrelated module that merely contains the word must not trip it.
    expect(PATH_MODULE_IMPORT.test(`import { x } from '#src/utils/pathish.js';`)).toBe(false);
  });

  it('globMatch.ts never imports node:path', () => {
    // Diff paths are POSIX by construction; routing one through join/resolve reds only on the
    // win32 CI cell, which a local run can never reach. The import ban is the durable guard.
    expect(PATH_MODULE_IMPORT.test(readFileSync(GLOB_MATCH_SOURCE, 'utf8'))).toBe(false);
  });

  it('this spec never imports node:path either', () => {
    expect(PATH_MODULE_IMPORT.test(readFileSync(THIS_SPEC_SOURCE, 'utf8'))).toBe(false);
  });
});
