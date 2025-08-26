import { displayWarning } from '#src/utils/consoleUtils.js';
import type { ProviderConfig } from './types.js';
import { execAsync } from '#src/utils/systemUtils.js';
import { ProgressIndicator } from '#src/utils/ProgressIndicator.js';

/**
 * Gets GitHub issue using GitHub CLI
 * @param _ config (unused in this provider)
 * @param issueId GitHub issue number
 * @returns GitHub issue content or null if not found
 */
export async function get(
  _: ProviderConfig | null,
  issueId: string | undefined
): Promise<string | null> {
  if (!issueId) {
    displayWarning('No GitHub issue number provided');
    return null;
  }

  try {
    // Use the GitHub CLI to fetch issue details
    const progress = new ProgressIndicator(`Fetching GitHub issue #${issueId}`);
    const issueContent = await execAsync(`gh issue view ${issueId}`);
    progress.stop();

    if (!issueContent) {
      displayWarning(`No content found for GitHub issue #${issueId}`);
      return null;
    }

    return `GitHub Issue: #${issueId}\n\n${issueContent}`;
  } catch (error) {
    displayWarning(`
Failed to get GitHub issue #${issueId}: ${error instanceof Error ? error.message : String(error)}
Consider checking if gh cli (https://cli.github.com/) is installed and authenticated.
    `);
    return null;
  }
}
