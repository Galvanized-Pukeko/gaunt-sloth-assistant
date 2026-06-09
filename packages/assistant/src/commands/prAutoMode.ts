import type { GthConfig, PrAutoModeConfig } from '@gaunt-sloth/core/config.js';
import type { AgentResolvers } from '@gaunt-sloth/core/core/types.js';
import { GthAgentRunner } from '@gaunt-sloth/core/core/GthAgentRunner.js';
import {
  defaultStatusCallback,
  displayInfo,
  displayWarning,
} from '@gaunt-sloth/core/utils/consoleUtils.js';
import { buildSystemMessages, readPrAutoPrompt } from '@gaunt-sloth/core/utils/llmUtils.js';
import { HumanMessage } from '@langchain/core/messages';
import { StructuredToolInterface, tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createResolvers } from '@gaunt-sloth/api/resolvers.js';
import { get as getGhPrDiff } from '@gaunt-sloth/review/sources/ghPrDiffSource.js';
import { get as getGhPrView } from '@gaunt-sloth/review/sources/ghPrViewSource.js';
import { get as getGhIssue } from '@gaunt-sloth/review/sources/ghIssueSource.js';
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
      displayInfo('Auto mode retrieved current-branch PR metadata with gh.');
      const requirementsIssueId = extractRequirementsGithubIssueId(state.prMetadata);
      if (requirementsIssueId) {
        const requirements = await getGhIssue(
          getGithubRequirementsProviderConfig(config),
          requirementsIssueId
        );
        state.requirements = requirements ?? '';
        if (state.requirements) {
          displayInfo(
            `Auto mode retrieved requirements from GitHub issue #${requirementsIssueId} linked in the PR description.`
          );
        }
      }
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
