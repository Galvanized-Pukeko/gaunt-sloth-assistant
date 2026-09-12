import { describe, expect, it } from 'vitest';
import { extractChangedPathsFromDiff } from '#src/utils/diffPaths.js';

/**
 * CFG-70 — the diff path extractor.
 *
 * Every header in this file is **copied from real `git diff` output**, produced against a scratch
 * repository holding files with the awkward names below. A hand-written fixture is where a parser
 * and its test come to share the same wrong idea about a format, and git's quoting rules in
 * particular are not something to reason out.
 */
describe('CFG-70 extractChangedPathsFromDiff', () => {
  it('reads the ordinary header', () => {
    const diff = [
      'diff --git a/packages/core/src/config.ts b/packages/core/src/config.ts',
      'index 1234567..89abcde 100644',
      '--- a/packages/core/src/config.ts',
      '+++ b/packages/core/src/config.ts',
      '@@ -1,3 +1,4 @@',
      '+const added = 1;',
    ].join('\n');
    expect(extractChangedPathsFromDiff(diff)).toEqual(['packages/core/src/config.ts']);
  });

  it('returns BOTH paths of a rename', () => {
    // Reviewing a move is reviewing two modules: the one the file left and the one it reached.
    const diff = [
      'diff --git a/pkg/old name.ts b/pkg/new name.ts',
      'similarity index 100%',
      'rename from pkg/old name.ts',
      'rename to pkg/new name.ts',
    ].join('\n');
    expect(extractChangedPathsFromDiff(diff)).toEqual(['pkg/old name.ts', 'pkg/new name.ts']);
  });

  it('never returns /dev/null, on an addition or on a deletion', () => {
    // The `---`/`+++` lines lie on both; only the `diff --git` line names the real path, which is
    // why it is the only line parsed.
    const diff = [
      'diff --git a/pkg/added file.ts b/pkg/added file.ts',
      'new file mode 100644',
      'index 0000000..257cc56',
      '--- /dev/null',
      '+++ b/pkg/added file.ts',
      'diff --git a/pkg/to delete me.ts b/pkg/to delete me.ts',
      'deleted file mode 100644',
      'index 257cc56..0000000',
      '--- a/pkg/to delete me.ts',
      '+++ /dev/null',
    ].join('\n');
    const paths = extractChangedPathsFromDiff(diff);
    expect(paths).toEqual(['pkg/added file.ts', 'pkg/to delete me.ts']);
    expect(paths).not.toContain('/dev/null');
    expect(paths.some((path) => path.includes('dev/null'))).toBe(false);
  });

  it('unquotes and decodes an octal-escaped non-ASCII path', () => {
    // core.quotePath (git's default) writes the UTF-8 BYTES of a non-ASCII character as separate
    // octal escapes, so decoding has to reassemble them before decoding text.
    const diff = 'diff --git "a/pkg/\\303\\244.ts" "b/pkg/\\303\\244.ts"';
    expect(extractChangedPathsFromDiff(diff)).toEqual(['pkg/ä.ts']);
  });

  it('decodes a quoted rename whose two sides differ', () => {
    const diff = 'diff --git "a/\\303\\244-src.ts" "b/\\303\\274mlaut.ts"';
    expect(extractChangedPathsFromDiff(diff)).toEqual(['ä-src.ts', 'ümlaut.ts']);
  });

  it('decodes the C-style escapes git uses for a quote, a backslash and a control character', () => {
    const diff = [
      'diff --git "a/pkg/quote\\".ts" "b/pkg/quote\\".ts"',
      'diff --git "a/pkg/back\\\\slash.ts" "b/pkg/back\\\\slash.ts"',
      'diff --git "a/pkg/tab\\tfile.ts" "b/pkg/tab\\tfile.ts"',
    ].join('\n');
    expect(extractChangedPathsFromDiff(diff)).toEqual([
      'pkg/quote".ts',
      'pkg/back\\slash.ts',
      'pkg/tab\tfile.ts',
    ]);
  });

  it('resolves a path containing a space, including a directory literally named "a b"', () => {
    // git leaves a space unquoted, and the separator between the two paths is also a space. The
    // equal-halves rule resolves every non-rename header, including this adversarial one where a
    // naive "first ` b/`" split yields `pkg/a` and a naive "last" split yields `pkg/a b/c.ts b/pkg/a`.
    const diff = [
      'diff --git a/pkg/with space.ts b/pkg/with space.ts',
      'diff --git a/pkg/a b/c.ts b/pkg/a b/c.ts',
    ].join('\n');
    expect(extractChangedPathsFromDiff(diff)).toEqual(['pkg/with space.ts', 'pkg/a b/c.ts']);
  });

  it('skips a header that is not in the a/… b/… shape rather than inventing a path', () => {
    // --no-prefix and diff.mnemonicPrefix produce headers this parser cannot read. A fabricated
    // path can pull in a scoped entry that has nothing to do with the change, and nothing
    // downstream can tell it from a real one — so a skip is the safe failure.
    const diff = [
      'diff --git src/x.ts src/x.ts',
      'diff --git i/src/y.ts w/src/y.ts',
      'diff --git a/src/real.ts b/src/real.ts',
    ].join('\n');
    expect(extractChangedPathsFromDiff(diff)).toEqual(['src/real.ts']);
  });

  it('de-duplicates, so a file count is not doubled by the a/b pair', () => {
    const diff = [
      'diff --git a/src/x.ts b/src/x.ts',
      'diff --git a/src/y.ts b/src/y.ts',
      'diff --git a/src/x.ts b/src/x.ts',
    ].join('\n');
    expect(extractChangedPathsFromDiff(diff)).toEqual(['src/x.ts', 'src/y.ts']);
    expect(extractChangedPathsFromDiff(diff)).toHaveLength(2);
  });

  it('reads CRLF diffs', () => {
    const diff = 'diff --git a/src/x.ts b/src/x.ts\r\n--- a/src/x.ts\r\n+++ b/src/x.ts\r\n';
    expect(extractChangedPathsFromDiff(diff)).toEqual(['src/x.ts']);
  });

  it('returns nothing for content that is not a unified diff', () => {
    const requirements = [
      '# Requirements',
      'The reviewer should check that a/foo.ts b/bar.ts is handled.',
      'See also the diff --gitignore note below.',
    ].join('\n');
    expect(extractChangedPathsFromDiff(requirements)).toEqual([]);
    expect(extractChangedPathsFromDiff('')).toEqual([]);
  });

  it('ignores a diff header that is not at the start of its line', () => {
    // A requirements document quoting a diff inside a fenced block still begins the header at the
    // start of a line, so this is not the defence against that — the caller's job is to pass ONLY
    // the content-source output. This pins that an indented or inlined mention is not a path.
    const prose = 'The convention is to write diff --git a/old b/new in the ticket.';
    expect(extractChangedPathsFromDiff(prose)).toEqual([]);
  });
});
