import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

// Define mocks at the top level
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
  readMultipleFilesFromCurrentDir: vi.fn(),
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
};

const configMock = {
  initConfig: vi.fn(),
};

vi.mock('#src/prompt.js', () => prompt);
vi.mock('#src/config.js', () => configMock);
vi.mock('#src/utils.js', () => utilsMock);

describe('reviewCommand', () => {
  beforeEach(async () => {
    vi.resetAllMocks();

    // Setup default mock returns
    configMock.initConfig.mockResolvedValue(mockConfig);
    utilsMock.readFileFromCurrentDir.mockReturnValue('FILE TO REVIEW');
    utilsMock.readMultipleFilesFromCurrentDir.mockReturnValue(
      'test.file:\n```\nFILE TO REVIEW\n```'
    );
    utilsMock.readFileSyncWithMessages.mockReturnValue('content-id');
    utilsMock.execAsync.mockResolvedValue('');
    prompt.readBackstory.mockReturnValue('INTERNAL BACKSTORY');
    prompt.readGuidelines.mockReturnValue('PROJECT GUIDELINES');
    prompt.readReviewInstructions.mockReturnValue('REVIEW INSTRUCTIONS');
    prompt.readSystemPrompt.mockReturnValue('');
  });

  it('Should call review with file contents', async () => {
    const { reviewCommand } = await import('#src/commands/reviewCommand.js');
    const program = new Command();

    reviewCommand(program);
    await program.parseAsync(['na', 'na', 'review', '-f', 'test.file']);

    expect(review).toHaveBeenCalledWith(
      'REVIEW',
      'INTERNAL BACKSTORY\nPROJECT GUIDELINES\nREVIEW INSTRUCTIONS',
      'test.file:\n```\nFILE TO REVIEW\n```',
      expect.objectContaining({
        projectGuidelines: '.gsloth.guidelines.md',
        projectReviewInstructions: '.gsloth.review.md',
      })
    );
  });

  it('Should call review with multiple file contents', async () => {
    const { reviewCommand } = await import('#src/commands/reviewCommand.js');
    const program = new Command();

    reviewCommand(program);

    utilsMock.readMultipleFilesFromCurrentDir.mockReturnValue(
      'test.file:\n```\nFILE TO REVIEW\n```\n\ntest2.file:\n```\nFILE2 TO REVIEW\n```'
    );

    await program.parseAsync(['na', 'na', 'review', '-f', 'test.file', 'test2.file']);

    expect(review).toHaveBeenCalledWith(
      'REVIEW',
      'INTERNAL BACKSTORY\nPROJECT GUIDELINES\nREVIEW INSTRUCTIONS',
      'test.file:\n```\nFILE TO REVIEW\n```\n\ntest2.file:\n```\nFILE2 TO REVIEW\n```',
      expect.objectContaining({
        projectGuidelines: '.gsloth.guidelines.md',
        projectReviewInstructions: '.gsloth.review.md',
      })
    );
  });

  it('Should display predefined providers in help', async () => {
    const { reviewCommand } = await import('#src/commands/reviewCommand.js');
    const program = new Command();
    const testOutput = { text: '' };

    program.configureOutput({
      writeOut: (str: string) => (testOutput.text += str),
      writeErr: (str: string) => (testOutput.text += str),
    });

    reviewCommand(program);

    const commandUnderTest = program.commands.find((c) => c.name() === 'review');
    expect(commandUnderTest).toBeDefined();
    commandUnderTest?.outputHelp();

    // Verify content providers are displayed
    expect(testOutput.text).toContain('--content-provider <contentProvider>');
    expect(testOutput.text).toContain('(choices: "github", "text", "file")');

    // Verify requirements providers are displayed
    expect(testOutput.text).toContain('--requirements-provider <requirementsProvider>');
    expect(testOutput.text).toContain('(choices: "jira-legacy", "jira", "github", "text", "file")');
  });

  it('Should call review with predefined requirements provider', async () => {
    // Setup specific config for this test
    const testConfig = {
      ...mockConfig,
      requirementsProvider: 'jira-legacy',
      requirementsProviderConfig: {
        'jira-legacy': {
          username: 'test-user',
          token: 'test-token',
          baseUrl: 'https://test-jira.atlassian.net/rest/api/2/issue/',
        },
      },
      contentProvider: 'text',
      commands: {
        pr: {
          contentProvider: 'github',
          requirementsProvider: 'jira-legacy',
        },
        review: {
          requirementsProvider: 'jira-legacy',
          contentProvider: 'text',
        },
      },
      streamOutput: false,
    };
    configMock.initConfig.mockResolvedValue(testConfig);

    const { reviewCommand } = await import('#src/commands/reviewCommand.js');
    const program = new Command();

    // Mock the jira provider
    const jiraProvider = vi.fn().mockResolvedValue('JIRA Requirements');
    vi.doMock('#src/providers/jiraIssueLegacyProvider.js', () => ({
      get: jiraProvider,
    }));

    reviewCommand(program);
    await program.parseAsync(['na', 'na', 'review', 'content-id', '-r', 'JIRA-123']);

    expect(review).toHaveBeenCalledWith(
      'REVIEW',
      'INTERNAL BACKSTORY\nPROJECT GUIDELINES\nREVIEW INSTRUCTIONS',
      'JIRA Requirements\ncontent-id',
      expect.objectContaining({
        requirementsProvider: 'jira-legacy',
        projectGuidelines: '.gsloth.guidelines.md',
        projectReviewInstructions: '.gsloth.review.md',
      })
    );
  });

  it('Should call review with predefined content provider', async () => {
    // Setup specific config for this test
    const testConfig = {
      ...mockConfig,
      contentProvider: 'github',
      requirementsProvider: 'text',
      commands: {
        pr: {
          contentProvider: 'github',
          requirementsProvider: 'text',
        },
        review: {
          requirementsProvider: 'text',
          contentProvider: 'github',
        },
      },
      streamOutput: false,
    };
    configMock.initConfig.mockResolvedValue(testConfig);

    const { reviewCommand } = await import('#src/commands/reviewCommand.js');
    const program = new Command();

    // Mock the gh provider
    const ghProvider = vi.fn().mockResolvedValue('PR Diff Content');
    vi.doMock('#src/providers/ghPrDiffProvider.js', () => ({
      get: ghProvider,
    }));

    reviewCommand(program);
    await program.parseAsync(['na', 'na', 'review', '123']);

    expect(review).toHaveBeenCalledWith(
      'REVIEW',
      'INTERNAL BACKSTORY\nPROJECT GUIDELINES\nREVIEW INSTRUCTIONS',
      'PR Diff Content',
      expect.objectContaining({
        contentProvider: 'github',
        projectGuidelines: '.gsloth.guidelines.md',
        projectReviewInstructions: '.gsloth.review.md',
      })
    );
  });

  it('Should call review with message parameter', async () => {
    const { reviewCommand } = await import('#src/commands/reviewCommand.js');
    const program = new Command();

    reviewCommand(program);
    await program.parseAsync([
      'na',
      'na',
      'review',
      '-f',
      'test.file',
      '-m',
      'Please check for memory leaks',
    ]);

    expect(review).toHaveBeenCalledWith(
      'REVIEW',
      'INTERNAL BACKSTORY\nPROJECT GUIDELINES\nREVIEW INSTRUCTIONS',
      'test.file:\n```\nFILE TO REVIEW\n```\nPlease check for memory leaks',
      expect.objectContaining({
        projectGuidelines: '.gsloth.guidelines.md',
        projectReviewInstructions: '.gsloth.review.md',
      })
    );
  });

  it('Should call review with message and content provider', async () => {
    // Setup specific config for this test
    const testConfig = {
      ...mockConfig,
      contentProvider: 'github',
      streamOutput: false,
    };
    configMock.initConfig.mockResolvedValue(testConfig);

    const { reviewCommand } = await import('#src/commands/reviewCommand.js');
    const program = new Command();

    // Mock the gh provider
    const ghProvider = vi.fn().mockResolvedValue('PR Diff Content');
    vi.doMock('#src/providers/ghPrDiffProvider.js', () => ({
      get: ghProvider,
    }));

    reviewCommand(program);
    await program.parseAsync(['na', 'na', 'review', '123', '-m', 'Focus on code style']);

    expect(review).toHaveBeenCalledWith(
      'REVIEW',
      'INTERNAL BACKSTORY\nPROJECT GUIDELINES\nREVIEW INSTRUCTIONS',
      'PR Diff Content\nFocus on code style',
      expect.objectContaining({
        contentProvider: 'github',
        projectGuidelines: '.gsloth.guidelines.md',
        projectReviewInstructions: '.gsloth.review.md',
      })
    );
  });
});
