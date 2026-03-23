import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

// Make randomUUID deterministic across this spec to stabilize wrapContent output
vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto');
  return {
    ...actual,
    randomUUID: () => '12345678-aaaa-bbbb-cccc-1234567890ab',
  };
});

// Define mocks at the top level
const resolversMock = {
  createResolvers: vi.fn(),
};
vi.mock('@gaunt-sloth/api/resolvers.js', () => resolversMock);

const review = vi.fn();
const prompt = {
  readBackstory: vi.fn(),
  readGuidelines: vi.fn(),
  readReviewInstructions: vi.fn(),
  readSystemPrompt: vi.fn(),
};

// Use a direct mock for the review function instead of a nested implementation
vi.mock('#src/modules/reviewModule.js', () => ({
  review: review,
}));

const utilsMock = {
  readFileFromCurrentDir: vi.fn(),
  readMultipleFilesFromProjectDir: vi.fn(),
  readFileSyncWithMessages: vi.fn(),
  execAsync: vi.fn(),
  ProgressIndicator: vi.fn(),
  extractLastMessageContent: vi.fn(),
  toFileSafeString: vi.fn(),
  fileSafeLocalDate: vi.fn(),
  generateStandardFileName: vi.fn(),
};

// Set up static mocks
const mockConfig = {
  llm: { invoke: vi.fn() } as unknown as BaseChatModel,
  projectGuidelines: '.gsloth.guidelines.md',
  projectReviewInstructions: '.gsloth.review.md',
  contentProvider: 'file',
  requirementsProvider: 'file',
  streamOutput: true,
  commands: {
    pr: {
      contentProvider: 'github',
      requirementsProvider: 'github',
    },
    review: {},
  },
  filesystem: 'none',
  useColour: false,
  writeOutputToFile: true,
  streamSessionInferenceLog: true,
  canInterruptInferenceWithEsc: true,
};

const configMock = {
  initConfig: vi.fn(),
};

vi.mock('#src/utils/llmUtils.js', async () => {
  const actual = await import('#src/utils/llmUtils.js');
  return {
    ...actual,
    readBackstory: prompt.readBackstory,
    readGuidelines: prompt.readGuidelines,
    readReviewInstructions: prompt.readReviewInstructions,
    readSystemPrompt: prompt.readSystemPrompt,
  };
});
vi.mock('#src/config.js', () => configMock);
vi.mock('#src/utils/utils.js', () => utilsMock);

describe('prCommand', () => {
  beforeEach(async () => {
    vi.resetAllMocks();

    // Setup default mock returns
    configMock.initConfig.mockResolvedValue(mockConfig);
    utilsMock.readFileFromCurrentDir.mockReturnValue('FILE TO REVIEW');
    utilsMock.readMultipleFilesFromProjectDir.mockReturnValue(
      'test.file:\n```\nFILE TO REVIEW\n```'
    );
    utilsMock.readFileSyncWithMessages.mockReturnValue('content-id');
    utilsMock.execAsync.mockResolvedValue('');
    prompt.readBackstory.mockReturnValue('INTERNAL BACKSTORY');
    prompt.readGuidelines.mockReturnValue('PROJECT GUIDELINES');
    prompt.readReviewInstructions.mockReturnValue('REVIEW INSTRUCTIONS');
    prompt.readSystemPrompt.mockReturnValue('');

    resolversMock.createResolvers.mockReturnValue({ resolveTools: vi.fn(), cleanupTools: vi.fn() });
  });

  it('Should call pr command', async () => {
    // Setup specific config for this test
    const testConfig = {
      ...mockConfig,
      contentProvider: 'text',
      requirementsProvider: 'text',
      commands: {
        pr: {
          contentProvider: 'github',
          requirementsProvider: 'text',
        },
        review: {
          requirementsProvider: 'text',
          contentProvider: 'text',
        },
      },
      streamOutput: false,
    };
    configMock.initConfig.mockResolvedValue(testConfig);

    const { prCommand } = await import('#src/commands/prCommand.js');
    const program = new Command();

    // Mock the gh provider
    const ghProvider = vi.fn().mockResolvedValue('PR Diff Content');
    vi.doMock('#src/sources/ghPrDiffSource.js', () => ({
      get: ghProvider,
    }));

    prCommand(program, {});
    await program.parseAsync(['na', 'na', 'pr', '123']);

    expect(review).toHaveBeenCalledWith(
      'PR-123',
      'INTERNAL BACKSTORY\nPROJECT GUIDELINES\nREVIEW INSTRUCTIONS',
      '\nProvided GitHub diff follows within github-1234567 block\n<github-1234567>\nPR Diff Content\n</github-1234567>\n',
      expect.objectContaining({
        contentProvider: 'text',
        projectGuidelines: '.gsloth.guidelines.md',
        projectReviewInstructions: '.gsloth.review.md',
      }),
      'pr',
      expect.any(Object)
    );
  });

  it('Should call pr command with requirements', async () => {
    // Setup specific config for this test
    const testConfig = {
      ...mockConfig,
      requirementsProvider: 'text',
      commands: {
        pr: {
          contentProvider: 'github',
          requirementsProvider: 'text',
        },
        review: {},
      },
      streamOutput: false,
    };
    configMock.initConfig.mockResolvedValue(testConfig);

    const { prCommand } = await import('#src/commands/prCommand.js');
    const program = new Command();

    // Mock the gh provider
    const ghProvider = vi.fn().mockResolvedValue('PR Diff Content');
    vi.doMock('#src/sources/ghPrDiffSource.js', () => ({
      get: ghProvider,
    }));

    // Mock the text provider for requirements
    const textProvider = vi.fn().mockResolvedValue('Requirements content');
    vi.doMock('#src/sources/textSource.js', () => ({
      get: textProvider,
    }));

    prCommand(program, {});
    await program.parseAsync(['na', 'na', 'pr', '123', 'req-456']);

    expect(review).toHaveBeenCalledWith(
      'PR-123',
      'INTERNAL BACKSTORY\nPROJECT GUIDELINES\nREVIEW INSTRUCTIONS',
      '\nProvided requirements follows within text-1234567 block\n<text-1234567>\nRequirements content\n</text-1234567>\n\n\nProvided GitHub diff follows within github-1234567 block\n<github-1234567>\nPR Diff Content\n</github-1234567>\n',
      expect.objectContaining({
        projectGuidelines: '.gsloth.guidelines.md',
        projectReviewInstructions: '.gsloth.review.md',
      }),
      'pr',
      expect.any(Object)
    );
  });

  it('Should display meaningful error, when JIRA is enabled, but JIRA token is absent', async () => {
    // Setup config that will trigger JIRA error (missing token)
    const errorConfig = {
      ...mockConfig,
      requirementsProvider: 'jira-legacy',
      requirementsProviderConfig: {
        'jira-legacy': {
          username: 'test-user',
          baseUrl: 'https://test-jira.atlassian.net/rest/api/2/issue/',
          // Note: no token provided
        },
      },
      commands: {
        pr: {
          contentProvider: 'github',
          requirementsProvider: 'jira-legacy',
        },
        review: {},
      },
    };
    configMock.initConfig.mockResolvedValue(errorConfig);

    const testOutput = { text: '' };

    // Mock systemUtils to ensure environment variables don't interfere with the test
    vi.mock('#src/utils/systemUtils.js', () => ({
      env: {}, // Empty env object to ensure no environment variables are used
      error: vi.fn(),
      exit: vi.fn(),
      getCurrentWorkDir: vi.fn().mockReturnValue('/mock/dir'),
    }));

    const { prCommand } = await import('#src/commands/prCommand.js');
    const program = new Command();
    program.configureOutput({
      writeOut: (str: string) => (testOutput.text += str),
      writeErr: (str: string) => (testOutput.text += str),
    });

    prCommand(program, {});

    await expect(program.parseAsync(['na', 'na', 'pr', 'content-id', 'JIRA-123'])).rejects.toThrow(
      'Missing JIRA Legacy API token. ' +
        'The legacy token can be defined as JIRA_LEGACY_API_TOKEN environment variable ' +
        'or as "token" in config.'
    );
  });

  it('Should display predefined providers in help', async () => {
    const { prCommand } = await import('#src/commands/prCommand.js');
    const program = new Command();
    const testOutput = { text: '' };

    program.configureOutput({
      writeOut: (str: string) => (testOutput.text += str),
      writeErr: (str: string) => (testOutput.text += str),
    });

    prCommand(program, {});

    const commandUnderTest = program.commands.find((c) => c.name() === 'pr');
    expect(commandUnderTest).toBeDefined();
    commandUnderTest?.outputHelp();

    // Verify requirements providers are displayed
    expect(testOutput.text).toContain('--requirements-provider <requirementsProvider>');
    expect(testOutput.text).toContain('(choices: "jira-legacy", "jira", "github", "text", "file")');
  });

  it('Should call pr command with message parameter', async () => {
    // Setup specific config for this test
    const testConfig = {
      ...mockConfig,
      contentProvider: 'text',
      requirementsProvider: 'text',
      commands: {
        pr: {
          contentProvider: 'github',
          requirementsProvider: 'text',
        },
        review: {
          requirementsProvider: 'text',
          contentProvider: 'text',
        },
      },
      streamOutput: false,
    };
    configMock.initConfig.mockResolvedValue(testConfig);

    const { prCommand } = await import('#src/commands/prCommand.js');
    const program = new Command();

    // Mock the gh provider
    const ghProvider = vi.fn().mockResolvedValue('PR Diff Content');
    vi.doMock('#src/sources/ghPrDiffSource.js', () => ({
      get: ghProvider,
    }));

    prCommand(program, {});
    await program.parseAsync([
      'na',
      'na',
      'pr',
      '123',
      '-m',
      'Please pay attention to security issues',
    ]);

    expect(review).toHaveBeenCalledWith(
      'PR-123',
      'INTERNAL BACKSTORY\nPROJECT GUIDELINES\nREVIEW INSTRUCTIONS',
      '\nProvided GitHub diff follows within github-1234567 block\n<github-1234567>\nPR Diff Content\n</github-1234567>\n\n\nProvided user message follows within message-1234567 block\n<message-1234567>\nPlease pay attention to security issues\n</message-1234567>\n',
      expect.objectContaining({
        contentProvider: 'text',
        projectGuidelines: '.gsloth.guidelines.md',
        projectReviewInstructions: '.gsloth.review.md',
      }),
      'pr',
      expect.any(Object)
    );
  });

  it('Should call pr command with message and requirements', async () => {
    // Setup specific config for this test
    const testConfig = {
      ...mockConfig,
      requirementsProvider: 'text',
      commands: {
        pr: {
          contentProvider: 'github',
          requirementsProvider: 'text',
        },
        review: {},
      },
      streamOutput: false,
    };
    configMock.initConfig.mockResolvedValue(testConfig);

    const { prCommand } = await import('#src/commands/prCommand.js');
    const program = new Command();

    // Mock the gh provider
    const ghProvider = vi.fn().mockResolvedValue('PR Diff Content');
    vi.doMock('#src/sources/ghPrDiffSource.js', () => ({
      get: ghProvider,
    }));

    // Mock the text provider for requirements
    const textProvider = vi.fn().mockResolvedValue('Requirements content');
    vi.doMock('#src/sources/textSource.js', () => ({
      get: textProvider,
    }));

    prCommand(program, {});
    await program.parseAsync(['na', 'na', 'pr', '123', 'req-456', '-m', 'Focus on performance']);

    expect(review).toHaveBeenCalledWith(
      'PR-123',
      'INTERNAL BACKSTORY\nPROJECT GUIDELINES\nREVIEW INSTRUCTIONS',
      '\nProvided requirements follows within text-1234567 block\n<text-1234567>\nRequirements content\n</text-1234567>\n\n\nProvided GitHub diff follows within github-1234567 block\n<github-1234567>\nPR Diff Content\n</github-1234567>\n\n\nProvided user message follows within message-1234567 block\n<message-1234567>\nFocus on performance\n</message-1234567>\n',
      expect.objectContaining({
        projectGuidelines: '.gsloth.guidelines.md',
        projectReviewInstructions: '.gsloth.review.md',
      }),
      'pr',
      expect.any(Object)
    );
  });
});
