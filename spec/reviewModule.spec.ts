import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import type { GthConfig } from '#src/config.js';
import { AIMessageChunk, HumanMessage, SystemMessage } from '@langchain/core/messages';
import {
  BaseChatModel,
  BaseChatModelCallOptions,
} from '@langchain/core/language_models/chat_models';

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
  default: {
    resolve: vi.fn(),
  },
};
vi.mock('node:path', () => pathMock);

// Mock systemUtils module
const systemUtilsMock = {
  getProjectDir: vi.fn(),
  stdout: {
    write: vi.fn(),
  },
};
vi.mock('#src/utils/systemUtils.js', () => systemUtilsMock);

// Mock consoleUtils module
const consoleUtilsMock = {
  display: vi.fn(),
  displaySuccess: vi.fn(),
  displayError: vi.fn(),
  displayDebug: vi.fn(),
  defaultStatusCallback: vi.fn(),
  initSessionLogging: vi.fn(),
  flushSessionLog: vi.fn(),
  stopSessionLogging: vi.fn(),
};
vi.mock('#src/utils/consoleUtils.js', () => consoleUtilsMock);

// Mock pathUtils module
const fileUtilsMock = {
  getGslothFilePath: vi.fn(),
  gslothDirExists: vi.fn(),
  getCommandOutputFilePath: vi.fn(),
  toFileSafeString: vi.fn(),
  fileSafeLocalDate: vi.fn(),
  generateStandardFileName: vi.fn(),
  appendToFile: vi.fn(),
};
vi.mock('#src/utils/fileUtils.js', () => fileUtilsMock);

const ProgressIndicatorMock = vi.fn();
const ProgressIndicatorInstanceMock = {
  stop: vi.fn(),
  indicate: vi.fn(),
};
vi.mock('#src/utils/ProgressIndicator.js', () => ({
  ProgressIndicator: ProgressIndicatorMock,
}));

// Mock llmUtils module
const llmUtilsMock = {
  invoke: vi.fn(),
  getNewRunnableConfig: vi.fn().mockReturnValue({
    recursionLimit: 250,
    configurable: { thread_id: 'test-thread-id' },
  }),
};
vi.mock('#src/utils/llmUtils.js', () => llmUtilsMock);

// Create a complete mock config for prop drilling
const BASE_GTH_CONFIG: Pick<
  GthConfig,
  | 'contentProvider'
  | 'requirementsProvider'
  | 'projectGuidelines'
  | 'projectReviewInstructions'
  | 'streamOutput'
  | 'commands'
  | 'filesystem'
  | 'useColour'
  | 'writeOutputToFile'
  | 'streamSessionInferenceLog'
  | 'canInterruptInferenceWithEsc'
  | 'includeCurrentDateAfterGuidelines'
> = {
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
  streamSessionInferenceLog: true,
  canInterruptInferenceWithEsc: true,
  includeCurrentDateAfterGuidelines: false,
};

const mockConfig: GthConfig = {
  ...BASE_GTH_CONFIG,
  llm: new FakeListChatModel({
    responses: ['LLM Review Response'],
  }) as BaseChatModel<BaseChatModelCallOptions, AIMessageChunk>,
} as GthConfig;

// Mock config module
vi.mock('#src/config.js', () => ({
  GthConfig: {},
}));

describe('reviewModule', () => {
  beforeEach(async () => {
    vi.resetAllMocks();

    // Setup mock for our new generateStandardFileName function
    fileUtilsMock.generateStandardFileName.mockReturnValue('gth_2025-05-17_21-00-00_REVIEW.md');
    // Setup both the top-level resolve and the default.resolve functions
    const resolveMock = (path: string, name: string) => {
      if (name && name.includes('gth_')) return 'test-review-file-path.md';
      return '';
    };
    pathMock.resolve.mockImplementation(resolveMock);
    pathMock.default.resolve.mockImplementation(resolveMock);

    // Setup pathUtils mocks
    fileUtilsMock.getGslothFilePath.mockReturnValue('test-review-file-path.md');
    fileUtilsMock.gslothDirExists.mockReturnValue(false);
    fileUtilsMock.getCommandOutputFilePath.mockImplementation((config: any, _source: string) => {
      if (config.writeOutputToFile === false) return null;
      if (config.writeOutputToFile === true) return 'test-review-file-path.md';
      return String(config.writeOutputToFile);
    });

    ProgressIndicatorMock.mockImplementation(() => ProgressIndicatorInstanceMock);

    gthAgentRunnerMock.mockImplementation(() => gthAgentRunnerInstanceMock);
    gthAgentRunnerInstanceMock.init.mockResolvedValue(undefined);
    gthAgentRunnerInstanceMock.processMessages.mockResolvedValue('LLM Review Response');
    gthAgentRunnerInstanceMock.cleanup.mockResolvedValue(undefined);
  });

  it('should invoke LLM and write review to file using prop drilling', async () => {
    // Import the module after setting up mocks
    const { review } = await import('#src/modules/reviewModule.js');

    // Call review function with config (prop drilling)
    await review('test-source', 'test-preamble', 'test-diff', mockConfig);

    // Verify that runner was called with correct parameters
    expect(gthAgentRunnerInstanceMock.processMessages).toHaveBeenCalledWith([
      new SystemMessage('test-preamble'),
      new HumanMessage('test-diff'),
    ]);

    // Verify that content was appended to the session log file
    expect(fileUtilsMock.appendToFile).toHaveBeenCalledWith(
      'test-review-file-path.md',
      'LLM Review Response'
    );
    expect(fileUtilsMock.getCommandOutputFilePath).toHaveBeenCalledWith(
      expect.objectContaining({ writeOutputToFile: true }),
      'test-source'
    );

    // Verify that display was called
    expect(consoleUtilsMock.display).toHaveBeenCalledWith('\nLLM Review Response');

    // Verify that displaySuccess was called
    expect(consoleUtilsMock.displaySuccess).toHaveBeenCalledWith(
      expect.stringContaining('test-review-file-path.md')
    );

    // Verify that ProgressIndicator.stop() was called
    expect(ProgressIndicatorInstanceMock.stop).toHaveBeenCalled();
  });

  it('should write review to a specified string path when writeOutputToFile is a string', async () => {
    // Arrange: configure to use a specific filename via string path
    const configWithStringPath = {
      ...mockConfig,
      writeOutputToFile: 'custom/review.md',
    } as unknown as GthConfig;

    // Mock resolver to respect provided path as-is
    fileUtilsMock.getGslothFilePath.mockReturnValue('custom/review.md');
    fileUtilsMock.getCommandOutputFilePath.mockImplementation((config: any, _source: string) => {
      if (config.writeOutputToFile === false) return null;
      if (config.writeOutputToFile === true) return 'test-review-file-path.md';
      return String(config.writeOutputToFile);
    });

    // Act
    const { review } = await import('#src/modules/reviewModule.js');
    await review('test-source', 'test-preamble', 'test-diff', configWithStringPath);

    // Assert
    expect(gthAgentRunnerInstanceMock.processMessages).toHaveBeenCalledWith([
      new SystemMessage('test-preamble'),
      new HumanMessage('test-diff'),
    ]);
    expect(fileUtilsMock.getCommandOutputFilePath).toHaveBeenCalledWith(
      expect.objectContaining({ writeOutputToFile: 'custom/review.md' }),
      'test-source'
    );
    expect(fileUtilsMock.appendToFile).toHaveBeenCalledWith(
      'custom/review.md',
      'LLM Review Response'
    );
    expect(consoleUtilsMock.displaySuccess).toHaveBeenCalledWith(
      expect.stringContaining('custom/review.md')
    );
  });

  it('should handle file write errors with prop drilling', async () => {
    // Mock file append to throw an error (session logging flow)
    const error = new Error('File write error');
    fileUtilsMock.appendToFile.mockImplementation(() => {
      throw error;
    });

    // Import the module after setting up mocks
    const { review } = await import('#src/modules/reviewModule.js');

    // Call the function with config (prop drilling) and wait for it to complete
    await review('test-source', 'test-preamble', 'test-diff', mockConfig);

    // Verify error message was displayed
    expect(consoleUtilsMock.displayDebug).toHaveBeenCalled();
    expect(consoleUtilsMock.displayError).toHaveBeenCalledWith(
      expect.stringContaining('Failed to write review to file')
    );

    // Verify that ProgressIndicator.stop() was called even with error
    expect(ProgressIndicatorInstanceMock.stop).toHaveBeenCalled();
  });

  // Specific test to verify that prop drilling works with different config objects
  it('should work with different config objects via prop drilling', async () => {
    // Create a different config object to prove prop drilling works
    const differentConfig: GthConfig = {
      ...BASE_GTH_CONFIG,
      streamOutput: true, // Different from default mockConfig
      llm: {} as BaseChatModel, // Model shoudn't matter here, because agent runner is mocked
    };

    // Set a different response for this specific test
    gthAgentRunnerInstanceMock.processMessages.mockResolvedValue('Different LLM Response');

    // Import the module after setting up mocks
    const { review } = await import('#src/modules/reviewModule.js');

    // Call review with the different config to prove prop drilling works
    await review('test-source', 'test-preamble', 'test-diff', differentConfig);

    // Verify the different config was used
    expect(gthAgentRunnerInstanceMock.processMessages).toHaveBeenCalledWith([
      new SystemMessage('test-preamble'),
      new HumanMessage('test-diff'),
    ]);

    // Verify the output matches what we expect
    expect(fileUtilsMock.appendToFile).toHaveBeenCalledWith(
      'test-review-file-path.md',
      'Different LLM Response'
    );

    // Since streamOutput is true, display should not be called
    expect(consoleUtilsMock.display).not.toHaveBeenCalled();
  });
});
