import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GthConfig } from '@gaunt-sloth/core/config.js';
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
    expect(ghIssueMock).toHaveBeenCalledWith(null, '359');
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

  describe('filterDiscoveryTools', () => {
    const makeTools = (...names: string[]) =>
      names.map(
        (name) => ({ name }) as unknown as Parameters<typeof filterDiscoveryTools>[0][number]
      );

    let filterDiscoveryTools: typeof import('#src/commands/prAutoMode.js').filterDiscoveryTools;

    beforeEach(async () => {
      ({ filterDiscoveryTools } = await import('#src/commands/prAutoMode.js'));
    });

    it('returns all tools unchanged when no allow-list is configured', () => {
      const tools = makeTools('mcp__jira__getJiraIssue', 'gh_pr', 'gh_diff', 'set_diff');
      expect(filterDiscoveryTools(tools, undefined)).toBe(tools);
    });

    it('keeps only the always-kept set_requirements when given an empty allow-list', () => {
      const tools = makeTools('mcp__jira__getJiraIssue', 'gh_pr', 'set_requirements');
      expect(filterDiscoveryTools(tools, []).map((t) => t.name)).toEqual(['set_requirements']);
    });

    it('keeps only allow-listed tools plus the always-kept set_requirements', () => {
      const tools = makeTools(
        'mcp__jira__getJiraIssue',
        'mcp__jira__searchJiraIssuesUsingJql',
        'gh_pr',
        'gh_diff',
        'gh_issue',
        'set_diff',
        'set_requirements'
      );

      const filtered = filterDiscoveryTools(tools, ['mcp__jira__getJiraIssue', 'gh_pr']);

      expect(filtered.map((t) => t.name)).toEqual([
        'mcp__jira__getJiraIssue',
        'gh_pr',
        'set_requirements',
      ]);
    });

    it('retains set_requirements even when it is not in the allow-list', () => {
      const tools = makeTools('gh_pr', 'set_requirements');
      const filtered = filterDiscoveryTools(tools, ['gh_pr']);
      expect(filtered.map((t) => t.name)).toEqual(['gh_pr', 'set_requirements']);
    });
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
