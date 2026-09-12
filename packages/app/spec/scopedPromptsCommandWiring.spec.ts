import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

/**
 * CFG-70 — **where the changed paths come from**, at all three of the sites that produce content
 * for a review.
 *
 * Two failures live here and neither shows up in the output.
 *
 * **`gth pr` has TWO content producers, not one** — `discoveryResult.diff` in discovery mode and
 * `prContent` for an explicit PR. Wiring only the branch one happens to be looking at leaves the
 * other silently unscoped: the review runs on root guidelines alone and reads exactly like a run
 * where nothing matched.
 *
 * **The paths must come from the content source's own output, never from the joined message.**
 * `review()` is handed requirements + diff + `--file` contents + stdin + `--message` concatenated,
 * and a requirements document that quotes a diff — a ticket with a patch in it, a design doc, a
 * previous review — would otherwise inject paths this change never touched and attach another
 * module's guidelines to it. The two cells that prove it carry a requirements fixture whose
 * `diff --git` header names a module the real diff does not go near.
 */

vi.mock('node:crypto', async () => ({
  ...(await vi.importActual<typeof import('node:crypto')>('node:crypto')),
  randomUUID: () => '12345678-aaaa-bbbb-cccc-1234567890ab',
}));

const resolversMock = { createResolvers: vi.fn() };
vi.mock('@gaunt-sloth/agent/resolvers.js', () => resolversMock);

const review = vi.fn();
vi.mock('#src/modules/reviewModule.js', () => ({ review }));

const runPrDiscovery = vi.fn();
vi.mock('#src/commands/prDiscovery.js', () => ({
  runPrDiscovery,
  readPrDiscoveryPrompt: vi.fn(() => ''),
}));

const prompt = {
  readBackstory: vi.fn(() => 'BACKSTORY'),
  readGuidelines: vi.fn(() => 'GUIDELINES'),
  readReviewInstructions: vi.fn(() => 'REVIEW INSTRUCTIONS'),
  readSystemPrompt: vi.fn(() => ''),
};
vi.mock('#src/utils/llmUtils.js', async () => ({
  ...(await import('#src/utils/llmUtils.js')),
  ...prompt,
}));

const utilsMock = {
  readFileFromCurrentDir: vi.fn(),
  readMultipleFilesFromProjectDir: vi.fn(),
  readFileSyncWithMessages: vi.fn(),
  execAsync: vi.fn(),
  ProgressIndicator: vi.fn(),
  extractLastMessageContent: vi.fn(),
  toFileSafeString: vi.fn(),
  fileSafeLocalDate: vi.fn(),
  generateStandardFileName: vi.fn(),
};
vi.mock('#src/utils/utils.js', () => utilsMock);

const configMock = { initConfig: vi.fn() };
vi.mock('#src/config.js', () => configMock);

/** A real diff, touching one module. */
const VUE_DIFF = [
  'diff --git a/packages/vue-ui/src/Button.vue b/packages/vue-ui/src/Button.vue',
  '--- a/packages/vue-ui/src/Button.vue',
  '+++ b/packages/vue-ui/src/Button.vue',
  '@@ -1 +1 @@',
  '-old',
  '+new',
].join('\n');

/**
 * A requirements document that QUOTES a diff — for a module the real diff never touches. If the
 * extraction ever reads the joined message instead of the content source's own output, `adk`
 * appears in the changed paths and its guidelines are attached to a Vue change.
 */
const REQUIREMENTS_QUOTING_A_DIFF = [
  'Fix the button. For reference, the earlier change looked like:',
  'diff --git a/packages/adk/src/Agent.kt b/packages/adk/src/Agent.kt',
].join('\n');

const baseConfig = {
  llm: { invoke: vi.fn() } as unknown as BaseChatModel,
  contentSource: 'text',
  requirementSource: 'text',
  streamOutput: false,
  filesystem: 'none',
  useColour: false,
  writeOutputToFile: false,
  streamSessionInferenceLog: true,
  canInterruptInferenceWithEsc: false,
  commands: {
    pr: { contentSource: 'github', requirementSource: 'text' },
    review: { contentSource: 'text', requirementSource: 'text' },
  },
};

/** The `ReviewContext` the command handed the review module. */
const reviewContext = () => review.mock.calls[0][6] as { changedPaths?: string[] };

beforeEach(() => {
  vi.resetAllMocks();
  configMock.initConfig.mockResolvedValue(baseConfig);
  prompt.readBackstory.mockReturnValue('BACKSTORY');
  prompt.readGuidelines.mockReturnValue('GUIDELINES');
  prompt.readReviewInstructions.mockReturnValue('REVIEW INSTRUCTIONS');
  prompt.readSystemPrompt.mockReturnValue('');
  utilsMock.readMultipleFilesFromProjectDir.mockReturnValue('FILE CONTENTS');
});

describe('gth review — changed paths come from providedContent', () => {
  it('extracts the paths the content source produced', async () => {
    const { reviewCommand } = await import('#src/commands/reviewCommand.js');
    const program = new Command();

    reviewCommand(program, {});
    await program.parseAsync(['na', 'na', 'review', VUE_DIFF]);

    expect(reviewContext().changedPaths).toEqual(['packages/vue-ui/src/Button.vue']);
  });

  it('ignores a diff quoted inside the requirements', async () => {
    const { reviewCommand } = await import('#src/commands/reviewCommand.js');
    const program = new Command();

    reviewCommand(program, {});
    await program.parseAsync(['na', 'na', 'review', VUE_DIFF, '-r', REQUIREMENTS_QUOTING_A_DIFF]);

    // Paired on purpose: the real diff's path is still there (so this is not simply "extraction
    // stopped working"), and the quoted one is not.
    expect(reviewContext().changedPaths).toEqual(['packages/vue-ui/src/Button.vue']);
    expect(reviewContext().changedPaths).not.toContain('packages/adk/src/Agent.kt');
  });

  it('passes an empty list when the content source is not a diff', async () => {
    const { reviewCommand } = await import('#src/commands/reviewCommand.js');
    const program = new Command();

    reviewCommand(program, {});
    await program.parseAsync(['na', 'na', 'review', 'just some prose']);

    expect(reviewContext().changedPaths).toEqual([]);
  });
});

describe('gth pr — both content producers', () => {
  it('extracts the paths from the discovered diff, not from the discovered requirements', async () => {
    runPrDiscovery.mockResolvedValue({
      requirements: REQUIREMENTS_QUOTING_A_DIFF,
      diff: VUE_DIFF,
    });
    const { prCommand } = await import('#src/commands/prCommand.js');
    const program = new Command();

    prCommand(program, {});
    await program.parseAsync(['na', 'na', 'pr']);

    expect(reviewContext().changedPaths).toEqual(['packages/vue-ui/src/Button.vue']);
    expect(reviewContext().changedPaths).not.toContain('packages/adk/src/Agent.kt');
  });

  it('extracts the paths from an explicit PR diff', async () => {
    vi.doMock('#src/sources/ghPrDiffSource.js', () => ({
      get: vi.fn().mockResolvedValue(VUE_DIFF),
    }));
    const { prCommand } = await import('#src/commands/prCommand.js');
    const program = new Command();

    prCommand(program, {});
    await program.parseAsync(['na', 'na', 'pr', '123']);

    expect(reviewContext().changedPaths).toEqual(['packages/vue-ui/src/Button.vue']);
  });
});
