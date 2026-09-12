/**
 * @packageDocumentation
 * CFG-70 — **the path glob matcher for `prompts.paths`**, and the only one in this repo that
 * matches a *repository-relative POSIX path* with a `/` boundary.
 *
 * ## Why a third matcher and not a reuse
 *
 * Neither existing `globToRegExp` means what this one has to mean, and reusing either would
 * mis-scope silently rather than fail:
 *
 * - `core/approvals/matcher.ts` matches **shell command strings** — there is no `/` boundary
 *   there, so `packages/x/*` would happily span directories.
 * - `agent/tools/gthGrepTool.ts` matches **basenames only**, and documents its own divergence
 *   from ripgrep.
 *
 * A scoped prompt entry that matched more of the tree than the user wrote would attach one
 * module's guidelines to another module's review, which is precisely the failure the feature
 * exists to prevent.
 *
 * ## The vocabulary
 *
 * | written | means |
 * |---|---|
 * | `**` as a WHOLE segment | zero or more path segments — the only construct that crosses `/` |
 * | `*` | zero or more characters **within one segment** |
 * | `?` | exactly one character within one segment |
 * | `{a,b}` | alternation; nests (`{a,{b,c}}`) |
 * | leading `!` | marks the pattern NEGATIVE (see {@link CompiledGlob.negated}) |
 *
 * Everything else is a literal, including `\` — there is **no escape character**. A path that
 * genuinely begins with `!`, or contains a literal `*`, `?` or `{`, cannot be written as a
 * pattern. That is a deliberate floor: an escape grammar is a second thing to get wrong, and
 * neither shape occurs in a source tree worth scoping guidelines to.
 *
 * Matching is **case-sensitive**, and both patterns and paths are POSIX — `/` separated, always.
 *
 * ## Three hard constraints, each with its own spec cell
 *
 * **1. This module must never import `node:path`.** The paths it matches come from a unified diff,
 * where they are POSIX by construction. Routing one through `join`/`resolve` would normalise it to
 * the host separator: identical on Linux and macOS, backslash-separated on win32, where every
 * pattern then stops matching. That is this repository's recurring five-cell CI failure (OPS-27,
 * EXT-38, GS2-42, EXT-16), and a spec can only red on win32 if it *runs* there — so the durable
 * guard is the import ban itself, asserted by reading this file's source rather than by behaviour.
 *
 * **2. No catastrophic backtracking — which is why nothing here compiles to a regular expression
 * at all.** The obvious implementation turns a pattern into one regex, and it is measurably
 * unusable: `pkg/a*a*a*a*a*a*a*a*b/x.ts` against a 255-character non-matching segment took **163
 * seconds** in this repo before this module was rewritten. Nesting is not required for that — a
 * run of sibling `[^/]*` separated by literals backtracks over every way to distribute the
 * characters between them, which is polynomial in the segment length with the star count as the
 * exponent. Escaping and `**`-avoidance do not help; the engine is the problem.
 *
 * So a pattern compiles to **tokens**, and matching is a forward sweep over a *set of reachable
 * positions* rather than a search with backtracking:
 *
 * - within a segment, `advanceTokens` carries a set of positions through the token list — a star
 *   widens the set to every remaining offset, a literal or `?` advances the positions that fit,
 *   an alternation unions its options. A position reached twice is stored once, which is exactly
 *   what a backtracking engine fails to do and why it re-explores;
 * - across segments, `matchSegments` resolves `**` with the classic single-backtrack-point
 *   wildcard walk.
 *
 * Both are O(pattern × subject) with no exponential case, so the bounded-time spec cell holds for
 * any pattern a user can write, not merely for the shapes it happens to name.
 *
 * **3. A character outside the vocabulary above is a literal, by construction.** Because no regex
 * is emitted there is nothing to escape: a `.` in a pattern is compared with string equality to a
 * `.` in the path, and a `(`, `[`, `+` or `$` cannot mean anything at all. This is the same
 * guarantee an escaping implementation aims at, reached by removing the mechanism that needs it.
 */

/**
 * One unit of a compiled segment. Deliberately not a regex fragment — see constraint 2 above.
 * Adjacent literal characters are merged into a single `literal` token so a long literal run costs
 * one comparison rather than one per character.
 */
type GlobToken =
  | { kind: 'star' }
  | { kind: 'any' }
  | { kind: 'literal'; text: string }
  | { kind: 'alternation'; options: GlobToken[][] };

/**
 * Parse the body of one segment (or of one brace alternative) into tokens, stopping at the first
 * character of `stopAt` seen at this brace depth. Nested braces are consumed by the recursive
 * `parseAlternation` call below, so a `,` belonging to an inner alternation is never mistaken for
 * a terminator of the outer one.
 */
function parseTokens(
  segment: string,
  start: number,
  stopAt: string
): { tokens: GlobToken[]; end: number } {
  const tokens: GlobToken[] = [];
  let literal = '';
  const flush = () => {
    if (literal) {
      tokens.push({ kind: 'literal', text: literal });
      literal = '';
    }
  };

  let index = start;
  while (index < segment.length) {
    const character = segment[index];
    if (stopAt.includes(character)) break;
    if (character === '*') {
      // Consecutive `*` collapse to ONE star. Under the position-set sweep this is a
      // NORMALISATION and not a correctness mechanism — adjacent stars are idempotent there, so
      // removing this loop changes no result, and a mutation that removes it survives the suite
      // deliberately. It is kept because it bounds the token count: without it a pattern of a
      // thousand stars in one segment costs a thousand set fills to mean exactly `*`.
      //
      // `**` inside a larger segment (`**.ts`, `a**b`) therefore degrades to `*` and stays within
      // the segment. The decision that a segment CROSSES a separator is not made here at all — it
      // is `compileSegment`'s exact match on `**`, so it is a property of the whole segment rather
      // than of a character run.
      while (index < segment.length && segment[index] === '*') index++;
      flush();
      tokens.push({ kind: 'star' });
      continue;
    }
    if (character === '?') {
      flush();
      tokens.push({ kind: 'any' });
      index++;
      continue;
    }
    if (character === '{') {
      const alternation = parseAlternation(segment, index);
      if (alternation) {
        flush();
        tokens.push(alternation.token);
        index = alternation.end;
        continue;
      }
      // Unbalanced `{` — the user wrote a literal brace, so match one.
      literal += character;
      index++;
      continue;
    }
    literal += character;
    index++;
  }

  flush();
  return { tokens, end: index };
}

/**
 * Parse a `{a,b}` alternation starting at the `{` in `segment[start]`, or return `undefined` when
 * it is never closed.
 */
function parseAlternation(
  segment: string,
  start: number
): { token: GlobToken; end: number } | undefined {
  const options: GlobToken[][] = [];
  let index = start + 1;
  for (;;) {
    const parsed = parseTokens(segment, index, ',}');
    options.push(parsed.tokens);
    index = parsed.end;
    if (index >= segment.length) return undefined;
    if (segment[index] === ',') {
      index++;
      continue;
    }
    return { token: { kind: 'alternation', options }, end: index + 1 };
  }
}

/**
 * Every offset in `text` reachable after consuming `token`, starting from any offset in
 * `positions`. Carrying a *set* is what removes the backtracking: an offset two different
 * alternatives both reach is explored once, not twice.
 */
function advanceToken(token: GlobToken, text: string, positions: ReadonlySet<number>): Set<number> {
  const next = new Set<number>();
  switch (token.kind) {
    case 'literal':
      for (const position of positions) {
        if (text.startsWith(token.text, position)) next.add(position + token.text.length);
      }
      return next;
    case 'any':
      for (const position of positions) {
        if (position < text.length) next.add(position + 1);
      }
      return next;
    case 'star': {
      // The segment holds no `/`, so a star reaches every offset at or after the earliest one it
      // could start from — computed once for the whole set rather than per position.
      let earliest = text.length;
      for (const position of positions) if (position < earliest) earliest = position;
      for (let position = earliest; position <= text.length; position++) next.add(position);
      return next;
    }
    case 'alternation':
      for (const option of token.options) {
        for (const position of advanceTokens(option, text, positions)) next.add(position);
      }
      return next;
  }
}

/** Fold {@link advanceToken} along a token list. */
function advanceTokens(
  tokens: readonly GlobToken[],
  text: string,
  positions: ReadonlySet<number>
): ReadonlySet<number> {
  let reachable = positions;
  for (const token of tokens) {
    if (reachable.size === 0) return reachable;
    reachable = advanceToken(token, text, reachable);
  }
  return reachable;
}

/** `null` marks a `**` segment; every other segment compiles to a predicate over one segment. */
type SegmentMatcher = ((text: string) => boolean) | null;

function compileSegment(segment: string): SegmentMatcher {
  if (segment === '**') return null;
  const { tokens } = parseTokens(segment, 0, '');
  return (text: string) => advanceTokens(tokens, text, new Set([0])).has(text.length);
}

/**
 * Walk the path's segments against the pattern's, resolving `**` as zero-or-more segments.
 *
 * The classic wildcard walk: match greedily, and on a mismatch fall back to the MOST RECENT `**`
 * and let it consume one more segment. One backtrack point is provably sufficient however many
 * `**` a pattern carries, which is what keeps this O(pathSegments × patternSegments) instead of
 * exponential — see constraint 2 in this module's docblock.
 *
 * A trailing `**` therefore matches zero segments too: `a/**` matches `a` as well as `a/b/c`. The
 * paths this sees are files from a diff, so the directory-itself case is theoretical; it is
 * documented rather than special-cased because a special case is another thing to get wrong.
 */
function matchSegments(pattern: readonly SegmentMatcher[], path: readonly string[]): boolean {
  let patternIndex = 0;
  let pathIndex = 0;
  let lastGlobstar = -1;
  let lastGlobstarPath = -1;

  while (pathIndex < path.length) {
    if (patternIndex < pattern.length && pattern[patternIndex] === null) {
      lastGlobstar = patternIndex;
      lastGlobstarPath = pathIndex;
      patternIndex++;
      continue;
    }
    if (patternIndex < pattern.length && pattern[patternIndex]!(path[pathIndex])) {
      patternIndex++;
      pathIndex++;
      continue;
    }
    if (lastGlobstar < 0) return false;
    lastGlobstarPath++;
    pathIndex = lastGlobstarPath;
    patternIndex = lastGlobstar + 1;
  }

  while (patternIndex < pattern.length && pattern[patternIndex] === null) patternIndex++;
  return patternIndex === pattern.length;
}

/** One compiled pattern: whether it negates, and the test it applies to a path. */
export interface CompiledGlob {
  /** `true` when the pattern was written with a leading `!`. */
  readonly negated: boolean;
  /** The pattern as written, minus any leading `!`. */
  readonly pattern: string;
  /** Does this pattern match `path`? Negation is NOT applied here — see `negated` above. */
  test(path: string): boolean;
}

/**
 * A pattern list compiled once, answering the two questions a caller actually has. Keeping both
 * on one object is what stops a caller re-deriving the meaning of a leading `!` for itself: a
 * second reading of the negation rule is a second place for it to drift.
 */
export interface CompiledGlobList {
  /** Does any pattern written WITHOUT a leading `!` match `path`? */
  matchesPositive(path: string): boolean;
  /** Does any pattern written WITH a leading `!` match `path`? */
  matchesNegative(path: string): boolean;
}

/**
 * Compile one glob pattern. A leading `!` is consumed here and reported as
 * {@link CompiledGlob.negated}; `test` answers only whether the remaining pattern matches, so the
 * caller never re-parses the `!`.
 */
export function compileGlob(pattern: string): CompiledGlob {
  const negated = pattern.startsWith('!');
  const body = negated ? pattern.slice(1) : pattern;
  const segments = body.split('/').map(compileSegment);
  return {
    negated,
    pattern: body,
    test: (path: string) => matchSegments(segments, path.split('/')),
  };
}

/** Compile a whole pattern list once, for repeated questions about many paths. */
export function compileGlobList(patterns: readonly string[]): CompiledGlobList {
  const compiled = patterns.map(compileGlob);
  const positive = compiled.filter((entry) => !entry.negated);
  const negative = compiled.filter((entry) => entry.negated);
  return {
    matchesPositive: (path: string) => positive.some((entry) => entry.test(path)),
    matchesNegative: (path: string) => negative.some((entry) => entry.test(path)),
  };
}
