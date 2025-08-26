import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Make randomUUID deterministic across this spec
vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto');
  return {
    ...actual,
    randomUUID: () => '12345678-aaaa-bbbb-cccc-1234567890ab',
  };
});

// Define mocks at top level
const askQuestion = vi.fn();
const prompt = {
  readBackstory: vi.fn(),
  readGuidelines: vi.fn(),
  readSystemPrompt: vi.fn(),
};

const questionAnsweringModule = { askQuestion };

const utilsMock = {
  ProgressIndicator: vi.fn(),
  extractLastMessageContent: vi.fn(),
};
vi.mock('#src/utils/utils.js', () => utilsMock);
const fileUtilsMock = {
  readFileFromCurrentDir: vi.fn(),
  readMultipleFilesFromProjectDir: vi.fn(),
  toFileSafeString: vi.fn(),
  fileSafeLocalDate: vi.fn(),
  generateStandardFileName: vi.fn(),
};
vi.mock('#src/utils/fileUtils.js', () => fileUtilsMock);

// Mock config to return specific test values
const mockConfig = {
  llm: {
    invoke: vi.fn(),
  },
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
  },
  filesystem: 'none',
  useColour: false,
  writeOutputToFile: true,
  streamSessionInferenceLog: true,
  canInterruptInferenceWithEsc: true,
};

// Set up static mocks
vi.mock('#src/utils/llmUtils.js', async () => {
  const actual = await import('#src/utils/llmUtils.js');
  return {
    ...actual,
    readBackstory: prompt.readBackstory,
    readGuidelines: prompt.readGuidelines,
    readSystemPrompt: prompt.readSystemPrompt,
  };
});
vi.mock('#src/modules/questionAnsweringModule.js', () => questionAnsweringModule);
vi.mock('#src/utils/systemUtils.js', () => ({
  getStringFromStdin: vi.fn().mockReturnValue(''),
}));
const configMock = {
  initConfig: vi.fn(),
  createDefaultConfig: vi.fn(),
};

vi.mock('#src/config.js', () => configMock);

describe('askCommand', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.clearAllMocks();
    vi.resetModules();

    // Set up config mock
    configMock.initConfig.mockResolvedValue(mockConfig);
    configMock.createDefaultConfig.mockReturnValue(mockConfig);

    // Mock the util functions
    fileUtilsMock.readMultipleFilesFromProjectDir.mockImplementation((files: string[]) => {
      if (files.includes('test.file')) {
        return 'test.file:\n```\nFILE CONTENT\n```';
      }
      return '';
    });

    // Mock the prompt functions
    prompt.readBackstory.mockReturnValue('INTERNAL PREAMBLE');
    prompt.readGuidelines.mockReturnValue('PROJECT GUIDELINES');
    prompt.readSystemPrompt.mockReturnValue('');

    const progressIndicator = {
      start: vi.fn(),
      stop: vi.fn(),
    };
    utilsMock.ProgressIndicator.mockImplementation(() => progressIndicator);
  });

  it('Should call askQuestion with message', async () => {
    const { askCommand } = await import('#src/commands/askCommand.js');
    const program = new Command();
    askCommand(program, {});
    await program.parseAsync(['na', 'na', 'ask', 'test message']);
    // With deterministic UUID, the block id will be message-1234567
    expect(askQuestion).toHaveBeenCalledWith(
      'ASK',
      'INTERNAL PREAMBLE\nPROJECT GUIDELINES',
      '\nProvided user message follows within message-1234567 block\n<message-1234567>\ntest message\n</message-1234567>\n',
      mockConfig
    );
  });

  it('Should call askQuestion with message and file content', async () => {
    const { askCommand } = await import('#src/commands/askCommand.js');
    const program = new Command();
    askCommand(program, {});
    await program.parseAsync(['na', 'na', 'ask', 'test message', '-f', 'test.file']);
    expect(askQuestion).toHaveBeenCalledWith(
      'ASK',
      'INTERNAL PREAMBLE\nPROJECT GUIDELINES',
      'test.file:\n```\nFILE CONTENT\n```\n' +
        '\nProvided user message follows within message-1234567 block\n<message-1234567>\ntest message\n</message-1234567>\n',
      mockConfig
    );
  });

  it('Should call askQuestion with message and multiple file contents', async () => {
    const { askCommand } = await import('#src/commands/askCommand.js');
    const program = new Command();
    askCommand(program, {});
    fileUtilsMock.readMultipleFilesFromProjectDir.mockImplementation((files: string[]) => {
      if (files.includes('test.file') && files.includes('test2.file')) {
        return 'test.file:\n```\nFILE CONTENT\n```\n\ntest2.file:\n```\nFILE2 CONTENT\n```';
      }
      return '';
    });
    await program.parseAsync(['na', 'na', 'ask', 'test message', '-f', 'test.file', 'test2.file']);
    expect(askQuestion).toHaveBeenCalledWith(
      'ASK',
      'INTERNAL PREAMBLE\nPROJECT GUIDELINES',
      'test.file:\n```\nFILE CONTENT\n```\n\ntest2.file:\n```\nFILE2 CONTENT\n```\n' +
        '\nProvided user message follows within message-1234567 block\n<message-1234567>\ntest message\n</message-1234567>\n',
      mockConfig
    );
  });

  it('Should display help correctly', async () => {
    const { askCommand } = await import('#src/commands/askCommand.js');
    const program = new Command();
    askCommand(program, {});
    expect(program.commands[0].name()).toEqual('ask');
    expect(program.commands[0].description()).toEqual('Ask a question');
  });

  it('Should call askQuestion with file content only (no message)', async () => {
    const { askCommand } = await import('#src/commands/askCommand.js');
    const program = new Command();
    askCommand(program, {});
    await program.parseAsync(['na', 'na', 'ask', '-f', 'test.file']);
    expect(askQuestion).toHaveBeenCalledWith(
      'ASK',
      'INTERNAL PREAMBLE\nPROJECT GUIDELINES',
      'test.file:\n```\nFILE CONTENT\n```',
      mockConfig
    );
  });

  it('Should call askQuestion with stdin content only (no message)', async () => {
    const { getStringFromStdin } = await import('#src/utils/systemUtils.js');
    vi.mocked(getStringFromStdin).mockReturnValue('STDIN CONTENT');

    const { askCommand } = await import('#src/commands/askCommand.js');
    const program = new Command();
    askCommand(program, {});
    await program.parseAsync(['na', 'na', 'ask']);
    // With deterministic UUID, the block id will be stdin-content-1234567
    expect(askQuestion).toHaveBeenCalledWith(
      'ASK',
      'INTERNAL PREAMBLE\nPROJECT GUIDELINES',
      '\nProvided content follows within stdin-content-1234567 block\n<stdin-content-1234567>\nSTDIN CONTENT\n</stdin-content-1234567>\n',
      mockConfig
    );
  });

  it('Should throw error when no input source is provided', async () => {
    const { getStringFromStdin } = await import('#src/utils/systemUtils.js');
    vi.mocked(getStringFromStdin).mockReturnValue('');

    const { askCommand } = await import('#src/commands/askCommand.js');
    const program = new Command();
    askCommand(program, {});

    await expect(program.parseAsync(['na', 'na', 'ask'])).rejects.toThrow(
      'At least one of the following is required: file, stdin, or message'
    );
  });

  it('Should pass writeOutputToFile config parameter through to askQuestion module', async () => {
    // Create a config with writeOutputToFile set to false
    const configWithWriteOutputDisabled = {
      ...mockConfig,
      writeOutputToFile: false,
    };

    // Mock initConfig to return our test config
    configMock.initConfig.mockResolvedValue(configWithWriteOutputDisabled);

    const { askCommand } = await import('#src/commands/askCommand.js');
    const program = new Command();
    askCommand(program, {});
    await program.parseAsync(['na', 'na', 'ask', 'integration test message']);

    // Verify that askQuestion was called with the config containing writeOutputToFile: false
    expect(askQuestion).toHaveBeenCalledWith(
      'ASK',
      'INTERNAL PREAMBLE\nPROJECT GUIDELINES',
      '\nProvided user message follows within message-1234567 block\n<message-1234567>\nintegration test message\n</message-1234567>\n',
      configWithWriteOutputDisabled
    );

    // Specifically verify the writeOutputToFile parameter was passed through
    const calledConfig = askQuestion.mock.calls[0][3];
    expect(calledConfig.writeOutputToFile).toBe(false);
  });
});
