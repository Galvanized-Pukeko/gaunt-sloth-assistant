import type { GthConfig, PrAutoModeConfig } from '@gaunt-sloth/core/config.js';
import type { AgentResolvers } from '@gaunt-sloth/core/core/types.js';
import { GthAgentRunner } from '@gaunt-sloth/core/core/GthAgentRunner.js';
import {
  defaultStatusCallback,
  displayInfo,
  displayWarning,
} from '@gaunt-sloth/core/utils/consoleUtils.js';
import { buildSystemMessages, readPrAutoPrompt } from '@gaunt-sloth/core/utils/llmUtils.js';
import { debugLog } from '@gaunt-sloth/core/utils/debugUtils.js';
import { HumanMessage } from '@langchain/core/messages';
import { StructuredToolInterface, tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createResolvers } from '@gaunt-sloth/api/resolvers.js';
import { get as getGhPrDiff } from '@gaunt-sloth/review/sources/ghPrDiffSource.js';
import { get as getGhPrView } from '@gaunt-sloth/review/sources/ghPrViewSource.js';
import { get as getGhIssue } from '@gaunt-sloth/review/sources/ghIssueSource.js';
import { get as getJiraIssue } from '@gaunt-sloth/review/sources/jiraIssueSource.js';
import { get as getJiraIssueLegacy } from '@gaunt-sloth/review/sources/jiraIssueLegacySource.js';
import type { ProviderConfig } from '@gaunt-sloth/review/sources/types.js';

export interface PrAutoModeResult {
  diff: string;
  requirements: string;
}

type PrAutoToolState = PrAutoModeResult & {
  prMetadata: string;
};

const SetDiffArgsSchema = z.object({
  diff: z.string().describe('Complete pull request diff text to use for the review.'),
});

const SetRequirementsArgsSchema = z.object({
  requirements: z.string().describe('Complete requirements text to use for the review.'),
});

const GhDiffArgsSchema = z.object({
  prId: z
    .string()
    .optional()
    .describe('GitHub PR number. Omit to fetch the PR diff for the current branch.'),
});

const GhPrArgsSchema = z.object({
  prId: z
    .string()
    .optional()
    .describe('GitHub PR number. Omit to fetch metadata for the current branch PR.'),
});

const GhIssueArgsSchema = z.object({
  issueId: z.string().describe('GitHub issue number to retrieve.'),
});

export async function runPrAutoMode(config: GthConfig): Promise<PrAutoModeResult> {
  const autoConfig = config.commands?.pr?.auto;
  const state: PrAutoToolState = {
    diff: '',
    requirements: '',
    prMetadata: '',
  };

  if (autoConfig?.deterministicDiff !== false) {
    try {
      const diff = await getGhPrDiff(getGithubContentProviderConfig(config), undefined);
      state.diff = diff ?? '';
      if (state.diff) {
        displayInfo('Auto mode deterministically retrieved current-branch PR diff with gh.');
      }
    } catch (error) {
      displayWarning(
        `Auto mode could not deterministically retrieve current-branch PR diff: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  try {
    const prMetadata = await getGhPrView(getGithubContentProviderConfig(config), undefined);
    state.prMetadata = prMetadata ?? '';
    if (state.prMetadata) {
      const prNumber = extractGithubPrNumber(state.prMetadata);
      displayInfo(
        prNumber
          ? `Auto mode retrieved current-branch PR #${prNumber} metadata with gh.`
          : 'Auto mode retrieved current-branch PR metadata with gh.'
      );
      state.requirements = await discoverRequirementsFromPrMetadata(config, state.prMetadata);
    }
  } catch (error) {
    displayWarning(
      `Auto mode could not retrieve current-branch PR metadata: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (state.diff.trim() && state.requirements.trim()) {
    displayInfo(
      'Auto mode already has a deterministic PR diff and requirements; skipping discovery agent.'
    );
    return {
      diff: state.diff.trim(),
      requirements: state.requirements.trim(),
    };
  }

  const runner = new GthAgentRunner(defaultStatusCallback, createPrAutoResolvers(config, state));
  try {
    await runner.init(undefined, getPrAutoAgentConfig(config, autoConfig), undefined);
    await runner.processMessages([
      ...buildSystemMessages(config, readPrAutoPrompt(config)),
      new HumanMessage(buildPrAutoUserMessage(state)),
    ]);
  } finally {
    await runner.cleanup();
  }

  // The discovery agent streams its final text without a trailing newline, so emit a
  // blank line to separate it from the review agent's output that follows.
  displayInfo('');

  return {
    diff: state.diff.trim(),
    requirements: state.requirements.trim(),
  };
}

function getPrAutoAgentConfig(
  config: GthConfig,
  autoConfig: PrAutoModeConfig | undefined
): GthConfig {
  const baseTools = autoConfig?.tools ?? config.tools ?? [];
  const customTools =
    autoConfig && 'customTools' in autoConfig ? autoConfig.customTools : config.customTools;
  return {
    ...config,
    filesystem: autoConfig?.filesystem ?? config.filesystem,
    builtInTools: autoConfig?.builtInTools ?? config.builtInTools,
    customTools: customTools === false ? undefined : customTools,
    tools: baseTools,
  };
}

// The discovery agent records the requirements it found via set_requirements, so it must
// always stay available even when an allowedTools allow-list is configured.
const ALWAYS_KEEP_DISCOVERY_TOOLS = new Set(['set_requirements']);

function createPrAutoResolvers(config: GthConfig, state: PrAutoToolState): AgentResolvers {
  const baseResolvers = createResolvers();
  const allowedTools = config.commands?.pr?.auto?.allowedTools;
  return {
    ...baseResolvers,
    resolveTools: async (effectiveConfig, command) => {
      const baseTools = baseResolvers.resolveTools
        ? await baseResolvers.resolveTools(effectiveConfig, command)
        : [];
      const tools = [...baseTools, ...createPrAutoTools(config, state)];
      return filterDiscoveryTools(tools, allowedTools);
    },
  };
}

/**
 * Trim the discovery agent's resolved tools to an allow-list of names. set_requirements is
 * always kept so the agent can record requirements. When the allow-list is omitted, all tools
 * are returned unchanged; an empty array keeps only the always-kept tools.
 */
export function filterDiscoveryTools(
  tools: StructuredToolInterface[],
  allowedTools: string[] | undefined
): StructuredToolInterface[] {
  if (allowedTools === undefined) {
    return tools;
  }
  const allowed = new Set(allowedTools);
  return tools.filter(
    (tool) => allowed.has(tool.name) || ALWAYS_KEEP_DISCOVERY_TOOLS.has(tool.name)
  );
}

function createPrAutoTools(config: GthConfig, state: PrAutoToolState): StructuredToolInterface[] {
  const setDiff = tool(
    async ({ diff }: z.infer<typeof SetDiffArgsSchema>): Promise<string> => {
      state.diff = diff;
      return 'Diff set for PR review.';
    },
    {
      name: 'set_diff',
      description: 'Set the exact pull request diff text that the PR review should use.',
      schema: SetDiffArgsSchema,
    }
  );

  const setRequirements = tool(
    async ({ requirements }: z.infer<typeof SetRequirementsArgsSchema>): Promise<string> => {
      state.requirements = requirements;
      return 'Requirements set for PR review.';
    },
    {
      name: 'set_requirements',
      description: 'Set the exact requirements text that the PR review should use.',
      schema: SetRequirementsArgsSchema,
    }
  );

  const ghPr = tool(
    async ({ prId }: z.infer<typeof GhPrArgsSchema>): Promise<string> => {
      return (await getGhPrView(getGithubContentProviderConfig(config), prId)) ?? '';
    },
    {
      name: 'gh_pr',
      description:
        'Fetch GitHub pull request metadata including title, branch names, URL, and description/body. Omit prId to fetch the current branch PR.',
      schema: GhPrArgsSchema,
    }
  );

  const ghDiff = tool(
    async ({ prId }: z.infer<typeof GhDiffArgsSchema>): Promise<string> => {
      return (await getGhPrDiff(getGithubContentProviderConfig(config), prId)) ?? '';
    },
    {
      name: 'gh_diff',
      description:
        'Fetch a GitHub pull request diff using GitHub CLI. Omit prId to fetch the PR for the current branch.',
      schema: GhDiffArgsSchema,
    }
  );

  const ghIssue = tool(
    async ({ issueId }: z.infer<typeof GhIssueArgsSchema>): Promise<string> => {
      return (await getGhIssue(getGithubRequirementsProviderConfig(config), issueId)) ?? '';
    },
    {
      name: 'gh_issue',
      description: 'Fetch a GitHub issue description using GitHub CLI.',
      schema: GhIssueArgsSchema,
    }
  );

  return [setDiff, setRequirements, ghPr, ghDiff, ghIssue];
}

function getProviderConfig(config: unknown): ProviderConfig | null {
  return config && typeof config === 'object' ? (config as ProviderConfig) : null;
}

function getGithubContentProviderConfig(config: GthConfig): ProviderConfig | null {
  return getProviderConfig(
    config.contentSourceConfig?.github ?? config.contentProviderConfig?.github
  );
}

function getGithubRequirementsProviderConfig(config: GthConfig): ProviderConfig | null {
  return getProviderConfig(
    config.requirementSourceConfig?.github ?? config.requirementsProviderConfig?.github
  );
}

function getJiraRequirementsProviderConfig(config: GthConfig): ProviderConfig | null {
  return getProviderConfig(
    config.builtInToolsConfig?.jira ??
      config.requirementSourceConfig?.jira ??
      config.requirementsProviderConfig?.jira
  );
}

/**
 * Deterministically resolve requirements from PR metadata, using a fast path that matches
 * the configured requirements provider. Falls back to '' when nothing is found, leaving the
 * discovery agent to resolve requirements.
 */
async function discoverRequirementsFromPrMetadata(
  config: GthConfig,
  prMetadata: string
): Promise<string> {
  const requirementsProvider =
    config.commands?.pr?.requirementsProvider ?? config.requirementsProvider;

  if (requirementsProvider === 'jira' || requirementsProvider === 'jira-legacy') {
    const issueKey = extractJiraIssueKey(prMetadata);
    if (!issueKey) {
      return '';
    }
    const jiraConfig = getJiraRequirementsProviderConfig(config);
    try {
      const requirements =
        (requirementsProvider === 'jira-legacy'
          ? await getJiraIssueLegacy(jiraConfig ?? {}, issueKey)
          : await getJiraIssue(jiraConfig, issueKey)) ?? '';
      if (requirements) {
        displayInfo(
          `Auto mode retrieved requirements from Jira issue ${issueKey} linked in the PR description.`
        );
      }
      return requirements;
    } catch (error) {
      // The deterministic Jira fast path uses the Jira REST API, which needs its own
      // credentials (PAT / base64 token) that are independent of any Jira MCP OAuth. When
      // those aren't configured - e.g. an MCP-only setup - skip quietly and let the discovery
      // agent resolve requirements via its tools (e.g. the Jira MCP server).
      debugLog(
        `Auto mode skipped the deterministic Jira REST lookup for ${issueKey}: ${error instanceof Error ? error.message : String(error)}`
      );
      return '';
    }
  }

  const requirementsIssueId = extractRequirementsGithubIssueId(prMetadata);
  if (!requirementsIssueId) {
    return '';
  }
  const requirements =
    (await getGhIssue(getGithubRequirementsProviderConfig(config), requirementsIssueId)) ?? '';
  if (requirements) {
    displayInfo(
      `Auto mode retrieved requirements from GitHub issue #${requirementsIssueId} linked in the PR description.`
    );
  }
  return requirements;
}

function extractRequirementsGithubIssueId(prMetadata: string): string | undefined {
  const requirementsLine = prMetadata.split('\n').find((line) => /requirements?/i.test(line));
  const candidates = [requirementsLine, prMetadata].filter((value): value is string =>
    Boolean(value)
  );

  for (const candidate of candidates) {
    const issueUrlMatch = candidate.match(/github\.com\/[^\s/`]+\/[^\s/`]+\/issues\/(\d+)/i);
    if (issueUrlMatch?.[1]) {
      return issueUrlMatch[1];
    }

    if (candidate === requirementsLine) {
      const hashIssueMatch = candidate.match(/#(\d+)/);
      if (hashIssueMatch?.[1]) {
        return hashIssueMatch[1];
      }
    }
  }

  return undefined;
}

function extractGithubPrNumber(prMetadata: string): string | undefined {
  // formatPrView emits "GitHub PR: #<number>" as the first line when the number is known.
  return prMetadata.match(/GitHub PR:\s*#(\d+)/)?.[1];
}

function extractJiraIssueKey(prMetadata: string): string | undefined {
  const requirementsLine = prMetadata.split('\n').find((line) => /requirements?/i.test(line));
  const candidates = [requirementsLine, prMetadata].filter((value): value is string =>
    Boolean(value)
  );

  for (const candidate of candidates) {
    // Atlassian browse URL, e.g. https://company.atlassian.net/browse/ABC-123
    const urlMatch = candidate.match(/atlassian\.net\/browse\/([A-Z][A-Z0-9]+-\d+)/i);
    if (urlMatch?.[1]) {
      return urlMatch[1].toUpperCase();
    }

    // Bare ticket key on a requirements line, e.g. "Requirements: ABC-123"
    if (candidate === requirementsLine) {
      const keyMatch = candidate.match(/\b([A-Z][A-Z0-9]+-\d+)\b/);
      if (keyMatch?.[1]) {
        return keyMatch[1];
      }
    }
  }

  return undefined;
}

function buildPrAutoUserMessage(state: PrAutoToolState): string {
  const diffStatus = state.diff
    ? 'A current-branch PR diff has already been deterministically retrieved and set. Verify whether it is sufficient; replace it with set_diff only if you find a better exact diff.'
    : 'No PR diff has been set yet. Retrieve the PR diff and call set_diff.';

  const requirementsStatus = state.requirements
    ? 'Requirements have already been retrieved from the PR description. Verify whether they are sufficient; replace them with set_requirements only if you find better exact requirements.'
    : 'Requirements have not been set yet. First inspect the PR description below for an explicit requirements link before trying issue-number guesses.';

  const prMetadataBlock = state.prMetadata
    ? `\n\nCurrent PR metadata already fetched with gh_pr:\n<pr-metadata>\n${state.prMetadata}\n</pr-metadata>`
    : '';

  return `${diffStatus}\n\n${requirementsStatus}${prMetadataBlock}

Discover the requirements for the current PR, then call set_requirements. Prefer an explicit requirements link from the PR description over searching nearby issue numbers. You may inspect linked GitHub issues, Jira MCP tools, and any other configured tools. Finish only after the diff and requirements have both been set.`;
}
