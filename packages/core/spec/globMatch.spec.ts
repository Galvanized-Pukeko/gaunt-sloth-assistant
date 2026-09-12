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

  it('`*` matches ZERO characters, not only one or more', () => {
    // The vocabulary table says "zero or more", and every other star in this file consumes at
    // least one character — so a matcher that quietly required one would pass the whole suite.
    // The shape that actually bites is a star FLANKED by literals, which is how a user writes
    // "optionally qualified": `*vue*` is written to catch `vue-ui` and `my-vue`, and a star that
    // could not match the empty string would drop plain `vue` — the one segment the author was
    // most certainly thinking of — without any error to notice.
    const flanked = compileGlob('packages/*vue*/**');
    expect(flanked.test('packages/vue/Button.vue')).toBe(true);
    expect(flanked.test('packages/vue-ui/Button.vue')).toBe(true);
    expect(flanked.test('packages/my-vue/Button.vue')).toBe(true);
    // The literals still have to be present, so an always-true matcher cannot satisfy this cell.
    expect(flanked.test('packages/vu/Button.vue')).toBe(false);
    expect(flanked.test('packages/core/Button.vue')).toBe(false);

    // Both stars empty at once, and the same pattern with them non-empty.
    expect(compileGlob('src/a*b.ts').test('src/ab.ts')).toBe(true);
    expect(compileGlob('src/a*b.ts').test('src/axyzb.ts')).toBe(true);
    expect(compileGlob('src/a*b.ts').test('src/ac.ts')).toBe(false);

    // Derived from the same rule rather than a separate decision: there is no leading-dot
    // exception in the vocabulary, so a leading star matches the empty prefix like any other.
    expect(compileGlob('src/*.ts').test('src/.ts')).toBe(true);
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

  /**
   * The other half of that row in the module's vocabulary table: everything outside the vocabulary
   * is a literal **including `\`**, because there is no escape character at all.
   *
   * The `.`/`(`/`[`/`+`/`$` cells above pin "everything else is literal"; none of them pins the
   * no-escape half, and no pattern anywhere else in this file contains a backslash. A mutation
   * teaching the parser to treat `\` as an escape therefore survived the entire suite while
   * changing what `a\*b` means.
   *
   * Asserted in the shape a user actually produces it, not only as the abstract rule: a Windows
   * habit writes `packages\vue-ui\**`, and under this vocabulary that is one long literal segment
   * name that matches nothing. **A silent non-match, never an error** — which is the behaviour to
   * know about, and the reason the docs say patterns are POSIX.
   */
  it('a `\\` is a literal, because there is no escape character', () => {
    // The Windows-habit pattern against the path a diff actually carries. There is no `/` in the
    // pattern, so it is ONE segment whose `\` are ordinary characters — it cannot match a path
    // whose separators are real separators. Silent, and the reason the docs say patterns are POSIX.
    expect(compileGlob('packages\\vue-ui\\**').test('packages/vue-ui/src/Button.vue')).toBe(false);
    // It is a literal rather than a parse failure, which is what makes the miss silent: the
    // trailing `**` is inside a larger segment and so degrades to `*`, leaving a pattern that does
    // match a backslash-separated string — a shape `extractChangedPathsFromDiff` never produces.
    expect(compileGlob('packages\\vue-ui\\**').test('packages\\vue-ui\\src\\Button.vue')).toBe(
      true
    );
    expect(compileGlob('packages\\vue-ui\\**').test('packages\\other\\src\\Button.vue')).toBe(
      false
    );

    // And a backslash does not escape the star beside it. In `src/a\*b.ts` the `\` is one more
    // literal character the path must contain, and the `*` keeps its wildcard meaning — so the
    // pattern matches a path with a real backslash in it...
    expect(compileGlob('src/a\\*b.ts').test('src/a\\xyzb.ts')).toBe(true);
    // ...and does NOT match the path an escape grammar would make it mean, a literal asterisk.
    // This pair is the whole assertion: a parser that learned to treat `\` as an escape flips both
    // of these, and nothing else in the suite would notice.
    expect(compileGlob('src/a\\*b.ts').test('src/a*b.ts')).toBe(false);
    expect(compileGlob('src/a\\*b.ts').test('src/axyzb.ts')).toBe(false);
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
   * Generous enough that a cold or loaded CI runner cannot flake it, and still far below the
   * failure being guarded against: the regex implementation this replaced took 163 SECONDS on the
   * sibling-star case below, so a real regression here is over two orders of magnitude past the
   * budget, not a near miss. A thin budget on a Windows cell reads green until it does not, and the
   * measured cost here is well under a millisecond — headroom costs nothing and buys the whole
   * difference between a live cell and a flaky one.
   */
  const BUDGET_MS = 1000;

  const longPath = `${Array.from({ length: 400 }, (_, index) => `segment${index}`).join('/')}/file.tsx`;

  it('resolves deep `**` runs with nested alternation against a long non-matching path', () => {
    const pattern = compileGlob('**/**/**/**/**/**/**/**/**/**/{a,{b,{c,d}}}*x*y*z/**/*.ts');
    // The clock stops before the matcher runs: an `expect` call inside the timed region measures
    // vitest as well as the code under test, which is the half of the reading that a loaded runner
    // actually moves.
    const started = performance.now();
    const matched = pattern.test(longPath);
    const elapsed = performance.now() - started;
    expect(matched).toBe(false);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('resolves a run of sibling `*` in one segment against a long non-matching segment', () => {
    // Nesting is not required for catastrophic backtracking: sibling `[^/]*` separated by literals
    // is enough, and this is the shape that actually hung.
    const pattern = compileGlob(`pkg/${'a*'.repeat(16)}b/x.ts`);
    const subject = `pkg/${'a'.repeat(255)}/x.ts`;
    const started = performance.now();
    const matched = pattern.test(subject);
    const elapsed = performance.now() - started;
    expect(matched).toBe(false);
    expect(elapsed).toBeLessThan(BUDGET_MS);
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
