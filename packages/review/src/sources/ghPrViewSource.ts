import type { ProviderConfig } from './types.js';
import { execAsync } from '@gaunt-sloth/core/utils/systemUtils.js';
import { ProgressIndicator } from '@gaunt-sloth/core/utils/ProgressIndicator.js';
import { debugLog } from '@gaunt-sloth/core/utils/debugUtils.js';

interface GhPrViewResponse {
  number?: number;
  title?: string;
  body?: string;
  url?: string;
  headRefName?: string;
  baseRefName?: string;
}

/**
 * Gets GitHub PR metadata using GitHub CLI.
 * @param _ config (unused in this source)
 * @param prId GitHub PR number. When omitted, GitHub CLI resolves the PR for the current branch.
 * @returns GitHub PR metadata or null if not found
 */
export async function get(
  _: ProviderConfig | null,
  prId: string | undefined
): Promise<string | null> {
  const prLabel = prId ? `#${prId}` : 'for current branch';
  const ghCommand = prId
    ? `gh pr view ${prId} --json number,title,body,url,headRefName,baseRefName`
    : 'gh pr view --json number,title,body,url,headRefName,baseRefName';

  const progress = new ProgressIndicator(`Fetching GitHub PR ${prLabel} metadata`);
  try {
    const prViewJson = await execAsync(ghCommand);
    progress.stop();

    if (!prViewJson) {
      throw new Error(`No metadata found for GitHub PR ${prLabel}`);
    }

    let prView: GhPrViewResponse;
    try {
      prView = JSON.parse(prViewJson) as GhPrViewResponse;
    } catch (parseError) {
      // gh can prepend warning lines to otherwise valid output; surface the raw output for
      // debugging since the rethrown message only carries the SyntaxError text.
      debugLog(`Failed to parse gh pr view output as JSON:\n${prViewJson}`);
      throw parseError;
    }
    return formatPrView(prView, prLabel);
  } catch (error) {
    progress.stop();
    throw new Error(`Failed to get GitHub PR ${prLabel} metadata: ${error instanceof Error ? error.message : String(error)}
Consider checking if gh cli (https://cli.github.com/) is installed and authenticated.`);
  }
}

function formatPrView(prView: GhPrViewResponse, fallbackLabel: string): string {
  const label = prView.number ? `#${prView.number}` : fallbackLabel;
  return [
    `GitHub PR: ${label}`,
    prView.title ? `Title: ${prView.title}` : undefined,
    prView.url ? `URL: ${prView.url}` : undefined,
    prView.headRefName ? `Head branch: ${prView.headRefName}` : undefined,
    prView.baseRefName ? `Base branch: ${prView.baseRefName}` : undefined,
    '',
    'Description:',
    prView.body || '',
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}
