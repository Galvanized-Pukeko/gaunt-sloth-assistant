import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const promptMock = {
  readBackstory: vi.fn(),
  readGuidelines: vi.fn(),
  readSystemPrompt: vi.fn(),
  readChatPrompt: vi.fn(),
};
vi.mock('#src/prompt.js', () => promptMock);

const configMock = {
  initConfig: vi.fn(),
};
vi.mock('#src/config.js', () => configMock);

const consoleUtilsMock = {
  display: vi.fn(),
  displayError: vi.fn(),
  displaySuccess: vi.fn(),
  displayInfo: vi.fn(),
  displayWarning: vi.fn(),
  displayDebug: vi.fn(),
  defaultStatusCallbacks: vi.fn(),
  formatInputPrompt: vi.fn(),
};
vi.mock('#src/consoleUtils.js', () => consoleUtilsMock);

const filePathUtilsMock = {
  getGslothFilePath: vi.fn(),
};
vi.mock('#src/filePathUtils.js', () => filePathUtilsMock);

const utilsMock = {
  generateStandardFileName: vi.fn(),
  appendToFile: vi.fn(),
  ProgressIndicator: vi.fn(),
};
vi.mock('#src/utils.js', () => utilsMock);

const fsMock = {
  existsSync: vi.fn(),
};
vi.mock('node:fs', () => fsMock);

const llmUtilsMock = {
  invoke: vi.fn(),
  getNewRunnableConfig: vi.fn().mockReturnValue({
    recursionLimit: 250,
    configurable: { thread_id: 'test-thread-id' },
  }),
};
vi.mock('#src/llmUtils.js', () => llmUtilsMock);

const readlineMock = {
  createInterface: vi.fn(),
};
vi.mock('node:readline/promises', () => readlineMock);

const interactiveSessionModuleMock = {
  createInteractiveSession: vi.fn(),
};
vi.mock('#src/modules/interactiveSessionModule.js', () => interactiveSessionModuleMock);

describe('chatCommand', () => {
  let program: Command;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    program = new Command();

    // Set up default mock implementations
    promptMock.readBackstory.mockReturnValue('Mock backstory');
    promptMock.readGuidelines.mockReturnValue('Mock guidelines');
    promptMock.readSystemPrompt.mockReturnValue('Mock system prompt');
    promptMock.readChatPrompt.mockReturnValue('Mock chat prompt');

    configMock.initConfig.mockResolvedValue({
      projectGuidelines: 'Mock guidelines',
      llm: 'Mock LLM',
    });

    consoleUtilsMock.formatInputPrompt.mockImplementation((v) => v);

    filePathUtilsMock.getGslothFilePath.mockReturnValue('mock/chat/file.txt');

    utilsMock.generateStandardFileName.mockReturnValue('mock-chat-file.txt');
    utilsMock.ProgressIndicator.mockImplementation(() => ({
      stop: vi.fn(),
    }));

    fsMock.existsSync.mockReturnValue(true);

    llmUtilsMock.invoke.mockResolvedValue('Mock response');
  });

  it('Should display help correctly', async () => {
    const { chatCommand } = await import('#src/commands/chatCommand.js');
    chatCommand(program);
    expect(program.commands[0].description()).toBe(
      'Start an interactive chat session with Gaunt Sloth'
    );
  });

  it('Should process initial message if provided', async () => {
    const { chatCommand } = await import('#src/commands/chatCommand.js');
    chatCommand(program);
    await program.parseAsync(['na', 'na', 'chat', 'test message']);

    expect(interactiveSessionModuleMock.createInteractiveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'chat',
        description: 'Start an interactive chat session with Gaunt Sloth',
        readyMessage: '\nGaunt Sloth is ready to chat. Type your prompt.',
        exitMessage: "Type 'exit' or hit Ctrl+C to exit chat\n",
      }),
      'test message'
    );
  });

  it('Should handle empty message gracefully', async () => {
    const { chatCommand } = await import('#src/commands/chatCommand.js');
    chatCommand(program);
    await program.parseAsync(['na', 'na', 'chat']);

    expect(interactiveSessionModuleMock.createInteractiveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'chat',
        description: 'Start an interactive chat session with Gaunt Sloth',
        readyMessage: '\nGaunt Sloth is ready to chat. Type your prompt.',
        exitMessage: "Type 'exit' or hit Ctrl+C to exit chat\n",
      }),
      undefined
    );
  });

  it('Should call createInteractiveSession with correct config', async () => {
    const { chatCommand } = await import('#src/commands/chatCommand.js');
    chatCommand(program);
    await program.parseAsync(['na', 'na', 'chat']);

    expect(interactiveSessionModuleMock.createInteractiveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'chat',
        description: 'Start an interactive chat session with Gaunt Sloth',
        readyMessage: '\nGaunt Sloth is ready to chat. Type your prompt.',
        exitMessage: "Type 'exit' or hit Ctrl+C to exit chat\n",
      }),
      undefined
    );
  });

  it('Should pass readChatPrompt function to session config', async () => {
    const { chatCommand } = await import('#src/commands/chatCommand.js');
    chatCommand(program);
    await program.parseAsync(['na', 'na', 'chat']);

    expect(interactiveSessionModuleMock.createInteractiveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'chat',
        readModePrompt: promptMock.readChatPrompt,
      }),
      undefined
    );
  });

  it('Should handle program action for no arguments', async () => {
    const { chatCommand } = await import('#src/commands/chatCommand.js');
    chatCommand(program);
    await program.parseAsync(['na', 'na']);

    expect(interactiveSessionModuleMock.createInteractiveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'chat',
        description: 'Start an interactive chat session with Gaunt Sloth',
        readyMessage: '\nGaunt Sloth is ready to chat. Type your prompt.',
        exitMessage: "Type 'exit' or hit Ctrl+C to exit chat\n",
      })
    );
  });
});

describe('Default Chat Behavior (no arguments)', () => {
  let program: Command;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    program = new Command();

    // Set up default mock implementations
    promptMock.readBackstory.mockReturnValue('Mock backstory');
    promptMock.readGuidelines.mockReturnValue('Mock guidelines');
    promptMock.readSystemPrompt.mockReturnValue('Mock system prompt');
    promptMock.readChatPrompt.mockReturnValue('Mock chat prompt');

    configMock.initConfig.mockResolvedValue({
      projectGuidelines: 'Mock guidelines',
      llm: 'Mock LLM',
    });

    consoleUtilsMock.formatInputPrompt.mockImplementation((v) => v);

    filePathUtilsMock.getGslothFilePath.mockReturnValue('mock/chat/file.txt');

    utilsMock.generateStandardFileName.mockReturnValue('mock-chat-file.txt');
    utilsMock.ProgressIndicator.mockImplementation(() => ({
      stop: vi.fn(),
    }));

    fsMock.existsSync.mockReturnValue(true);

    llmUtilsMock.invoke.mockResolvedValue('Mock response');
  });

  it('Should start chat session when called directly via createInteractiveSession', async () => {
    const { chatCommand } = await import('#src/commands/chatCommand.js');
    chatCommand(program);
    await program.parseAsync(['na', 'na']);

    expect(interactiveSessionModuleMock.createInteractiveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'chat',
        description: 'Start an interactive chat session with Gaunt Sloth',
        readyMessage: '\nGaunt Sloth is ready to chat. Type your prompt.',
        exitMessage: "Type 'exit' or hit Ctrl+C to exit chat\n",
      })
    );
  });

  it('Should display welcome message when no initial message provided', async () => {
    const { chatCommand } = await import('#src/commands/chatCommand.js');
    chatCommand(program);
    await program.parseAsync(['na', 'na']);

    expect(interactiveSessionModuleMock.createInteractiveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'chat',
        readyMessage: '\nGaunt Sloth is ready to chat. Type your prompt.',
        exitMessage: "Type 'exit' or hit Ctrl+C to exit chat\n",
      })
    );
  });

  it('Should create session config with correct mode and prompts', async () => {
    const { readChatPrompt } = await import('#src/prompt.js');

    const sessionConfig = {
      mode: 'chat' as const,
      readModePrompt: readChatPrompt,
      description: 'Start an interactive chat session with Gaunt Sloth',
      readyMessage: '\nGaunt Sloth is ready to chat. Type your prompt.',
      exitMessage: "Type 'exit' or hit Ctrl+C to exit chat\n",
    };

    expect(sessionConfig.mode).toBe('chat');
    expect(sessionConfig.readModePrompt).toBe(readChatPrompt);
    expect(sessionConfig.description).toBe('Start an interactive chat session with Gaunt Sloth');
    expect(sessionConfig.readyMessage).toBe('\nGaunt Sloth is ready to chat. Type your prompt.');
    expect(sessionConfig.exitMessage).toBe("Type 'exit' or hit Ctrl+C to exit chat\n");
  });

  it('Should handle createInteractiveSession with initial message', async () => {
    const { chatCommand } = await import('#src/commands/chatCommand.js');
    chatCommand(program);
    await program.parseAsync(['na', 'na', 'chat', 'initial message']);

    expect(interactiveSessionModuleMock.createInteractiveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'chat',
        description: 'Start an interactive chat session with Gaunt Sloth',
        readyMessage: '\nGaunt Sloth is ready to chat. Type your prompt.',
        exitMessage: "Type 'exit' or hit Ctrl+C to exit chat\n",
      }),
      'initial message'
    );
  });
});
