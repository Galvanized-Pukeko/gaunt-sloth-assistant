import { describe, expect, it } from 'vitest';
import type { ScopedPromptsEntry } from '#src/config.js';
import { selectScopedPrompts } from '#src/config.js';

/**
 * CFG-70 — `selectScopedPrompts`, imported through the core config BARREL rather than through
 * `config/scopedPrompts.js`. The review package re-exports that barrel wholesale, so this is the
 * path an embedder actually takes; importing the module directly would leave a dropped barrel
 * export undetected here.
 */
const names = (entries: ScopedPromptsEntry[]) => entries.map((entry) => entry.name);

describe('CFG-70 selectScopedPrompts', () => {
  it('selects an entry when a changed path matches one of its positive patterns', () => {
    const entries: ScopedPromptsEntry[] = [
      { name: 'vue-ui', match: ['packages/vue-ui/**'], guidelines: 'vue.md' },
      { name: 'adk', match: ['packages/adk/**'], guidelines: 'adk.md' },
    ];
    expect(names(selectScopedPrompts(['packages/vue-ui/src/Button.vue'], entries))).toEqual([
      'vue-ui',
    ]);
  });

  it('selects nothing when no path matches, and nothing when there are no paths', () => {
    const entries: ScopedPromptsEntry[] = [{ name: 'vue-ui', match: ['packages/vue-ui/**'] }];
    expect(selectScopedPrompts(['docs/readme.md'], entries)).toEqual([]);
    expect(selectScopedPrompts([], entries)).toEqual([]);
    expect(selectScopedPrompts(['packages/vue-ui/src/x.ts'], [])).toEqual([]);
  });

  it('returns CONFIG order, not match order', () => {
    const entries: ScopedPromptsEntry[] = [
      { name: 'alpha', match: ['alpha/**'] },
      { name: 'beta', match: ['beta/**'] },
      { name: 'gamma', match: ['gamma/**'] },
    ];
    // The paths arrive in the reverse of the config order, and a fourth path matches nothing, so
    // an implementation that walked paths and collected entries as it met them would return
    // gamma, beta, alpha.
    const selected = selectScopedPrompts(
      ['gamma/g.ts', 'beta/b.ts', 'alpha/a.ts', 'delta/d.ts'],
      entries
    );
    expect(names(selected)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('returns the entry objects themselves, so a caller can read their segments', () => {
    const entry: ScopedPromptsEntry = {
      name: 'vue-ui',
      match: ['packages/vue-ui/**'],
      guidelines: 'vue.md',
      review: 'vue-review.md',
    };
    const [selected] = selectScopedPrompts(['packages/vue-ui/src/x.ts'], [entry]);
    expect(selected).toBe(entry);
  });

  it('evaluates a `!` pattern PER PATH: an excluded path cannot pull its entry in alone', () => {
    const entries: ScopedPromptsEntry[] = [
      {
        name: 'adk',
        match: ['packages/adk/**', '!packages/adk/**/build/**'],
        guidelines: 'kotlin.md',
      },
    ];

    // The only changed path is excluded — the entry must NOT be selected.
    expect(selectScopedPrompts(['packages/adk/gen/build/Out.kt'], entries)).toEqual([]);

    // A second, non-excluded path under the same entry still selects it. Evaluating negation per
    // ENTRY instead would let the excluded path veto the whole entry and return nothing here.
    expect(
      names(
        selectScopedPrompts(['packages/adk/gen/build/Out.kt', 'packages/adk/src/Main.kt'], entries)
      )
    ).toEqual(['adk']);
  });

  it('an entry with only negative patterns is never selected', () => {
    const entries: ScopedPromptsEntry[] = [{ name: 'dead', match: ['!packages/adk/**'] }];
    expect(selectScopedPrompts(['packages/adk/src/Main.kt'], entries)).toEqual([]);
    expect(selectScopedPrompts(['docs/readme.md'], entries)).toEqual([]);
  });

  it('de-duplicates nothing — two entries matching the same path are both selected', () => {
    const entries: ScopedPromptsEntry[] = [
      { name: 'all-of-packages', match: ['packages/**'] },
      { name: 'vue-ui', match: ['packages/vue-ui/**'] },
    ];
    expect(names(selectScopedPrompts(['packages/vue-ui/src/x.ts'], entries))).toEqual([
      'all-of-packages',
      'vue-ui',
    ]);
  });

  it('is pure: the inputs are not mutated and repeated calls agree', () => {
    const entries: ScopedPromptsEntry[] = [
      { name: 'vue-ui', match: ['packages/vue-ui/**'] },
      { name: 'adk', match: ['packages/adk/**'] },
    ];
    const paths = ['packages/adk/src/Main.kt'];
    const first = selectScopedPrompts(paths, entries);
    const second = selectScopedPrompts(paths, entries);
    expect(names(first)).toEqual(['adk']);
    expect(names(second)).toEqual(['adk']);
    expect(paths).toEqual(['packages/adk/src/Main.kt']);
    expect(names(entries)).toEqual(['vue-ui', 'adk']);
  });
});
