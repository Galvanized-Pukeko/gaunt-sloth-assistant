import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GthConfig } from '@gaunt-sloth/core/config.js';
import type { AgentResolvers } from '@gaunt-sloth/core/core/types.js';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

const processMessagesMock = vi.hoisted(() => vi.fn());
const initMock = vi.hoisted(() => vi.fn());
const cleanupMock = vi.hoisted(() => vi.fn());
const ghDiffMock = vi.hoisted(() => vi.fn());
const ghPrViewMock = vi.hoisted(() => vi.fn());
const ghIssueMock = vi.hoisted(() => vi.fn());
const jiraIssueMock = vi.hoisted(() => vi.fn());
const jiraIssueLegacyMock = vi.hoisted(() => vi.fn());
const displayInfoMock = vi.hoisted(() => vi.fn());
const displayWarningMock = vi.hoisted(() => vi.fn());
const debugLogMock = vi.hoisted(() => vi.fn());

vi.mock('@gaunt-sloth/core/core/GthAgentRunner.js', () => ({
  GthAgentRunner: vi.fn(function GthAgentRunnerMock() {
    return {
      init: initMock,
      processMessages: processMessagesMock,
      cleanup: cleanupMock,
    };
  }),
}));

vi.mock('@gaunt-sloth/core/utils/consoleUtils.js', () => ({
  defaultStatusCallback: vi.fn(),
  displayInfo: displayInfoMock,
  displayWarning: displayWarningMock,
}));

vi.mock('@gaunt-sloth/core/utils/debugUtils.js', () => ({
  debugLog: debugLogMock,
}));

vi.mock('@gaunt-sloth/api/resolvers.js', () => ({
  createResolvers: vi.fn(() => ({})),
}));

vi.mock('@gaunt-sloth/review/sources/ghPrDiffSource.js', () => ({
  get: ghDiffMock,
}));

vi.mock('@gaunt-sloth/review/sources/ghPrViewSource.js', () => ({
  get: ghPrViewMock,
}));

vi.mock('@gaunt-sloth/review/sources/ghIssueSource.js', () => ({
  get: ghIssueMock,
}));

vi.mock('@gaunt-sloth/review/sources/jiraIssueSource.js', () => ({
  get: jiraIssueMock,
}));

vi.mock('@gaunt-sloth/review/sources/jiraIssueLegacySource.js', () => ({
  get: jiraIssueLegacyMock,
}));

describe('runPrAutoMode', () => {
  const config = {
    llm: { invoke: vi.fn() } as unknown as BaseChatModel,
    projectGuidelines: '.gsloth.guidelines.md',
    projectReviewInstructions: '.gsloth.review.md',
    contentProvider: 'github',
    requirementsProvider: 'github',
    streamOutput: false,
    filesystem: 'none',
    useColour: false,
    writeOutputToFile: true,
    writeBinaryOutputsToFile: true,
    streamSessionInferenceLog: true,
    canInterruptInferenceWithEsc: true,
    includeCurrentDateAfterGuidelines: false,
    contentSource: 'github',
    requirementSource: 'github',
    commands: {
      pr: {
        contentProvider: 'github',
        requirementsProvider: 'github',
        auto: {
          enabled: true,
          deterministicDiff: true,
        },
      },
      review: {},
    },
  } as Partial<GthConfig> as GthConfig;

  const jiraConfig = {
    ...config,
    requirementsProvider: 'jira',
    requirementSource: 'jira',
    builtInToolsConfig: { jira: { cloudId: 'cloud-1' } },
    commands: {
      pr: {
        contentProvider: 'github',
        requirementsProvider: 'jira',
        auto: { enabled: true, deterministicDiff: true },
      },
      review: {},
    },
  } as Partial<GthConfig> as GthConfig;

  beforeEach(() => {
    vi.resetAllMocks();
    ghDiffMock.mockResolvedValue('Diff from gh');
    ghPrViewMock.mockResolvedValue(`GitHub PR: #360
Description:
Requirements: https://github.com/Galvanized-Pukeko/gaunt-sloth-assistant/issues/359`);
    ghIssueMock.mockResolvedValue('Issue #359 requirements');
    jiraIssueMock.mockResolvedValue('ABC-123 requirements');
    jiraIssueLegacyMock.mockResolvedValue('ABC-123 legacy requirements');
  });

  it('skips the discovery agent when diff and requirements are deterministically resolved', async () => {
    const { runPrAutoMode } = await import('#src/commands/prAutoMode.js');

    const result = await runPrAutoMode(config);

    expect(result).toEqual({
      diff: 'Diff from gh',
      requirements: 'Issue #359 requirements',
    });
    expect(ghDiffMock).toHaveBeenCalledWith(null, undefined);
    expect(ghPrViewMock).toHaveBeenCalledWith(null, undefined);
    // The full URL is passed through so cross-repo issue links resolve in the right repo.
    expect(ghIssueMock).toHaveBeenCalledWith(
      null,
      'https://github.com/Galvanized-Pukeko/gaunt-sloth-assistant/issues/359'
    );
    expect(initMock).not.toHaveBeenCalled();
    expect(processMessagesMock).not.toHaveBeenCalled();
    expect(cleanupMock).not.toHaveBeenCalled();
    expect(displayInfoMock).toHaveBeenCalledWith(
      'Auto mode retrieved current-branch PR #360 metadata with gh.'
    );
    expect(displayInfoMock).toHaveBeenCalledWith(
      'Auto mode already has a deterministic PR diff and requirements; skipping discovery agent.'
    );
  });

  it('omits the PR number from the metadata message when it cannot be parsed', async () => {
    ghPrViewMock.mockResolvedValue(`GitHub PR: for current branch
Description:
No linked ticket`);
    processMessagesMock.mockResolvedValue(undefined);

    const { runPrAutoMode } = await import('#src/commands/prAutoMode.js');

    await runPrAutoMode(config);

    expect(displayInfoMock).toHaveBeenCalledWith(
      'Auto mode retrieved current-branch PR metadata with gh.'
    );
  });

  it('resolves Jira requirements from an Atlassian browse URL when the provider is jira', async () => {
    ghPrViewMock.mockResolvedValue(`GitHub PR: #360
Description:
Requirements: https://company.atlassian.net/browse/ABC-123`);

    const { runPrAutoMode } = await import('#src/commands/prAutoMode.js');

    const result = await runPrAutoMode(jiraConfig);

    expect(result).toEqual({
      diff: 'Diff from gh',
      requirements: 'ABC-123 requirements',
    });
    expect(jiraIssueMock).toHaveBeenCalledWith({ cloudId: 'cloud-1' }, 'ABC-123');
    expect(jiraIssueLegacyMock).not.toHaveBeenCalled();
    expect(ghIssueMock).not.toHaveBeenCalled();
    expect(initMock).not.toHaveBeenCalled();
    expect(displayInfoMock).toHaveBeenCalledWith(
      'Auto mode retrieved requirements from Jira issue ABC-123 linked in the PR description.'
    );
  });

  it('resolves Jira requirements from a bare key on the requirements line', async () => {
    ghPrViewMock.mockResolvedValue(`GitHub PR: #360
Description:
Requirement: ABC-123 must be implemented`);

    const { runPrAutoMode } = await import('#src/commands/prAutoMode.js');

    const result = await runPrAutoMode(jiraConfig);

    expect(result.requirements).toBe('ABC-123 requirements');
    expect(jiraIssueMock).toHaveBeenCalledWith({ cloudId: 'cloud-1' }, 'ABC-123');
  });

  it('resolves a Jira key from the head branch name', async () => {
    ghPrViewMock.mockResolvedValue(`GitHub PR: #360
Head branch: feature/ABC-123-add-useful-feature
Description:
No explicit ticket link`);

    const { runPrAutoMode } = await import('#src/commands/prAutoMode.js');

    const result = await runPrAutoMode(jiraConfig);

    expect(result.requirements).toBe('ABC-123 requirements');
    expect(jiraIssueMock).toHaveBeenCalledWith({ cloudId: 'cloud-1' }, 'ABC-123');
    expect(initMock).not.toHaveBeenCalled();
  });

  it('does not treat single-letter or lowercase branch tokens as Jira keys', async () => {
    ghPrViewMock.mockResolvedValue(`GitHub PR: #360
Head branch: feature/fix-123-and-A-1-cleanup
Description:
No linked ticket here`);
    processMessagesMock.mockResolvedValue(undefined);

    const { runPrAutoMode } = await import('#src/commands/prAutoMode.js');

    await runPrAutoMode(jiraConfig);

    expect(jiraIssueMock).not.toHaveBeenCalled();
    expect(initMock).toHaveBeenCalled();
  });

  it('uses a single Atlassian browse URL from the body when no requirements line exists', async () => {
    ghPrViewMock.mockResolvedValue(`GitHub PR: #360
Description:
Implements https://company.atlassian.net/browse/ABC-123`);

    const { runPrAutoMode } = await import('#src/commands/prAutoMode.js');

    const result = await runPrAutoMode(jiraConfig);

    expect(result.requirements).toBe('ABC-123 requirements');
    expect(jiraIssueMock).toHaveBeenCalledWith({ cloudId: 'cloud-1' }, 'ABC-123');
  });

  it('leaves requirements to the discovery agent when several distinct Jira links are present', async () => {
    ghPrViewMock.mockResolvedValue(`GitHub PR: #360
Description:
See https://company.atlassian.net/browse/ABC-123 and https://company.atlassian.net/browse/XYZ-9`);
    processMessagesMock.mockResolvedValue(undefined);

    const { runPrAutoMode } = await import('#src/commands/prAutoMode.js');

    await runPrAutoMode(jiraConfig);

    // Picking one of several "see also" links would review against the wrong requirements.
    expect(jiraIssueMock).not.toHaveBeenCalled();
    expect(initMock).toHaveBeenCalled();
  });

  it('uses the legacy Jira source when the provider is jira-legacy', async () => {
    ghPrViewMock.mockResolvedValue(`GitHub PR: #360
Description:
Requirements: https://company.atlassian.net/browse/ABC-123`);

    const legacyConfig = {
      ...jiraConfig,
      requirementsProvider: 'jira-legacy',
      commands: {
        pr: {
          contentProvider: 'github',
          requirementsProvider: 'jira-legacy',
          auto: { enabled: true, deterministicDiff: true },
        },
        review: {},
      },
    } as Partial<GthConfig> as GthConfig;

    const { runPrAutoMode } = await import('#src/commands/prAutoMode.js');

    const result = await runPrAutoMode(legacyConfig);

    expect(result.requirements).toBe('ABC-123 legacy requirements');
    expect(jiraIssueLegacyMock).toHaveBeenCalledWith({ cloudId: 'cloud-1' }, 'ABC-123');
    expect(jiraIssueMock).not.toHaveBeenCalled();
  });

  it('falls back to the discovery agent quietly when the Jira REST API has no credentials', async () => {
    ghPrViewMock.mockResolvedValue(`GitHub PR: #360
Description:
Requirements: https://company.atlassian.net/browse/ABC-123`);
    // No REST PAT/token configured (e.g. MCP-only setup) -> getJiraCredentials throws.
    jiraIssueMock.mockRejectedValue(new Error('Missing JIRA username.'));
    processMessagesMock.mockResolvedValue(undefined);

    const { runPrAutoMode } = await import('#src/commands/prAutoMode.js');

    const result = await runPrAutoMode(jiraConfig);

    // Deterministic requirements were not resolved, so the discovery agent runs to find them.
    expect(result.requirements).toBe('');
    expect(initMock).toHaveBeenCalled();
    expect(processMessagesMock).toHaveBeenCalled();
    // The REST failure must not be mis-reported as a metadata-retrieval failure.
    expect(displayWarningMock).not.toHaveBeenCalledWith(
      expect.stringContaining('could not retrieve current-branch PR metadata')
    );
    expect(debugLogMock).toHaveBeenCalledWith(expect.stringContaining('ABC-123'));
  });

  describe('discovery agent configuration', () => {
    const noLinkMetadata = `GitHub PR: #360
Description:
No linked ticket here`;

    const withAutoConfig = (auto: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      ({
        ...config,
        ...extra,
        commands: {
          pr: { contentProvider: 'github', requirementsProvider: 'github', auto },
          review: {},
        },
      }) as Partial<GthConfig> as GthConfig;

    it('augments the auto allow-list with set_requirements', async () => {
      ghPrViewMock.mockResolvedValue(noLinkMetadata);
      processMessagesMock.mockResolvedValue(undefined);

      const { runPrAutoMode } = await import('#src/commands/prAutoMode.js');
      await runPrAutoMode(withAutoConfig({ allowedTools: ['gh_pr', 'mcp__jira__getJiraIssue'] }));

      const agentConfig = initMock.mock.calls.at(-1)?.[1] as GthConfig;
      expect(agentConfig.allowedTools).toEqual([
        'gh_pr',
        'mcp__jira__getJiraIssue',
        'set_requirements',
      ]);
    });

    it('keeps only set_requirements for an empty auto allow-list', async () => {
      ghPrViewMock.mockResolvedValue(noLinkMetadata);
      processMessagesMock.mockResolvedValue(undefined);

      const { runPrAutoMode } = await import('#src/commands/prAutoMode.js');
      await runPrAutoMode(withAutoConfig({ allowedTools: [] }));

      const agentConfig = initMock.mock.calls.at(-1)?.[1] as GthConfig;
      expect(agentConfig.allowedTools).toEqual(['set_requirements']);
    });

    it('never inherits the top-level allowedTools allow-list', async () => {
      ghPrViewMock.mockResolvedValue(noLinkMetadata);
      processMessagesMock.mockResolvedValue(undefined);

      const { runPrAutoMode } = await import('#src/commands/prAutoMode.js');
      // A global empty allow-list (e.g. keeping review agents tool-free) must not strip the
      // discovery agent's set_requirements/set_diff tools.
      await runPrAutoMode(withAutoConfig({}, { allowedTools: [] }));

      const agentConfig = initMock.mock.calls.at(-1)?.[1] as GthConfig;
      expect(agentConfig.allowedTools).toBeUndefined();
    });

    it('gh_diff stores the fetched diff directly instead of echoing it through the model', async () => {
      // Deterministic fetch fails, so the discovery agent has to use the gh_diff tool.
      ghDiffMock.mockReset();
      ghDiffMock.mockRejectedValueOnce(new Error('no PR for current branch'));
      ghDiffMock.mockResolvedValueOnce('GitHub PR Diff: #360\n\ndiff body');
      ghPrViewMock.mockResolvedValue(noLinkMetadata);

      processMessagesMock.mockImplementation(async () => {
        const { GthAgentRunner } = await import('@gaunt-sloth/core/core/GthAgentRunner.js');
        const resolvers = vi.mocked(GthAgentRunner).mock.calls.at(-1)?.[1] as AgentResolvers;
        const tools = await resolvers.resolveTools!(config, undefined);
        const ghDiffTool = tools.find((t) => t.name === 'gh_diff')!;

        const confirmation = (await ghDiffTool.invoke({})) as string;

        expect(confirmation).toContain('set it as the review diff');
        expect(confirmation).toContain('Preview');
      });

      const { runPrAutoMode } = await import('#src/commands/prAutoMode.js');
      const result = await runPrAutoMode(config);

      expect(processMessagesMock).toHaveBeenCalled();
      expect(result.diff).toBe('GitHub PR Diff: #360\n\ndiff body');
    });
  });

  it('resolves requirements from a GitHub closing keyword reference', async () => {
    ghPrViewMock.mockResolvedValue(`GitHub PR: #360
Description:
Closes #359`);

    const { runPrAutoMode } = await import('#src/commands/prAutoMode.js');
    const result = await runPrAutoMode(config);

    expect(ghIssueMock).toHaveBeenCalledWith(null, '359');
    expect(result.requirements).toBe('Issue #359 requirements');
    expect(initMock).not.toHaveBeenCalled();
  });

  it('leaves requirements to the discovery agent when several issue URLs are linked', async () => {
    ghPrViewMock.mockResolvedValue(`GitHub PR: #360
Description:
See https://github.com/owner/repo/issues/1 and https://github.com/owner/repo/issues/2`);
    processMessagesMock.mockResolvedValue(undefined);

    const { runPrAutoMode } = await import('#src/commands/prAutoMode.js');
    await runPrAutoMode(config);

    // Picking one of several "see also" links would review against the wrong requirements.
    expect(ghIssueMock).not.toHaveBeenCalled();
    expect(initMock).toHaveBeenCalled();
  });

  it('falls back to the discovery agent when no Jira key is present in the PR metadata', async () => {
    ghPrViewMock.mockResolvedValue(`GitHub PR: #360
Description:
No linked ticket here`);
    processMessagesMock.mockResolvedValue(undefined);

    const { runPrAutoMode } = await import('#src/commands/prAutoMode.js');

    await runPrAutoMode(jiraConfig);

    expect(jiraIssueMock).not.toHaveBeenCalled();
    expect(initMock).toHaveBeenCalled();
    expect(processMessagesMock).toHaveBeenCalled();
    expect(cleanupMock).toHaveBeenCalled();
  });
});
