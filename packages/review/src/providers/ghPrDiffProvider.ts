import type { ProviderConfig } from './types.js';
import { execAsync } from '#src/utils/systemUtils.js';
import { ProgressIndicator } from '#src/utils/ProgressIndicator.js';

/**
 * Gets PR diff using GitHub CLI
 * @param _ config (unused in this provider)
 * @param prId GitHub PR number
 * @returns GitHub PR diff content or null if not found
 */
export async function get(
  _: ProviderConfig | null,
  prId: string | undefined
): Promise<string | null> {
  if (!prId) {
    throw new Error('No GitHub PR number provided');
  }

  // Use the GitHub CLI to fetch PR diff
  const progress = new ProgressIndicator(`Fetching GitHub PR #${prId} diff`);
  try {
    const prDiffContent = await execAsync(`gh pr diff ${prId}`);
    progress.stop();

    if (!prDiffContent) {
      throw new Error(`No diff content found for GitHub PR #${prId}`);
    }

    return `GitHub PR Diff: #${prId}\n\n${prDiffContent}`;
  } catch (error) {
    progress.stop();
    throw new Error(`Failed to get GitHub PR diff #${prId}: ${error instanceof Error ? error.message : String(error)}
Consider checking if gh cli (https://cli.github.com/) is installed and authenticated.`);
  }
}
