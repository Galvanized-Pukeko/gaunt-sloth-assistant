import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Define mock at top level
const createProjectConfig = vi.fn();

// Mock the configSetup module (createProjectConfig lives here now)
vi.mock('#src/commands/configSetup.js', () => ({
  createProjectConfig,
}));

// Mock the config module
vi.mock('#src/config.js', () => ({
  availableDefaultConfigs: ['vertexai', 'anthropic', 'groq', 'openrouter'],
  GSLOTH_BACKSTORY: '.gsloth.backstory.md',
  USER_PROJECT_REVIEW_PREAMBLE: '.gsloth.guidelines.md',
}));

const consoleUtilsMock = {
  display: vi.fn(),
  displayError: vi.fn(),
  displayInfo: vi.fn(),
  displayWarning: vi.fn(),
  displaySuccess: vi.fn(),
  displayDebug: vi.fn(),
};
vi.mock('#src/utils/consoleUtils.js', () => consoleUtilsMock);

const systemUtilsMock = {
  env: {} as Record<string, string | undefined>,
  stdin: {},
  stdout: {},
  createInterface: vi.fn(),
};
vi.mock('#src/utils/systemUtils.js', () => systemUtilsMock);

describe('initCommand', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    systemUtilsMock.env = {};
  });

  it('Should call createProjectConfig with the provided config type', async () => {
    const { initCommand } = await import('#src/commands/initCommand.js');
    const program = new Command();
    await initCommand(program);
    await program.parseAsync(['na', 'na', 'init', 'vertexai']);
    expect(createProjectConfig).toHaveBeenCalledWith('vertexai');
  });

  it('Should display available config types in help', async () => {
    const { initCommand } = await import('#src/commands/initCommand.js');
    const program = new Command();
    const testOutput = { text: '' };

    program.configureOutput({
      writeOut: (str: string) => (testOutput.text += str),
      writeErr: (str: string) => (testOutput.text += str),
    });

    await initCommand(program);

    const commandUnderTest = program.commands.find((c) => c.name() === 'init');
    expect(commandUnderTest).toBeDefined();
    commandUnderTest?.outputHelp();

    // Verify available config types are displayed (argument is now optional [type])
    expect(testOutput.text).toContain('[type]');
    expect(testOutput.text).toContain('vertexai');
    expect(testOutput.text).toContain('anthropic');
    expect(testOutput.text).toContain('groq');
    expect(testOutput.text).toContain('openrouter');
  });

  it('Should detect available providers based on env vars', async () => {
    systemUtilsMock.env = {
      ANTHROPIC_API_KEY: 'test-key',
      GROQ_API_KEY: 'test-key',
    };

    const { detectAvailableProviders } = await import('#src/commands/initCommand.js');

    const available = detectAvailableProviders();

    // vertexai is always available (no API key needed)
    expect(available).toContain('vertexai');
    expect(available).toContain('anthropic');
    expect(available).toContain('groq');
    expect(available).not.toContain('openai');
    expect(available).not.toContain('deepseek');
  });

  it('Should return all providers with keys when all env vars are set', async () => {
    systemUtilsMock.env = {
      ANTHROPIC_API_KEY: 'key1',
      OPENAI_API_KEY: 'key2',
      GOOGLE_API_KEY: 'key3',
      GROQ_API_KEY: 'key4',
      DEEPSEEK_API_KEY: 'key5',
      XAI_API_KEY: 'key6',
      OPEN_ROUTER_API_KEY: 'key7',
    };

    const { detectAvailableProviders } = await import('#src/commands/initCommand.js');

    const available = detectAvailableProviders();

    // Only 4 providers are in the mocked availableDefaultConfigs: vertexai, anthropic, groq, openrouter
    // vertexai needs no key; anthropic, groq, openrouter have matching keys set
    expect(available).toContain('vertexai');
    expect(available).toContain('anthropic');
    expect(available).toContain('groq');
    expect(available).toContain('openrouter');
    expect(available).toHaveLength(4);
  });

  it('Should prompt user when called without arguments and keys are detected', async () => {
    systemUtilsMock.env = {
      ANTHROPIC_API_KEY: 'test-key',
    };

    const mockRl = {
      question: vi.fn().mockResolvedValue('1'),
      close: vi.fn(),
    };
    systemUtilsMock.createInterface.mockReturnValue(mockRl);

    const { initCommand } = await import('#src/commands/initCommand.js');
    const program = new Command();
    await initCommand(program);
    await program.parseAsync(['na', 'na', 'init']);

    // Should have prompted and called createProjectConfig
    expect(mockRl.question).toHaveBeenCalled();
    expect(createProjectConfig).toHaveBeenCalled();
  });

  it('Should select vertexai when no API keys are set (vertexai needs no key)', async () => {
    systemUtilsMock.env = {};

    const mockRl = {
      question: vi.fn().mockResolvedValue('1'),
      close: vi.fn(),
    };
    systemUtilsMock.createInterface.mockReturnValue(mockRl);

    const { initCommand } = await import('#src/commands/initCommand.js');
    const program = new Command();
    await initCommand(program);
    await program.parseAsync(['na', 'na', 'init']);

    // vertexai is always available since it doesn't need an API key
    expect(createProjectConfig).toHaveBeenCalledWith('vertexai');
  });
});
