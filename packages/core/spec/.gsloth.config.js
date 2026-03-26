export async function configure(importFunction, _global) {
  const test = await importFunction('@langchain/core/utils/testing');
  return {
    llm: new test.FakeListChatModel({
      responses: ['First LLM message', 'Second LLM message'],
    }),
    requirementsProviderConfig: {
      'jira-legacy': {
        username: 'user.name@company.com', // Your Jira username/email
        token: 'YoUrToKeN', // Replace with your real Jira API token
        baseUrl: 'https://company.atlassian.net/rest/api/2/issue/', // Your Jira instance base URL
      },
    },
    requirementsProvider: 'jira-legacy',
    contentProvider: 'somethingSpecial',
    contentProviderConfig: {
      somethingSpecial: {
        test: 'example',
      },
    },
  };
}
