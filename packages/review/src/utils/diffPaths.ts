/**
 * @packageDocumentation
 * CFG-70 — **the paths a unified diff touches**, read from its `diff --git` header lines.
 *
 * It lives in the review package rather than in core because it is diff-specific: nothing else in
 * the product has a unified diff to read, and a "generic path extractor" in core would invite a
 * second, differently-wrong caller.
 *
 * ## Only the `diff --git` line, deliberately
 *
 * The `---` and `+++` lines are NOT read. On an addition the `---` line says `/dev/null`, and on a
 * deletion the `+++` line does; a parser that read them would either emit `/dev/null` as a changed
 * path or need a special case to suppress it. The `diff --git` line names both real paths on every
 * kind of change, additions and deletions included, so reading it alone makes `/dev/null` an
 * absence rather than a case.
 *
 * A **rename** yields two different paths on that one line, and **both count**: the guidelines for
 * the module a file left are as relevant to reviewing the move as the guidelines for the module it
 * arrived in.
 *
 * ## Quoting — measured against real git output, not reasoned out
 *
 * Git quotes a path in the header when it contains a byte outside printable ASCII (under the
 * default `core.quotePath=true`), a double quote, a backslash, or a control character; it then
 * writes it as a C-style quoted string with octal escapes for the individual UTF-8 **bytes**, so
 * decoding has to reassemble bytes before decoding text. **When either side needs quoting, git
 * quotes both**, so a header either opens with a quote or contains none.
 *
 * ## The space case, and what this heuristic cannot do
 *
 * A space does **not** trigger quoting: git writes `diff --git a/pkg/with space.ts b/pkg/with
 * space.ts` unquoted, and the separator between the two paths is itself a space. The two are
 * genuinely indistinguishable in the general case, so this is a heuristic and is documented as one:
 *
 * - **Preferred rule — equal halves.** Among the candidate split points (every occurrence of a
 *   space followed by `b/`), one where the `a/` side and the `b/` side are the same path is taken.
 *   That resolves *every* non-rename header, however many spaces the path has, including the
 *   adversarial `a/pkg/a b/c.ts b/pkg/a b/c.ts` where a directory is literally named `a b`.
 * - **Fallback — the last candidate.** When no split yields equal halves the header is a rename
 *   whose two paths differ, and nothing in the line can decide it. The last candidate is taken.
 *
 * **What that cannot resolve:** a rename whose *destination* path contains a literal ` b/` — say
 * `old.ts` renamed into a directory named `x b` — splits in the wrong place and yields two paths
 * that are not the user's. Choosing the first candidate instead would merely move the failure onto
 * the source path; the information to decide is not in the line. It is left as a known limit
 * rather than papered over, and the shape is vanishingly rare: it needs a rename, a space, AND a
 * directory whose name ends in a space-delimited `b`.
 *
 * A header that does not fit the `a/… b/…` shape at all (git's `--no-prefix`, or
 * `diff.mnemonicPrefix`'s `i/`…`w/`) is **skipped**, not guessed at. A fabricated path is worse
 * than a missing one: it can pull in a scoped entry that has nothing to do with the change, and
 * nothing downstream can tell it from a real one.
 */

const DIFF_GIT_PREFIX = 'diff --git ';

/** git's C-style single-character escapes, as `unquote_c_style` reads them. */
const C_ESCAPES: Readonly<Record<string, number>> = {
  a: 0x07,
  b: 0x08,
  t: 0x09,
  n: 0x0a,
  v: 0x0b,
  f: 0x0c,
  r: 0x0d,
  '"': 0x22,
  '\\': 0x5c,
};

const utf8Decoder = new TextDecoder('utf-8');
const utf8Encoder = new TextEncoder();

/**
 * Read one C-style quoted token starting at the opening quote, returning the decoded path and the
 * index just past the closing quote — or `undefined` when the quote is never closed.
 *
 * Octal escapes are collected as raw bytes and decoded as UTF-8 at the end, because a single
 * non-ASCII character arrives as several `\NNN` escapes that are only meaningful together.
 */
function readQuotedToken(line: string, start: number): { value: string; end: number } | undefined {
  const bytes: number[] = [];
  let index = start + 1;
  while (index < line.length) {
    const character = line[index];
    if (character === '"') {
      return { value: utf8Decoder.decode(Uint8Array.from(bytes)), end: index + 1 };
    }
    if (character === '\\') {
      const escaped = line[index + 1];
      if (escaped === undefined) return undefined;
      if (escaped >= '0' && escaped <= '7') {
        let digits = '';
        let cursor = index + 1;
        while (digits.length < 3 && line[cursor] >= '0' && line[cursor] <= '7') {
          digits += line[cursor];
          cursor++;
        }
        bytes.push(parseInt(digits, 8));
        index = cursor;
        continue;
      }
      const single = C_ESCAPES[escaped];
      if (single === undefined) return undefined;
      bytes.push(single);
      index += 2;
      continue;
    }
    for (const byte of utf8Encoder.encode(character)) bytes.push(byte);
    index++;
  }
  return undefined;
}

/** Split the unquoted `a/… b/…` remainder into its two prefixed halves — see the module docblock. */
function splitUnquotedPair(remainder: string): [string, string] | undefined {
  const candidates: number[] = [];
  for (
    let index = remainder.indexOf(' b/');
    index >= 0;
    index = remainder.indexOf(' b/', index + 1)
  )
    candidates.push(index);
  if (candidates.length === 0) return undefined;

  const halves = candidates.map(
    (index) => [remainder.slice(0, index), remainder.slice(index + 1)] as [string, string]
  );
  return (
    halves.find(([left, right]) => left.slice(2) === right.slice(2)) ?? halves[halves.length - 1]
  );
}

/** Strip the `a/` or `b/` header prefix, or report that the token never had one. */
function stripPrefix(token: string, prefix: 'a/' | 'b/'): string | undefined {
  return token.startsWith(prefix) ? token.slice(prefix.length) : undefined;
}

/**
 * Extract the repository-relative POSIX paths a unified diff touches, in the order the diff names
 * them and with duplicates removed.
 *
 * De-duplication matters because the overwhelmingly common header names the same path twice (`a/x
 * b/x`), and a caller reporting how many files a review saw would otherwise double every count.
 * A rename's two distinct paths both survive it.
 *
 * Content that is not a unified diff — a requirements document, `--content-source text` output —
 * simply yields an empty list. There is no error here: deciding what an empty result means belongs
 * to the caller, which is the only place that knows whether a diff was expected.
 */
export function extractChangedPathsFromDiff(diff: string): string[] {
  const paths = new Set<string>();

  for (const rawLine of diff.split(/\r?\n/)) {
    if (!rawLine.startsWith(DIFF_GIT_PREFIX)) continue;
    const remainder = rawLine.slice(DIFF_GIT_PREFIX.length);

    let left: string | undefined;
    let right: string | undefined;

    if (remainder.startsWith('"')) {
      const first = readQuotedToken(remainder, 0);
      if (!first || remainder[first.end] !== ' ' || remainder[first.end + 1] !== '"') continue;
      const second = readQuotedToken(remainder, first.end + 1);
      if (!second) continue;
      left = stripPrefix(first.value, 'a/');
      right = stripPrefix(second.value, 'b/');
    } else {
      const pair = splitUnquotedPair(remainder);
      if (!pair) continue;
      left = stripPrefix(pair[0], 'a/');
      right = stripPrefix(pair[1], 'b/');
    }

    if (left === undefined || right === undefined) continue;
    paths.add(left);
    paths.add(right);
  }

  return [...paths];
}
