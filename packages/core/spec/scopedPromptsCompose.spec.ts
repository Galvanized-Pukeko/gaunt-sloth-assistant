import { beforeEach, describe, expect, it, vi } from 'vitest';
import { basename, resolve } from 'node:path';
import type { GthConfig, ScopedPromptsEntry } from '#src/config.js';
import type { PromptSegmentName } from '#src/config.js';

/**
 * CFG-70 — **composing the path-scoped overlay into a prompt segment**, at the one seam every
 * segment and every caller goes through.
 *
 * Two things here carry most of the weight.
 *
 * **Byte identity with the field unset** is the criterion most likely to break quietly. Every run
 * of every project that does not use this feature goes down that path, and a change that appends
 * one stray newline to all seven segments would pass any assertion written with `toContain`. So
 * the cells below compare with `toBe` against literals the spec owns — never against a value
 * re-derived from the production module, which would agree with whatever the production module
 * decided to do.
 *
 * **The heading wording is asserted literally.** The composed block is read by a model, and the
 * sentence telling it that a block applies only to files under its paths is the whole reason a
 * per-module guideline does not leak onto another module's code. Importing the constant the code
 * emits and comparing it to itself would stay green through a rewrite of exactly that sentence.
 */

const PROJECT_DIR = resolve('/project');

/** The virtual filesystem for one case: absolute path → contents. */
let files: Record<string, string>;

vi.mock('node:fs', () => ({
  existsSync: vi.fn((path: unknown) => Object.hasOwn(files, String(path))),
  readFileSync: vi.fn((path: unknown) => {
    const key = String(path);
    // Anything outside the virtual project is the installed package's bundled default, which
    // `readFileFromInstallDir` reaches by absolute path. Answering deterministically keeps the
    // "nothing configured, no project file" branch readable instead of throwing.
    //
    // `basename`, never `key.split('/').pop()`. This key is a REAL filesystem path built by
    // `resolve()`, so on win32 it is backslash-separated and splitting on `/` returns the whole
    // absolute path — which is how this cell reached CI green on Linux and macOS and red on both
    // Windows cells. The POSIX-only rule belongs to diff paths, which are `/`-separated by
    // construction; a path off this machine's filesystem is the opposite case and wants the
    // platform-aware helper.
    return Object.hasOwn(files, key) ? files[key] : `BUNDLED ${basename(key)}`;
  }),
}));

vi.mock('#src/utils/systemUtils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#src/utils/systemUtils.js')>()),
  getProjectDir: vi.fn(() => PROJECT_DIR),
  getCurrentWorkDir: vi.fn(() => PROJECT_DIR),
}));

const displayWarningMock = vi.fn();
vi.mock('#src/utils/consoleUtils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#src/utils/consoleUtils.js')>()),
  displayWarning: displayWarningMock,
}));

const SEGMENT_FILES: Record<PromptSegmentName, string> = {
  backstory: '.gsloth.backstory.md',
  guidelines: '.gsloth.guidelines.md',
  system: '.gsloth.system.md',
  chat: '.gsloth.chat.md',
  code: '.gsloth.code.md',
  exec: '.gsloth.exec.md',
  review: '.gsloth.review.md',
};
const SEGMENTS = Object.keys(SEGMENT_FILES) as PromptSegmentName[];

/** What the spec puts in the default-named project file for a segment. */
const defaultNamed = (segment: PromptSegmentName) => `PROJECT ${segment}`;
/** What the spec puts in a retargeted (`prompts.<segment>.path`) file. */
const retargeted = (segment: PromptSegmentName) => `RETARGETED ${segment}`;

const at = (name: string) => resolve(PROJECT_DIR, name);

function seedDefaultNamedFiles(): void {
  for (const segment of SEGMENTS) {
    files[at(SEGMENT_FILES[segment])] = defaultNamed(segment);
  }
}

beforeEach(() => {
  files = {};
  displayWarningMock.mockClear();
});

describe('readPromptSegment — byte identity with no scoped entries selected', () => {
  /**
   * The four `prompts.<segment>` shapes plus the unset one, each with the expected composition
   * written out by hand. `scopedPrompts` is absent throughout: this is what every run that does
   * not use CFG-70 must keep producing, to the byte.
   *
   * The mutation these exist for is dropping `.filter(Boolean)` from the final join, which turns
   * every one of these into the same string with a trailing newline.
   */
  const settingCases: {
    label: string;
    setting: (segment: PromptSegmentName) => unknown;
    expected: (segment: PromptSegmentName) => string;
  }[] = [
    {
      label: 'nothing set',
      setting: () => undefined,
      expected: (segment) => defaultNamed(segment),
    },
    {
      label: 'string shorthand',
      setting: () => 'custom.md',
      expected: () => 'CUSTOM FILE',
    },
    {
      label: "mode: 'replace'",
      setting: (segment) => ({ path: `retargeted-${segment}.md`, mode: 'replace' }),
      expected: (segment) => retargeted(segment),
    },
    {
      label: "mode: 'append'",
      setting: (segment) => ({ path: `retargeted-${segment}.md`, mode: 'append' }),
      expected: (segment) => `${defaultNamed(segment)}\n${retargeted(segment)}`,
    },
    {
      label: 'enabled: false',
      setting: () => ({ enabled: false }),
      expected: () => '',
    },
  ];

  for (const { label, setting, expected } of settingCases) {
    it(`composes every one of the seven segments unchanged — ${label}`, async () => {
      const { readPromptSegment } = await import('#src/utils/llmUtils.js');

      for (const segment of SEGMENTS) {
        files = {};
        seedDefaultNamedFiles();
        files[at('custom.md')] = 'CUSTOM FILE';
        files[at(`retargeted-${segment}.md`)] = retargeted(segment);

        const config = { prompts: { [segment]: setting(segment) } } as unknown as GthConfig;

        expect(readPromptSegment(segment, config), `${segment} / ${label}`).toBe(expected(segment));
      }
    });
  }

  it('falls back to the bundled default when no project file exists, unchanged', async () => {
    const { readPromptSegment } = await import('#src/utils/llmUtils.js');

    expect(readPromptSegment('guidelines', {} as GthConfig)).toBe('BUNDLED .gsloth.guidelines.md');
  });

  it('composes nothing extra when the entry list is present but empty', async () => {
    const { readPromptSegment } = await import('#src/utils/llmUtils.js');
    seedDefaultNamedFiles();

    expect(readPromptSegment('guidelines', { scopedPrompts: [] } as unknown as GthConfig)).toBe(
      'PROJECT guidelines'
    );
  });
});

describe('readPromptSegment — the composed scoped block', () => {
  const vueUi: ScopedPromptsEntry = {
    name: 'vue-ui',
    match: ['packages/vue-ui/**'],
    guidelines: 'guidelines/vue-ui.md',
  };
  const adk: ScopedPromptsEntry = {
    name: 'adk-backend',
    match: ['packages/adk/**', '!packages/adk/**/build/**'],
    guidelines: 'guidelines/kotlin.md',
    review: 'guidelines/review-kotlin.md',
  };

  beforeEach(() => {
    seedDefaultNamedFiles();
    files[at('guidelines/vue-ui.md')] = 'VUE UI RULES';
    files[at('guidelines/kotlin.md')] = 'KOTLIN RULES';
    files[at('guidelines/review-kotlin.md')] = 'KOTLIN REVIEW RULES';
  });

  it('appends a heading, the standing instruction and one block per entry, verbatim', async () => {
    const { readPromptSegment } = await import('#src/utils/llmUtils.js');

    const composed = readPromptSegment('guidelines', {
      scopedPrompts: [vueUi, adk],
    } as unknown as GthConfig);

    // The literal wording, not a constant re-imported from the module that emits it. The `###`
    // line lists ALL of the entry's patterns, negations included, because the model is being told
    // which files the block governs and an exclusion is part of that answer.
    expect(composed).toBe(
      'PROJECT guidelines\n' +
        '## Module guidelines\n' +
        'The diff under review touches these modules. Each block applies ONLY to files under its paths.\n' +
        '\n' +
        '### vue-ui — packages/vue-ui/**\n' +
        'VUE UI RULES\n' +
        '\n' +
        '### adk-backend — packages/adk/**, !packages/adk/**/build/**\n' +
        'KOTLIN RULES'
    );
  });

  it('files the block under a heading noun that follows the segment', async () => {
    const { readPromptSegment } = await import('#src/utils/llmUtils.js');
    const entry = (segment: PromptSegmentName): ScopedPromptsEntry =>
      ({ name: 'mod', match: ['a/**'], [segment]: 'guidelines/vue-ui.md' }) as ScopedPromptsEntry;

    const headingOf = (segment: PromptSegmentName) =>
      readPromptSegment(segment, {
        scopedPrompts: [entry(segment)],
      } as unknown as GthConfig).split('\n')[1];

    expect(headingOf('guidelines')).toBe('## Module guidelines');
    expect(headingOf('review')).toBe('## Module review instructions');
    // The five segments with no established noun take the generic form, spelled out here so a
    // change to it cannot ride in behind a green suite.
    expect(headingOf('backstory')).toBe('## Module backstory prompt');
    expect(headingOf('system')).toBe('## Module system prompt');
    expect(headingOf('chat')).toBe('## Module chat prompt');
    expect(headingOf('code')).toBe('## Module code prompt');
    expect(headingOf('exec')).toBe('## Module exec prompt');
  });

  /**
   * Paired on purpose. Either half alone passes against an implementation that attached every
   * entry to every segment, or one that attached none.
   */
  it('contributes an entry to each segment it carries, and to no other', async () => {
    const { readPromptSegment } = await import('#src/utils/llmUtils.js');
    const config = { scopedPrompts: [adk] } as unknown as GthConfig;

    expect(readPromptSegment('guidelines', config)).toContain('KOTLIN RULES');
    expect(readPromptSegment('review', config)).toContain('KOTLIN REVIEW RULES');
    // The same entry carries no `code` path, so that segment is untouched — no heading, no block.
    expect(readPromptSegment('code', config)).toBe('PROJECT code');
  });

  it('omits an entry that carries no path for this segment, rather than emitting a bare heading', async () => {
    const { readPromptSegment } = await import('#src/utils/llmUtils.js');

    const composed = readPromptSegment('guidelines', {
      scopedPrompts: [
        vueUi,
        { name: 'docs-only', match: ['docs/**'], review: 'guidelines/review-kotlin.md' },
      ],
    } as unknown as GthConfig);

    expect(composed).toContain('### vue-ui — packages/vue-ui/**');
    expect(composed).not.toContain('docs-only');
  });

  it('appends nothing at all when no selected entry carries this segment', async () => {
    const { readPromptSegment } = await import('#src/utils/llmUtils.js');

    // An empty `## Module guidelines` would read to the model as "these modules have no
    // guidelines", which is the opposite of what a config scoping a different segment means.
    expect(
      readPromptSegment('guidelines', {
        scopedPrompts: [
          { name: 'docs-only', match: ['docs/**'], review: 'guidelines/review-kotlin.md' },
        ],
      } as unknown as GthConfig)
    ).toBe('PROJECT guidelines');
  });

  it('keeps the entries in config order, not in some order of its own', async () => {
    const { readPromptSegment } = await import('#src/utils/llmUtils.js');

    const forwards = readPromptSegment('guidelines', {
      scopedPrompts: [vueUi, adk],
    } as unknown as GthConfig);
    const backwards = readPromptSegment('guidelines', {
      scopedPrompts: [adk, vueUi],
    } as unknown as GthConfig);

    expect(forwards.indexOf('VUE UI RULES')).toBeLessThan(forwards.indexOf('KOTLIN RULES'));
    expect(backwards.indexOf('KOTLIN RULES')).toBeLessThan(backwards.indexOf('VUE UI RULES'));
  });

  /**
   * DESIGN.md §3.4. Read against `enabled`'s own docstring ("the segment is dropped entirely")
   * this looks like a bug, which is exactly why it is pinned here as well as explained at the
   * seam: `enabled: false` turns off the REPOSITORY-WIDE segment, and "no guidelines for the repo,
   * only per-module ones" is a coherent monorepo config that the alternative would force the user
   * to express by pointing `guidelines` at an empty file.
   */
  it('still applies the scoped overlays when the root segment is disabled', async () => {
    const { readPromptSegment } = await import('#src/utils/llmUtils.js');

    const composed = readPromptSegment('guidelines', {
      prompts: { guidelines: { enabled: false } },
      scopedPrompts: [vueUi],
    } as unknown as GthConfig);

    expect(composed).toBe(
      '## Module guidelines\n' +
        'The diff under review touches these modules. Each block applies ONLY to files under its paths.\n' +
        '\n' +
        '### vue-ui — packages/vue-ui/**\n' +
        'VUE UI RULES'
    );
    // The paired half: the repository-wide segment really is gone, so this is not simply
    // "`enabled: false` was ignored".
    expect(composed).not.toContain('PROJECT guidelines');
  });

  it('appends after a retargeted root segment in either mode', async () => {
    const { readPromptSegment } = await import('#src/utils/llmUtils.js');
    files[at('custom.md')] = 'CUSTOM FILE';

    expect(
      readPromptSegment('guidelines', {
        prompts: { guidelines: 'custom.md' },
        scopedPrompts: [vueUi],
      } as unknown as GthConfig)
    ).toBe(
      'CUSTOM FILE\n' +
        '## Module guidelines\n' +
        'The diff under review touches these modules. Each block applies ONLY to files under its paths.\n' +
        '\n' +
        '### vue-ui — packages/vue-ui/**\n' +
        'VUE UI RULES'
    );

    expect(
      readPromptSegment('guidelines', {
        prompts: { guidelines: { path: 'custom.md', mode: 'append' } },
        scopedPrompts: [vueUi],
      } as unknown as GthConfig)
    ).toBe(
      'PROJECT guidelines\n' +
        'CUSTOM FILE\n' +
        '## Module guidelines\n' +
        'The diff under review touches these modules. Each block applies ONLY to files under its paths.\n' +
        '\n' +
        '### vue-ui — packages/vue-ui/**\n' +
        'VUE UI RULES'
    );
  });

  it('trims only the trailing whitespace of a scoped file, so block separation is its own', async () => {
    const { readPromptSegment } = await import('#src/utils/llmUtils.js');
    files[at('guidelines/vue-ui.md')] = '  indented first line\nVUE UI RULES\n\n\n';

    expect(
      readPromptSegment('guidelines', { scopedPrompts: [vueUi, adk] } as unknown as GthConfig)
    ).toContain(
      '### vue-ui — packages/vue-ui/**\n  indented first line\nVUE UI RULES\n\n### adk-backend'
    );
  });
});

describe('readPromptSegment — a scoped path that yields nothing', () => {
  beforeEach(() => {
    seedDefaultNamedFiles();
  });

  /**
   * The decision, and why it is neither of the other two.
   *
   * Composing an empty block is the one outcome with no recovery: the review runs, looks ordinary,
   * and is missing the guidelines the entry was written for. Throwing would refuse to review the
   * diff at all over content that is EXTRA by definition. So: warn, naming the entry, the segment
   * and the path it actually looked at, and leave the rest of the run alone.
   */
  it('warns naming the entry, the segment and the resolved path, and omits the block', async () => {
    const { readPromptSegment } = await import('#src/utils/llmUtils.js');

    const composed = readPromptSegment('guidelines', {
      scopedPrompts: [{ name: 'vue-ui', match: ['packages/vue-ui/**'], guidelines: 'typo.md' }],
    } as unknown as GthConfig);

    expect(composed).toBe('PROJECT guidelines');
    expect(composed).not.toContain('## Module guidelines');
    expect(displayWarningMock).toHaveBeenCalledTimes(1);
    const warning = displayWarningMock.mock.calls[0][0] as string;
    expect(warning).toContain('"vue-ui"');
    expect(warning).toContain('guidelines');
    expect(warning).toContain(at('typo.md'));
    expect(warning).toContain('does not exist');
  });

  it('warns and omits when the file exists but is empty', async () => {
    const { readPromptSegment } = await import('#src/utils/llmUtils.js');
    files[at('guidelines/blank.md')] = '\n  \n';

    const composed = readPromptSegment('guidelines', {
      scopedPrompts: [
        { name: 'vue-ui', match: ['packages/vue-ui/**'], guidelines: 'guidelines/blank.md' },
      ],
    } as unknown as GthConfig);

    expect(composed).toBe('PROJECT guidelines');
    expect(displayWarningMock).toHaveBeenCalledTimes(1);
    expect(displayWarningMock.mock.calls[0][0]).toContain('is empty');
  });

  it('keeps the other entries when one of them is unresolvable', async () => {
    const { readPromptSegment } = await import('#src/utils/llmUtils.js');
    files[at('guidelines/vue-ui.md')] = 'VUE UI RULES';

    const composed = readPromptSegment('guidelines', {
      scopedPrompts: [
        { name: 'missing', match: ['a/**'], guidelines: 'typo.md' },
        { name: 'vue-ui', match: ['packages/vue-ui/**'], guidelines: 'guidelines/vue-ui.md' },
      ],
    } as unknown as GthConfig);

    expect(composed).toContain('VUE UI RULES');
    expect(composed).not.toContain('### missing');
    expect(displayWarningMock).toHaveBeenCalledTimes(1);
  });
});

describe('measureScopedPrompts', () => {
  beforeEach(() => {
    files[at('guidelines/vue-ui.md')] = 'x'.repeat(100);
    files[at('guidelines/kotlin.md')] = 'y'.repeat(50);
    files[at('guidelines/review-kotlin.md')] = 'z'.repeat(25);
  });

  it('totals every segment file of every entry it is given', async () => {
    const { measureScopedPrompts } = await import('#src/utils/llmUtils.js');

    const budget = measureScopedPrompts(
      [
        { name: 'vue-ui', match: ['a/**'], guidelines: 'guidelines/vue-ui.md' },
        {
          name: 'adk',
          match: ['b/**'],
          guidelines: 'guidelines/kotlin.md',
          review: 'guidelines/review-kotlin.md',
        },
      ],
      {} as GthConfig
    );

    expect(budget.totalBytes).toBe(175);
    expect(budget.entryNames).toEqual(['vue-ui', 'adk']);
    expect(budget.overBudget).toBe(false);
  });

  it('counts bytes rather than characters', async () => {
    const { measureScopedPrompts } = await import('#src/utils/llmUtils.js');
    // Four astral characters: 4 UTF-16 code units in `.length`, 16 bytes on the wire.
    files[at('guidelines/vue-ui.md')] = '🦥🦥';

    expect(
      measureScopedPrompts(
        [{ name: 'vue-ui', match: ['a/**'], guidelines: 'guidelines/vue-ui.md' }],
        {} as GthConfig
      ).totalBytes
    ).toBe(8);
  });

  it('skips an entry whose files do not resolve, and does not name it', async () => {
    const { measureScopedPrompts } = await import('#src/utils/llmUtils.js');

    const budget = measureScopedPrompts(
      [
        { name: 'vue-ui', match: ['a/**'], guidelines: 'guidelines/vue-ui.md' },
        { name: 'gone', match: ['b/**'], guidelines: 'typo.md' },
      ],
      {} as GthConfig
    );

    expect(budget.totalBytes).toBe(100);
    expect(budget.entryNames).toEqual(['vue-ui']);
  });

  /**
   * The threshold, as a literal. Asserting `overBudget` against `SCOPED_PROMPT_BUDGET_BYTES` alone
   * would be a constant compared to itself: rewriting the constant would move both sides together
   * and the cell would stay green through a change to the one number a user experiences.
   */
  it('is over budget above 65536 bytes and not at it', async () => {
    const { measureScopedPrompts, SCOPED_PROMPT_BUDGET_BYTES } =
      await import('#src/utils/llmUtils.js');

    expect(SCOPED_PROMPT_BUDGET_BYTES).toBe(65536);

    files[at('guidelines/vue-ui.md')] = 'x'.repeat(65536);
    const entries = [
      { name: 'vue-ui', match: ['a/**'], guidelines: 'guidelines/vue-ui.md' },
    ] as ScopedPromptsEntry[];
    expect(measureScopedPrompts(entries, {} as GthConfig).overBudget).toBe(false);

    files[at('guidelines/vue-ui.md')] = 'x'.repeat(65537);
    expect(measureScopedPrompts(entries, {} as GthConfig).overBudget).toBe(true);
  });
});
