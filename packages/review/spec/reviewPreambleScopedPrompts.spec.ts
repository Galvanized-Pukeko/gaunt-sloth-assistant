import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import type { GthConfig } from '#src/config.js';

/**
 * CFG-70 — `getReviewPreamble` over the **real** prompt-reading layer.
 *
 * `reviewPreamble.spec.ts` mocks the four segment readers, which is right for what it asserts —
 * the order the preamble composes them in — and is precisely why it cannot say anything about this:
 * with the readers mocked, the composition under test here never runs.
 *
 * So this file mocks the filesystem instead and leaves everything above it real. The first cell is
 * the byte-identity guard for the standalone review CLI's own preamble — the embedder-facing
 * surface, where an extra trailing newline is a silent diff in someone else's output — and the
 * second proves the scoped overlay reaches it at all, which is the claim that this seam covers
 * every caller rather than only the agent's.
 */

const PROJECT_DIR = resolve('/project');
let files: Record<string, string>;

vi.mock('node:fs', () => ({
  existsSync: vi.fn((path: unknown) => Object.hasOwn(files, String(path))),
  readFileSync: vi.fn((path: unknown) => files[String(path)] ?? ''),
}));

vi.mock('@gaunt-sloth/core/utils/systemUtils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gaunt-sloth/core/utils/systemUtils.js')>()),
  getProjectDir: vi.fn(() => PROJECT_DIR),
  getCurrentWorkDir: vi.fn(() => PROJECT_DIR),
}));

const at = (name: string) => resolve(PROJECT_DIR, name);

beforeEach(() => {
  files = {
    [at('.gsloth.backstory.md')]: 'BACKSTORY',
    [at('.gsloth.guidelines.md')]: 'GUIDELINES',
    [at('.gsloth.review.md')]: 'REVIEW INSTRUCTIONS',
    [at('.gsloth.system.md')]: 'SYSTEM',
  };
});

describe('getReviewPreamble over the real prompt readers', () => {
  it('composes byte-identically with no scoped entries selected', async () => {
    const { getReviewPreamble } = await import('#src/commands/commandUtils.js');

    expect(getReviewPreamble({ noDefaultPrompts: true } as GthConfig)).toBe(
      'BACKSTORY\nGUIDELINES\nREVIEW INSTRUCTIONS\nSYSTEM'
    );
  });

  it('drops an empty segment rather than leaving a blank line, unchanged', async () => {
    delete files[at('.gsloth.system.md')];
    const { getReviewPreamble } = await import('#src/commands/commandUtils.js');

    expect(getReviewPreamble({ noDefaultPrompts: true } as GthConfig)).toBe(
      'BACKSTORY\nGUIDELINES\nREVIEW INSTRUCTIONS'
    );
  });

  it('carries the scoped overlay into both of the segments an entry names', async () => {
    files[at('vue-ui.md')] = 'VUE UI RULES';
    files[at('review-vue-ui.md')] = 'VUE UI REVIEW RULES';
    const { getReviewPreamble } = await import('#src/commands/commandUtils.js');

    const preamble = getReviewPreamble({
      noDefaultPrompts: true,
      scopedPrompts: [
        {
          name: 'vue-ui',
          match: ['packages/vue-ui/**'],
          guidelines: 'vue-ui.md',
          review: 'review-vue-ui.md',
        },
      ],
    } as unknown as GthConfig);

    expect(preamble).toBe(
      'BACKSTORY\n' +
        'GUIDELINES\n' +
        '## Module guidelines\n' +
        'The diff under review touches these modules. Each block applies ONLY to files under its paths.\n' +
        '\n' +
        '### vue-ui — packages/vue-ui/**\n' +
        'VUE UI RULES\n' +
        'REVIEW INSTRUCTIONS\n' +
        '## Module review instructions\n' +
        'The diff under review touches these modules. Each block applies ONLY to files under its paths.\n' +
        '\n' +
        '### vue-ui — packages/vue-ui/**\n' +
        'VUE UI REVIEW RULES\n' +
        'SYSTEM'
    );
  });
});
