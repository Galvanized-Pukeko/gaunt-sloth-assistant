import { beforeEach, describe, expect, it, vi } from 'vitest';

const systemUtilsMock = {
  env: {} as Record<string, string>,
};
vi.mock('#src/utils/systemUtils.js', async () => {
  const actual = await vi.importActual<typeof import('#src/utils/systemUtils.js')>(
    '#src/utils/systemUtils.js'
  );
  return {
    ...actual,
    env: systemUtilsMock.env,
  };
});

describe('jiraClient', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    for (const key of Object.keys(systemUtilsMock.env)) {
      delete systemUtilsMock.env[key];
    }
  });

  it('Should use full base64 token when present', async () => {
    Object.assign(systemUtilsMock.env, {
      JIRA_FULL_BASE64_TOKEN: 'encoded-token',
      JIRA_CLOUD_ID: 'cloud-id',
    });

    const { getJiraCredentials, getJiraHeaders } = await import('#src/helpers/jira/jiraClient.js');

    const credentials = getJiraCredentials({ displayUrl: 'https://jira/' });

    expect(credentials).toEqual({
      cloudId: 'cloud-id',
      fullBase64Token: 'encoded-token',
      displayUrl: 'https://jira/',
    });
    expect(getJiraHeaders(credentials).Authorization).toBe('Basic encoded-token');
  });

  it('Should require cloud id even when full base64 token is present', async () => {
    Object.assign(systemUtilsMock.env, {
      JIRA_FULL_BASE64_TOKEN: 'encoded-token',
    });

    const { getJiraCredentials } = await import('#src/helpers/jira/jiraClient.js');

    expect(() => getJiraCredentials({})).toThrow(
      'Missing JIRA Cloud ID. The Cloud ID can be defined as JIRA_CLOUD_ID environment variable or as "cloudId" in config.'
    );
  });

  it('Should fallback to username and token when full token is absent', async () => {
    Object.assign(systemUtilsMock.env, {
      JIRA_USERNAME: 'jira-user',
      JIRA_API_PAT_TOKEN: 'jira-token',
      JIRA_CLOUD_ID: 'cloud-id',
    });

    const { getJiraCredentials, getJiraHeaders } = await import('#src/helpers/jira/jiraClient.js');

    const credentials = getJiraCredentials({});

    expect(credentials).toEqual({
      cloudId: 'cloud-id',
      username: 'jira-user',
      token: 'jira-token',
      displayUrl: undefined,
    });
    expect(getJiraHeaders(credentials).Authorization).toBe(
      `Basic ${Buffer.from('jira-user:jira-token').toString('base64')}`
    );
  });
});
