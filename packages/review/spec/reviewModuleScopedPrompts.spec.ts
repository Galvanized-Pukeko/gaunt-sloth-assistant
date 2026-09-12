import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GthConfig, ScopedPromptsEntry } from '#src/config.js';

/**
 * CFG-70 — **what a run selects, and what it says about it**, inside `review()`.
 *
 * A misspelled glob (`packages/vue-ui/*` where `/**` was meant), or `--content-source text`, yields
 * zero matches and a review that runs on the root guidelines alone. That outcome is
 * *indistinguishable from a working run* — the review appears, it is plausible, and the per-module
 * guidelines the user wrote simply were not there. So the three outcomes each have their own line,
 * and the cells below are about which line, in which channel.
 *
 * **The channel is the point, not a detail.** The report line is review-document provenance and
 * goes through the GS2-93 `output.header` guard with the heading; the warnings are diagnostics
 * about configuration and are not suppressed by it. A caller who silenced the header to diff
 * captured stdout byte-for-byte asked for a clean document, not for silence about config that
 * quietly did nothing.
 */

const runnerInstance = {
  init: vi.fn(),
  processMessages: vi.fn(),
  cleanup: vi.fn(),
  getTerminationReason: vi.fn(() => undefined),
};
vi.mock('@gaunt-sloth/core/core/GthAgentRunner.js', () => ({
  GthAgentRunner: vi.fn(function GthAgentRunnerMock() {
    return runnerInstance;
  }),
}));

const displayMock = vi.fn();
const displayWarningMock = vi.fn();
vi.mock('@gaunt-sloth/core/utils/consoleUtils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gaunt-sloth/core/utils/consoleUtils.js')>()),
  display: displayMock,
  displayWarning: displayWarningMock,
  displaySuccess: vi.fn(),
  displayInfo: vi.fn(),
  displayError: vi.fn(),
  displayDebug: vi.fn(),
  initSessionLogging: vi.fn(),
  flushSessionLog: vi.fn(),
  stopSessionLogging: vi.fn(),
}));

// The scoped files are never read here: this spec is about SELECTION and REPORTING. Sizing them is
// core's `measureScopedPrompts`, pinned in `scopedPromptsCompose.spec.ts` against its own virtual
// filesystem; stubbing it here keeps these cells off the disk entirely.
const measureScopedPromptsMock = vi.fn(() => ({
  totalBytes: 10,
  entryNames: [] as string[],
  overBudget: false,
}));
vi.mock('@gaunt-sloth/core/utils/llmUtils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gaunt-sloth/core/utils/llmUtils.js')>()),
  measureScopedPrompts: measureScopedPromptsMock,
}));

const ENTRIES: ScopedPromptsEntry[] = [
  { name: 'vue-ui', match: ['packages/vue-ui/**'], guidelines: 'vue-ui.md' },
  { name: 'adk', match: ['packages/adk/**'], guidelines: 'kotlin.md' },
  { name: 'e2e', match: ['e2e/**'], guidelines: 'playwright.md' },
  { name: 'docs', match: ['docs/**'], guidelines: 'docs.md' },
];

const configWith = (overrides: Partial<GthConfig> = {}): GthConfig =>
  ({
    llm: { _llmType: () => 'test', bindTools: vi.fn() },
    streamOutput: false,
    contentSource: 'file',
    requirementSource: 'file',
    filesystem: 'none',
    useColour: false,
    writeOutputToFile: false,
    canInterruptInferenceWithEsc: false,
    noDefaultPrompts: true,
    modelDisplayName: 'test-model',
    modelProviderType: 'test',
    prompts: { paths: ENTRIES },
    ...overrides,
  }) as unknown as GthConfig;

/** Every line the review document received. */
const displayed = () => displayMock.mock.calls.map((call) => String(call[0]));
/** Every warning the run emitted. */
const warnings = () => displayWarningMock.mock.calls.map((call) => String(call[0]));
const scopedReportLine = () => displayed().find((line) => line.startsWith('Scoped prompts:'));

async function runReview(config: GthConfig, changedPaths: string[] | undefined) {
  const { review } = await import('#src/modules/reviewModule.js');
  await review('REVIEW', '', 'DIFF', config, 'review', undefined, { changedPaths });
  return config;
}

beforeEach(() => {
  vi.clearAllMocks();
  measureScopedPromptsMock.mockReturnValue({ totalBytes: 10, entryNames: [], overBudget: false });
});

describe('review() — selecting path-scoped prompt entries', () => {
  it('sets the runtime field to the matched entries, in config order', async () => {
    const config = await runReview(configWith(), ['e2e/spec.ts', 'packages/vue-ui/src/Button.vue']);

    // Config order, not the order the paths happened to match in — the diff decides WHICH, the
    // user decides in what order the model reads them.
    expect(config.scopedPrompts?.map((entry) => entry.name)).toEqual(['vue-ui', 'e2e']);
  });

  it('leaves the runtime field unset when nothing matched', async () => {
    const config = await runReview(configWith(), ['unrelated/file.ts']);

    expect(config.scopedPrompts).toBeUndefined();
  });

  it('reports the selection in the review document, verbatim', async () => {
    await runReview(configWith(), [
      'packages/vue-ui/src/Button.vue',
      'e2e/spec.ts',
      'e2e/other.ts',
    ]);

    // The literal shape, spelled out rather than rebuilt from the values, so a rewrite of the
    // sentence cannot ride in behind a green suite.
    expect(scopedReportLine()).toBe(
      'Scoped prompts: vue-ui, e2e (2 of 4 entries, 3 changed files)'
    );
  });

  it('says nothing at all when no entries are configured', async () => {
    await runReview(configWith({ prompts: {} }), []);

    expect(warnings()).toEqual([]);
    expect(scopedReportLine()).toBeUndefined();
  });
});

describe('review() — the two warnings', () => {
  it('warns, naming how many paths it saw, when entries are configured and none matched', async () => {
    await runReview(configWith(), ['src/a.ts', 'src/b.ts']);

    const warning = warnings().find((line) => line.includes('matched'));
    expect(warning).toBeDefined();
    // The count is what separates "my globs are wrong" from "the diff really is outside every
    // module", so it has to be in the message.
    expect(warning).toContain('2 changed paths');
    expect(warning).toContain('4 configured prompts.paths entries');
    expect(scopedReportLine()).toBeUndefined();
  });

  it('warns that the content is not a unified diff when no paths were found at all', async () => {
    await runReview(configWith(), []);

    const warning = warnings().find((line) => line.includes('diff --git'));
    expect(warning).toBeDefined();
    expect(warning).toContain('unified diff');
    // The paired half: this is a DIFFERENT diagnosis from "your globs matched nothing", because
    // the remedies are different — one is the config, the other is `--content-source`.
    expect(warnings().some((line) => line.includes('matched any of the'))).toBe(false);
  });

  it('treats an absent changedPaths the same as an empty one', async () => {
    // An embedder that never populated the field is in the same position as a text content
    // source: entries configured, nothing selected, and no way to tell without being told.
    await runReview(configWith(), undefined);

    expect(warnings().some((line) => line.includes('diff --git'))).toBe(true);
  });
});

describe('review() — output.header: none', () => {
  /**
   * GS2-93 promised a byte-clean stream to a caller who diffs captured stdout. The two cells are a
   * pair because either half alone passes against an implementation that suppressed everything, or
   * nothing.
   *
   * **The suppression cell must be run on a diff that DOES match.** Written with a diff that
   * matches nothing there is no report line to suppress in the first place, so the assertion holds
   * for a reason that has nothing to do with the guard — it passed against an implementation that
   * displayed the line unconditionally. Mutation testing is how that was found; the paths here are
   * the ones that make the assertion capable of failing.
   */
  it('suppresses the report line while still selecting the entries', async () => {
    const config = await runReview(
      configWith({ output: { header: 'none' } } as Partial<GthConfig>),
      ['packages/vue-ui/src/Button.vue']
    );

    expect(scopedReportLine()).toBeUndefined();
    // The paired half: silencing the header silences the LINE, never the feature. A caller who
    // wanted a clean document still gets the module guidelines attached to the review.
    expect(config.scopedPrompts?.map((entry) => entry.name)).toEqual(['vue-ui']);
  });

  it('still emits the warnings when the header is silenced', async () => {
    await runReview(configWith({ output: { header: 'none' } } as Partial<GthConfig>), [
      'src/nothing-matches.ts',
    ]);

    expect(warnings().some((line) => line.includes('matched'))).toBe(true);
  });

  it('emits the report line when the header is not silenced', async () => {
    await runReview(configWith(), ['packages/vue-ui/src/Button.vue']);

    expect(scopedReportLine()).toBe('Scoped prompts: vue-ui (1 of 4 entries, 1 changed files)');
  });
});

describe('review() — the prompt budget', () => {
  it('warns once, naming the entries and the byte total, and truncates nothing', async () => {
    measureScopedPromptsMock.mockReturnValue({
      totalBytes: 70000,
      entryNames: ['vue-ui', 'e2e'],
      overBudget: true,
    });

    const config = await runReview(configWith(), ['packages/vue-ui/src/Button.vue', 'e2e/spec.ts']);

    const warning = warnings().find((line) => line.includes('70000 bytes'));
    expect(warning).toBeDefined();
    expect(warning).toContain('vue-ui, e2e');
    expect(warning).toContain('Nothing was truncated');
    expect(warnings().filter((line) => line.includes('70000 bytes'))).toHaveLength(1);
    // Paired: the selection is untouched by the warning. A budget that quietly dropped an entry
    // would be the truncation this deliberately refuses.
    expect(config.scopedPrompts?.map((entry) => entry.name)).toEqual(['vue-ui', 'e2e']);
  });

  it('stays silent under the budget', async () => {
    await runReview(configWith(), ['packages/vue-ui/src/Button.vue']);

    expect(warnings().some((line) => line.includes('bytes'))).toBe(false);
  });
});
