import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeStreamingChatModel } from '@langchain/core/utils/testing';
import type { GthConfig } from '#src/config.js';
import { BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';

const gthAgentRunnerMock = vi.fn();
const gthAgentRunnerInstanceMock = {
  init: vi.fn(),
  processMessages: vi.fn(),
  cleanup: vi.fn(),
};
vi.mock('#src/core/GthAgentRunner.js', () => ({
  GthAgentRunner: gthAgentRunnerMock,
}));

// Mock fs module
const fsMock = {
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
};
vi.mock('node:fs', () => fsMock);

// Mock path module
const pathMock = {
  resolve: vi.fn(),
};
vi.mock('node:path', () => pathMock);

// Mock systemUtils module
const systemUtilsMock = {
  getProjectDir: vi.fn(),
};
vi.mock('#src/utils/systemUtils.js', () => systemUtilsMock);

// Mock consoleUtils module
const consoleUtilsMock = {
  display: vi.fn(),
  displaySuccess: vi.fn(),
  displayError: vi.fn(),
  defaultStatusCallback: vi.fn(),
  initSessionLogging: vi.fn(),
  flushSessionLog: vi.fn(),
  stopSessionLogging: vi.fn(),
};
vi.mock('#src/utils/consoleUtils.js', () => consoleUtilsMock);

// Mock pathUtils module
const pathUtilsMock = {
  getGslothFilePath: vi.fn(),
  gslothDirExists: vi.fn(),
  getCommandOutputFilePath: vi.fn(),
};
vi.mock('#src/utils/fileUtils.js', () => pathUtilsMock);
vi.mock('#src/utils/fileUtils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#src/utils/fileUtils.js')>();
  return {
    ...actual,
    getGslothFilePath: pathUtilsMock.getGslothFilePath,
    gslothDirExists: pathUtilsMock.gslothDirExists,
    resolveOutputPath: vi.fn((writeOutputToFile: boolean | string, defaultFileName: string) => {
      if (writeOutputToFile === false) return null;
      if (writeOutputToFile === true) return actual.getGslothFilePath(defaultFileName);
      return actual.getGslothFilePath(String(writeOutputToFile));
    }),
  };
});

// Mock utils module
const utilsMock = {
  ProgressIndicator: vi.fn(),
  toFileSafeString: vi.fn(),
  fileSafeLocalDate: vi.fn(),
  createSystemMessage: vi.fn(),
  createHumanMessage: vi.fn(),
  generateStandardFileName: vi.fn(),
  appendToFile: vi.fn(),
  executeHooks: vi.fn().mockResolvedValue(undefined),
};
utilsMock.ProgressIndicator.prototype.stop = vi.fn();
utilsMock.ProgressIndicator.prototype.indicate = vi.fn();

vi.mock('#src/utils/utils.js', () => utilsMock);

// Create a complete mock config for prop drilling
const mockConfig = {
  llm: new FakeStreamingChatModel({
    responses: ['LLM Response' as unknown as BaseMessage],
  }),
  contentProvider: 'file',
  requirementsProvider: 'file',
  projectGuidelines: '.gsloth.guidelines.md',
  projectReviewInstructions: '.gsloth.review.md',
  streamOutput: false,
  commands: {
    pr: {
      contentProvider: 'github',
      requirementsProvider: 'github',
    },
  },
  filesystem: 'none',
  useColour: false,
  writeOutputToFile: true,
} as Partial<GthConfig> as GthConfig;

// Mock config module
vi.mock('#src/config.js', () => ({
  GthConfig: {},
}));

// Mock llmUtils module
const llmUtilsMock = {
  invoke: vi.fn().mockResolvedValue('LLM Response'),
  getNewRunnableConfig: vi.fn().mockReturnValue({
    recursionLimit: 250,
    configurable: { thread_id: 'test-thread-id' },
  }),
};
vi.mock('#src/utils/llmUtils.js', () => llmUtilsMock);

describe('questionAnsweringModule', () => {
  beforeEach(async () => {
    vi.resetAllMocks();

    // Setup mock for our new generateStandardFileName function
    utilsMock.generateStandardFileName.mockReturnValue('gth_2025-05-17_21-00-00_ASK.md');
    pathMock.resolve.mockImplementation((path: string, name: string) => {
      if (name && name.includes('gth_')) return 'test-file-path.md';
      return '';
    });

    // Setup pathUtils mocks
    pathUtilsMock.getGslothFilePath.mockReturnValue('test-file-path.md');
    pathUtilsMock.gslothDirExists.mockReturnValue(false);
  });

  it('should invoke LLM with prop drilling', async () => {
    // Reset the mock LLM for this test
    const testConfig = { ...mockConfig };
    testConfig.llm = new FakeStreamingChatModel({
      responses: ['LLM Response' as unknown as BaseMessage],
    });
    testConfig.llm.bindTools = vi.fn();

    // Prepare runner mocks
    gthAgentRunnerMock.mockImplementation(() => gthAgentRunnerInstanceMock);
    gthAgentRunnerInstanceMock.init.mockResolvedValue(undefined);
    gthAgentRunnerInstanceMock.processMessages.mockResolvedValue('LLM Response');
    gthAgentRunnerInstanceMock.cleanup.mockResolvedValue(undefined);

    // Import the module after setting up mocks
    const { askQuestion } = await import('#src/modules/questionAnsweringModule.js');

    // Call askQuestion with config (prop drilling)
    await askQuestion('test-source', 'test-preamble', 'test-content', testConfig);

    // Verify that runner was called with correct parameters
    expect(gthAgentRunnerInstanceMock.processMessages).toHaveBeenCalledWith([
      new SystemMessage('test-preamble'),
      new HumanMessage('test-content'),
    ]);

    // Verify that content was appended to the session log file
    expect(utilsMock.appendToFile).toHaveBeenCalled();

    // Verify that display was called
    expect(consoleUtilsMock.display).toHaveBeenCalled();

    // Verify that displaySuccess was called
    expect(consoleUtilsMock.displaySuccess).toHaveBeenCalled();

    // Verify that ProgressIndicator.stop() was called
    expect(utilsMock.ProgressIndicator.prototype.stop).toHaveBeenCalled();
  });

  it('Should handle file write errors with prop drilling', async () => {
    const testConfig = { ...mockConfig };
    testConfig.llm = new FakeStreamingChatModel({
      responses: ['LLM Response' as unknown as BaseMessage],
    });

    // Mock file write to throw an error
    const error = new Error('File write error');
    utilsMock.appendToFile.mockImplementation(() => {
      throw error;
    });

    // Prepare runner mocks
    gthAgentRunnerMock.mockImplementation(() => gthAgentRunnerInstanceMock);
    gthAgentRunnerInstanceMock.init.mockResolvedValue(undefined);
    gthAgentRunnerInstanceMock.processMessages.mockResolvedValue('LLM Response');
    gthAgentRunnerInstanceMock.cleanup.mockResolvedValue(undefined);

    // Import the module after setting up mocks
    const { askQuestion } = await import('#src/modules/questionAnsweringModule.js');

    // Call the function with config (prop drilling) and wait for it to complete
    await askQuestion('gth-ASK', 'Test Preamble', 'Test Content', testConfig);

    // Verify error message was displayed
    expect(consoleUtilsMock.displayError).toHaveBeenCalledWith(
      expect.stringContaining('test-file-path.md')
    );
    expect(consoleUtilsMock.displayError).toHaveBeenCalledWith('File write error');

    // Verify that ProgressIndicator.stop() was called even with error
    expect(utilsMock.ProgressIndicator.prototype.stop).toHaveBeenCalled();
  });

  // Specific test to verify that prop drilling works with different config objects
  it('should work with different config objects via prop drilling', async () => {
    // Create a different config object to prove prop drilling works
    const differentConfig = {
      ...mockConfig,
      streamOutput: true, // Different from default mockConfig
      llm: new FakeStreamingChatModel({
        responses: ['Different LLM Response' as unknown as BaseMessage],
      }),
      writeOutputToFile: true,
    } as GthConfig;

    // Set a different response for this specific test
    llmUtilsMock.invoke.mockResolvedValue('Different LLM Response');

    // Prepare runner mocks
    gthAgentRunnerMock.mockImplementation(() => gthAgentRunnerInstanceMock);
    gthAgentRunnerInstanceMock.init.mockResolvedValue(undefined);
    gthAgentRunnerInstanceMock.processMessages.mockResolvedValue('Different LLM Response');
    gthAgentRunnerInstanceMock.cleanup.mockResolvedValue(undefined);

    // Import the module after setting up mocks
    const { askQuestion } = await import('#src/modules/questionAnsweringModule.js');

    // Call askQuestion with the different config to prove prop drilling works
    await askQuestion('test-source', 'test-preamble', 'test-content', differentConfig);

    // Verify the different config was used
    expect(gthAgentRunnerInstanceMock.processMessages).toHaveBeenCalledWith([
      new SystemMessage('test-preamble'),
      new HumanMessage('test-content'),
    ]);

    // Verify the output matches what we expect
    expect(utilsMock.appendToFile).toHaveBeenCalledWith(
      'test-file-path.md',
      'Different LLM Response'
    );

    // Since streamOutput is true, display should not be called
    expect(consoleUtilsMock.display).not.toHaveBeenCalled();
  });

  it('should not write to file when writeOutputToFile is false', async () => {
    const testConfig = {
      ...mockConfig,
      writeOutputToFile: false,
      streamOutput: false,
      llm: new FakeStreamingChatModel({
        responses: ['LLM Response No File' as unknown as BaseMessage],
      }),
    } as GthConfig;

    llmUtilsMock.invoke.mockResolvedValue('LLM Response No File');

    // Prepare runner mocks
    gthAgentRunnerMock.mockImplementation(() => gthAgentRunnerInstanceMock);
    gthAgentRunnerInstanceMock.init.mockResolvedValue(undefined);
    gthAgentRunnerInstanceMock.processMessages.mockResolvedValue('LLM Response No File');
    gthAgentRunnerInstanceMock.cleanup.mockResolvedValue(undefined);

    // Import the module after setting up mocks
    const { askQuestion } = await import('#src/modules/questionAnsweringModule.js');

    // Call askQuestion with writeOutputToFile disabled
    await askQuestion('test-source', 'test-preamble', 'test-content', testConfig);

    // Verify that writeFileSync was NOT called
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();

    // Verify that displaySuccess was NOT called (no file written message)
    expect(consoleUtilsMock.displaySuccess).not.toHaveBeenCalled();

    // Verify that regular display was called with content
    expect(consoleUtilsMock.display).toHaveBeenCalledWith('\nLLM Response No File');

    // Verify that an extra newline was displayed for terminal compatibility
    expect(consoleUtilsMock.display).toHaveBeenCalledWith('\n');

    // Verify that ProgressIndicator.stop() was still called
    expect(utilsMock.ProgressIndicator.prototype.stop).toHaveBeenCalled();
  });
});
