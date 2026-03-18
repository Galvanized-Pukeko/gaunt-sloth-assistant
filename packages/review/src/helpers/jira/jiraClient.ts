import { env } from '#src/utils/systemUtils.js';
import type { JiraConfig } from '#src/providers/types.js';

import { ProgressIndicator } from '#src/utils/ProgressIndicator.js';

export interface ResolvedJiraCredentials {
  cloudId: string;
  username?: string;
  token?: string;
  fullBase64Token?: string;
  displayUrl?: string;
}

export function getJiraCredentials(config: Partial<JiraConfig> | null): ResolvedJiraCredentials {
  if (!config) {
    throw new Error('No Jira config provided');
  }

  const cloudId = env.JIRA_CLOUD_ID || config.cloudId;
  if (!cloudId) {
    throw new Error(
      'Missing JIRA Cloud ID. The Cloud ID can be defined as JIRA_CLOUD_ID environment variable or as "cloudId" in config.'
    );
  }

  const fullBase64Token = env.JIRA_FULL_BASE64_TOKEN || config.fullBase64Token;
  if (fullBase64Token) {
    return {
      cloudId,
      fullBase64Token,
      displayUrl: config.displayUrl,
    };
  }

  const username = env.JIRA_USERNAME || config.username;
  if (!username) {
    throw new Error(
      'Missing JIRA username. The username can be defined as JIRA_USERNAME environment variable or as "username" in config.'
    );
  }

  const token = env.JIRA_API_PAT_TOKEN || config.token;
  if (!token) {
    throw new Error(
      'Missing JIRA PAT token. The token can be defined as JIRA_API_PAT_TOKEN environment variable or as "token" in config.'
    );
  }

  return {
    cloudId,
    username,
    token,
    displayUrl: config.displayUrl,
  };
}

export function getJiraHeaders(config: ResolvedJiraCredentials): Record<string, string> {
  const authHeader = config.fullBase64Token
    ? `Basic ${config.fullBase64Token}`
    : `Basic ${Buffer.from(`${config.username}:${config.token}`).toString('base64')}`;

  return {
    Authorization: authHeader,
    Accept: 'application/json; charset=utf-8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Content-Type': 'application/json',
  };
}

export async function jiraRequest<T>(
  config: ResolvedJiraCredentials,
  endpoint: string,
  options: RequestInit = {},
  showProgress = true
): Promise<T> {
  const apiUrl = `https://api.atlassian.com/ex/jira/${config.cloudId}${endpoint}`;
  const headers = getJiraHeaders(config);

  let progressIndicator: ProgressIndicator | undefined;
  if (showProgress) {
    progressIndicator = new ProgressIndicator(
      `${options.method || 'GET'} ${apiUrl.replace(/^https?:\/\//, '')}`
    );
  }

  try {
    const response = await fetch(apiUrl, {
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
    });

    if (progressIndicator) {
      progressIndicator.stop();
    }

    if (!response.ok) {
      let errorMessage = `Failed to fetch from Jira: ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorMessage += ` - ${JSON.stringify(errorData)}`;
      } catch {
        // If we can't parse JSON error, use the basic message
      }
      throw new Error(errorMessage);
    }

    return response.json() as Promise<T>;
  } catch (error) {
    if (progressIndicator) {
      progressIndicator.stop();
    }
    throw error;
  }
}
