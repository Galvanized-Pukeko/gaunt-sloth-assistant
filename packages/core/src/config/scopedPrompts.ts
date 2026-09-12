/**
 * @packageDocumentation
 * CFG-70 — **the selector for path-scoped prompt segments**: given the paths a diff touches and
 * the user's `prompts.paths` list, which entries apply?
 *
 * The selection is **deterministic and pre-inference** — no model, no tool call, no filesystem.
 * That is the whole point of the feature: a monorepo review attaches per-module guidelines because
 * of what the diff contains, not because something guessed.
 *
 * ## Purity is a constraint, not a happy accident
 *
 * This module imports nothing but a type and the glob matcher, by its deep path. It must never
 * reach `llmUtils` (which imports `#src/config.js`), the config loader, or `node:fs`: file
 * resolution for a selected entry belongs in core's prompt-reading layer, which knows about the
 * config dir, identity profiles and `noDefaultPrompts`. Keeping selection free of all of that is
 * what lets the review package select without importing the config system, and what makes every
 * rule below testable as a function of its two arguments.
 */
import type { ScopedPromptsEntry } from '#src/config/types.js';
import { compileGlobList } from '#src/utils/globMatch.js';

/**
 * Select the scoped entries a diff's paths activate.
 *
 * An entry is selected when **at least one positive pattern matches at least one changed path and
 * no negative (`!`) pattern matches that same path.** Negation is therefore evaluated *per path*,
 * not per entry: excluding a module's generated build directory stops a generated file pulling the
 * entry in, while a real source file in the same module still does. Evaluating it per entry
 * instead would let one excluded path veto the whole entry, which is not what a user writing an
 * exclusion means.
 *
 * An entry whose `match` contains only negative patterns can never be selected — there is no
 * positive pattern to match. That follows from the rule rather than being special-cased, and it is
 * left as a selection outcome rather than a config error: the schema's job is the shape of an
 * entry, not whether the user's globs are useful.
 *
 * The result is in **config order**, never match order. The user controls the ordering, and an
 * order derived from which path happened to match first would change with the diff.
 *
 * Nothing is de-duplicated: the entry list is the user's, and two entries naming the same file are
 * two entries they chose to write.
 */
export function selectScopedPrompts(
  changedPaths: readonly string[],
  entries: readonly ScopedPromptsEntry[]
): ScopedPromptsEntry[] {
  return entries.filter((entry) => {
    const patterns = compileGlobList(entry.match);
    return changedPaths.some(
      (path) => patterns.matchesPositive(path) && !patterns.matchesNegative(path)
    );
  });
}
