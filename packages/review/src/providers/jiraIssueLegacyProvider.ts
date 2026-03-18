import { display, displayError, displayWarning } from '#src/utils/consoleUtils.js';
import { env } from '#src/utils/systemUtils.js';
import type { JiraLegacyConfig } from '#src/providers/types.js';

interface JiraIssueResponse {
  fields: {
    summary: string;
    description: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Gets Jira issue using Atlassian REST API v2 with unscoped API token (aka Legacy Token)
 * @param config Jira configuration
 * @param issueId Jira issue ID
 * @returns Jira issue content
 */
export async function get(
  config: Partial<JiraLegacyConfig>,
  issueId: string | undefined
): Promise<string | null> {
  if (!config) {
    displayWarning('No Jira config provided');
    return null;
  }
  if (!issueId) {
    displayWarning('No issue ID provided');
    return null;
  }
  if (!config.baseUrl) {
    displayWarning('No Jira base URL provided');
    return null;
  }

  // Get username from environment variable or config
  const username = env.JIRA_USERNAME || config.username;
  if (!username) {
    throw new Error(
      'Missing JIRA username. The username can be defined as JIRA_USERNAME environment variable or as "username" in config.'
    );
  }

  // Get token from environment variable or config
  const token = env.JIRA_LEGACY_API_TOKEN || config.token;
  if (!token) {
    throw new Error(
      'Missing JIRA Legacy API token. The legacy token can be defined as JIRA_LEGACY_API_TOKEN environment variable or as "token" in config.'
    );
  }

  try {
    const issue = await getJiraIssue(
      {
        ...(config as JiraLegacyConfig),
        username,
        token,
      },
      issueId
    );
    if (!issue) {
      return null;
    }

    const summary = issue.fields.summary;
    const description = issue.fields.description;

    return `Jira Issue: ${issueId}\nSummary: ${summary}\n\nDescription:\n${description}`;
  } catch (error) {
    displayError(
      `Failed to get Jira issue: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

/**
 * Helper function to get Jira issue details
 * @param config Jira configuration
 * @param issueId Jira issue ID
 * @returns Jira issue response
 */
async function getJiraIssue(config: JiraLegacyConfig, issueId: string): Promise<JiraIssueResponse> {
  const auth = Buffer.from(`${config.username}:${config.token}`).toString('base64');
  const url = `${config.baseUrl}${issueId}`;
  if (config.displayUrl) {
    display(`Loading Jira issue ${config.displayUrl}${issueId}`);
  }
  display(`Retrieving jira from api ${url.replace(/^https?:\/\//, '')}`);
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Jira issue from ${url} with status: ${response.statusText}`);
  }

  return response.json();
}
