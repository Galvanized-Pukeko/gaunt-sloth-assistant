import type { ProviderConfig } from './types.js';
import { execAsync } from '@gaunt-sloth/core/utils/systemUtils.js';
import { ProgressIndicator } from '@gaunt-sloth/core/utils/ProgressIndicator.js';

/**
 * Gets PR diff using GitHub CLI
 * @param _ config (unused in this source)
 * @param prId GitHub PR number. When omitted, GitHub CLI resolves the PR for the current branch.
 * @returns GitHub PR diff content or null if not found
 */
export async function get(
  _: ProviderConfig | null,
  prId: string | undefined
): Promise<string | null> {
  const prLabel = prId ? `#${prId}` : 'for current branch';
  const ghCommand = prId ? `gh pr diff ${prId}` : 'gh pr diff';

  // Use the GitHub CLI to fetch PR diff
  const progress = new ProgressIndicator(`Fetching GitHub PR ${prLabel} diff`);
  try {
    const prDiffContent = await execAsync(ghCommand);
    progress.stop();

    if (!prDiffContent) {
      throw new Error(`No diff content found for GitHub PR ${prLabel}`);
    }

    return `GitHub PR Diff: ${prLabel}\n\n${prDiffContent}`;
  } catch (error) {
    progress.stop();
    throw new Error(`Failed to get GitHub PR diff ${prLabel}: ${error instanceof Error ? error.message : String(error)}
Consider checking if gh cli (https://cli.github.com/) is installed and authenticated.`);
  }
}
