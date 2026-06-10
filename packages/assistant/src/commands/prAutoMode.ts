import type { CustomToolsConfig, GthConfig, ServerTool } from '@gaunt-sloth/core/config.js';
import type { AgentResolvers } from '@gaunt-sloth/core/core/types.js';
import { GthAgentRunner } from '@gaunt-sloth/core/core/GthAgentRunner.js';
import {
  defaultStatusCallback,
  displayInfo,
  displayWarning,
} from '@gaunt-sloth/core/utils/consoleUtils.js';
import { buildSystemMessages, readPromptFile } from '@gaunt-sloth/core/utils/llmUtils.js';
import { debugLog } from '@gaunt-sloth/core/utils/debugUtils.js';
import { HumanMessage } from '@langchain/core/messages';
import { type BaseToolkit, StructuredToolInterface, tool } from '@langchain/core/tools';
import { z } from 'zod';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createResolvers } from '@gaunt-sloth/api/resolvers.js';
import { get as getGhPrDiff } from '@gaunt-sloth/review/sources/ghPrDiffSource.js';
import { get as getGhPrView } from '@gaunt-sloth/review/sources/ghPrViewSource.js';
import { get as getGhIssue } from '@gaunt-sloth/review/sources/ghIssueSource.js';
import { get as getJiraIssue } from '@gaunt-sloth/review/sources/jiraIssueSource.js';
import { get as getJiraIssueLegacy } from '@gaunt-sloth/review/sources/jiraIssueLegacySource.js';
import type { ProviderConfig } from '@gaunt-sloth/review/sources/types.js';

export const GSLOTH_PR_AUTO_PROMPT = '.gsloth.pr-auto.md';

// The assistant package root (src|dist/commands -> package root), where the packaged default
// .gsloth.pr-auto.md ships.
const assistantPackageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface PrAutoModeConfig {
  /**
   * Enable `gth pr` auto mode when neither PR id nor requirements id is provided.
   * @default true
   */
  enabled?: boolean;
  /**
   * Fetch the current-branch PR diff with `gh pr diff` before invoking the auto agent.
   * The auto agent can still replace it with the `set_diff` tool if needed.
   * @default true
   */
  deterministicDiff?: boolean;
  /**
   * Optional tool overrides used only while the auto-mode discovery agent runs.
   * When omitted, the normal configured tools remain available.
   */
  filesystem?: string[] | 'all' | 'read' | 'none';
  builtInTools?: string[];
  customTools?: CustomToolsConfig | false;
  tools?: StructuredToolInterface[] | BaseToolkit[] | ServerTool[];
  /**
   * Restrict the discovery agent to this allow-list of tool names, applied after every tool
   * source (filesystem, built-in, custom, MCP, A2A, and `tools`) is resolved. Unlike
   * `builtInTools`/`customTools`/`filesystem` (which gate whole tool groups), this trims the
   * final tool set by exact name, so it can pare down MCP server tools
   * (e.g. "mcp__jira__getJiraIssue") and the auto-mode helper tools
   * ("gh_pr"/"gh_diff"/"gh_issue"/"set_diff") to the minimum needed.
   *
   * `set_requirements` is always retained regardless, since it is how the discovery agent
   * records the requirements it found. When omitted, all resolved tools remain available; an
   * empty array keeps only `set_requirements`. The discovery agent never inherits the
   * top-level {@link GthConfig.allowedTools}; this property is its only allow-list.
   */
  allowedTools?: string[];
}

// PR auto mode is an assistant feature; its config type lives here and is merged into the
// core command config via module augmentation instead of leaking into @gaunt-sloth/core.
declare module '@gaunt-sloth/core/config.js' {
  interface PrCommandConfig {
    /** PR auto mode (`gth pr` with no arguments) configuration. */
    auto?: PrAutoModeConfig;
  }
}

/**
 * Read the PR auto mode discovery agent prompt, honouring project / identity-profile
 * overrides and falling back to the default prompt shipped with the assistant package.
 */
export function readPrAutoPrompt(
  config: Pick<GthConfig, 'identityProfile' | 'noDefaultPrompts'>
): string {
  return readPromptFile(
    GSLOTH_PR_AUTO_PROMPT,
    config.identityProfile,
    config.noDefaultPrompts,
    assistantPackageDir
  );
}

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
  issueId: z
    .string()
    .describe(
      'GitHub issue number or full issue URL to retrieve. Use the full URL for issues in other repositories.'
    ),
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
    // The discovery agent must never inherit the top-level allow-list (e.g. a global
    // `allowedTools: []` meant to keep review agents tool-free would strip set_requirements
    // and silently neuter auto mode). Only `commands.pr.auto.allowedTools` applies here,
    // always augmented with set_requirements so the agent can record what it found. The
    // agent applies this list after every tool source is resolved, so it also gates tools
    // supplied via `tools` in config.
    allowedTools: autoConfig?.allowedTools
      ? [...new Set([...autoConfig.allowedTools, 'set_requirements'])]
      : undefined,
  };
}

function createPrAutoResolvers(config: GthConfig, state: PrAutoToolState): AgentResolvers {
  const baseResolvers = createResolvers();
  return {
    ...baseResolvers,
    resolveTools: async (effectiveConfig, command) => {
      const baseTools = baseResolvers.resolveTools
        ? await baseResolvers.resolveTools(effectiveConfig, command)
        : [];
      return [...baseTools, ...createPrAutoTools(config, state)];
    },
  };
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
      const diff = (await getGhPrDiff(getGithubContentProviderConfig(config), prId)) ?? '';
      if (!diff) {
        return 'No diff content was returned by GitHub CLI; the review diff was not changed.';
      }
      // Store the diff directly instead of returning it: echoing a large diff into the
      // model context just so the model can copy it verbatim into set_diff doubles token
      // cost and lets weaker models truncate or corrupt the diff on the way through.
      state.diff = diff;
      const preview = diff.split('\n').slice(0, 10).join('\n');
      return `Retrieved the PR diff (${diff.length} characters) and set it as the review diff; no need to call set_diff. Preview:\n${preview}`;
    },
    {
      name: 'gh_diff',
      description:
        'Fetch a GitHub pull request diff using GitHub CLI and set it as the review diff. ' +
        'Omit prId to fetch the PR for the current branch. ' +
        'Returns a confirmation with a short preview; the full diff is stored without needing set_diff.',
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
          ? await getJiraIssueLegacy(jiraConfig, issueKey)
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

  const requirementsIssueRef = extractRequirementsGithubIssueRef(prMetadata);
  if (!requirementsIssueRef) {
    return '';
  }
  const requirements =
    (await getGhIssue(getGithubRequirementsProviderConfig(config), requirementsIssueRef)) ?? '';
  if (requirements) {
    displayInfo(
      `Auto mode retrieved requirements from GitHub issue ${formatGithubIssueRef(requirementsIssueRef)} linked in the PR description.`
    );
  }
  return requirements;
}

// Owner/repo segments are restricted to GitHub's name charset; anything looser would let a
// crafted PR description smuggle shell metacharacters into the `gh issue view` command line.
const GITHUB_ISSUE_URL_PATTERN = /(?:https?:\/\/)?github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+/i;
// GitHub closing keywords (https://docs.github.com/en/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue)
const GITHUB_CLOSING_KEYWORD_PATTERN = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#(\d+)\b/i;

/**
 * Extract a GitHub issue reference (a full issue URL or a bare issue number) that the PR
 * description explicitly designates as requirements. URLs are returned whole rather than as
 * extracted numbers, because a cross-repo issue URL reduced to its number would make
 * `gh issue view` fetch the same-numbered issue from the wrong (current) repository.
 */
function extractRequirementsGithubIssueRef(prMetadata: string): string | undefined {
  const requirementsLine = prMetadata.split('\n').find((line) => /requirements?/i.test(line));

  if (requirementsLine) {
    const urlMatch = requirementsLine.match(GITHUB_ISSUE_URL_PATTERN);
    if (urlMatch) {
      return normalizeGithubIssueUrl(urlMatch[0]);
    }
    const hashIssueMatch = requirementsLine.match(/#(\d+)/);
    if (hashIssueMatch?.[1]) {
      return hashIssueMatch[1];
    }
  }

  // A closing keyword ("Closes #123", "Fixes #123") is an explicit statement that the PR
  // implements that issue, so it is a reliable requirements pointer. Searching the full
  // formatted metadata is intentional: non-description fields are structured labels emitted by
  // formatPrView, and a closing-keyword phrase in the title is still an explicit PR signal.
  const closingMatch = prMetadata.match(GITHUB_CLOSING_KEYWORD_PATTERN);
  if (closingMatch?.[1]) {
    return closingMatch[1];
  }

  // Otherwise fall back to an issue URL anywhere in the body, but only when it is
  // unambiguous: with several distinct issue links (e.g. "see also" references) picking one
  // would silently review against the wrong requirements, so leave it to the discovery agent.
  const bodyUrls = new Set(
    Array.from(prMetadata.matchAll(new RegExp(GITHUB_ISSUE_URL_PATTERN, 'gi'))).map((match) =>
      normalizeGithubIssueUrl(match[0])
    )
  );
  if (bodyUrls.size === 1) {
    return bodyUrls.values().next().value;
  }

  return undefined;
}

function normalizeGithubIssueUrl(url: string): string {
  return `https://${url.replace(/^https?:\/\//i, '')}`;
}

function formatGithubIssueRef(ref: string): string {
  return /^\d+$/.test(ref) ? `#${ref}` : ref;
}

function extractGithubPrNumber(prMetadata: string): string | undefined {
  // formatPrView emits "GitHub PR: #<number>" as the first line when the number is known.
  return prMetadata.match(/GitHub PR:\s*#(\d+)/)?.[1];
}

// Jira project keys are at least two letters followed by letters/digits (e.g. ABC-123,
// never A-1). Kept case-sensitive for bare keys: lowercase look-alikes in branch names or
// prose ("fix-123") are too ambiguous for the deterministic path.
const JIRA_ISSUE_KEY_PATTERN = /\b([A-Z]{2}[A-Z0-9]*-\d+)\b/;
// Atlassian browse URL, e.g. https://company.atlassian.net/browse/ABC-123. Unlike bare keys,
// URL-extracted keys are matched case-insensitively and normalized because the structured
// /browse/<key> path makes the intent clear while copied URLs can vary in casing.
const ATLASSIAN_BROWSE_URL_PATTERN = /atlassian\.net\/browse\/([A-Z]{2}[A-Z0-9]*-\d+)/i;

function extractJiraIssueKey(prMetadata: string): string | undefined {
  const lines = prMetadata.split('\n');
  const requirementsLine = lines.find((line) => /requirements?/i.test(line));

  if (requirementsLine) {
    const urlMatch = requirementsLine.match(ATLASSIAN_BROWSE_URL_PATTERN);
    if (urlMatch?.[1]) {
      return urlMatch[1].toUpperCase();
    }
    // Bare ticket key on a requirements line, e.g. "Requirements: ABC-123"
    const keyMatch = requirementsLine.match(JIRA_ISSUE_KEY_PATTERN);
    if (keyMatch?.[1]) {
      return keyMatch[1];
    }
  }

  // A key in the head branch name (feature/ABC-123-description convention) is an explicit
  // statement of which issue the branch implements.
  const headBranchLine = lines.find((line) => line.startsWith('Head branch:'));
  const branchKeyMatch = headBranchLine?.match(JIRA_ISSUE_KEY_PATTERN);
  if (branchKeyMatch?.[1]) {
    return branchKeyMatch[1];
  }

  // Otherwise fall back to an Atlassian browse URL anywhere in the body, but - mirroring the
  // GitHub path - only when it is unambiguous: with several distinct links (e.g. "see also"
  // references) picking one would silently review against the wrong requirements.
  const bodyKeys = new Set(
    Array.from(prMetadata.matchAll(new RegExp(ATLASSIAN_BROWSE_URL_PATTERN, 'gi'))).map((match) =>
      match[1].toUpperCase()
    )
  );
  if (bodyKeys.size === 1) {
    return bodyKeys.values().next().value;
  }

  return undefined;
}

function buildPrAutoUserMessage(state: PrAutoToolState): string {
  const diffStatus = state.diff
    ? 'A current-branch PR diff has already been deterministically retrieved and set. Verify whether it is sufficient; replace it (gh_diff sets it automatically, or use set_diff) only if you find a better exact diff.'
    : 'No PR diff has been set yet. Retrieve the PR diff with gh_diff, which stores it automatically; use set_diff only for a diff obtained some other way.';

  const requirementsStatus = state.requirements
    ? 'Requirements have already been retrieved from the PR description. Verify whether they are sufficient; replace them with set_requirements only if you find better exact requirements.'
    : 'Requirements have not been set yet. First inspect the PR description below for an explicit requirements link before trying issue-number guesses.';

  const prMetadataBlock = state.prMetadata
    ? `\n\nCurrent PR metadata already fetched with gh_pr:\n<pr-metadata>\n${state.prMetadata}\n</pr-metadata>`
    : '';

  return `${diffStatus}\n\n${requirementsStatus}${prMetadataBlock}

Discover the requirements for the current PR, then call set_requirements. Prefer an explicit requirements link from the PR description over searching nearby issue numbers. You may inspect linked GitHub issues, Jira MCP tools, and any other configured tools. Finish only after the diff and requirements have both been set.`;
}
