import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GthConfig } from '#src/config.js';

const agentRunnerMock = {
  init: vi.fn(),
  processMessages: vi.fn(),
  cleanup: vi.fn(),
};

const AgentRunnerConstructor = vi.fn();

vi.mock('#src/core/GthAgentRunner.js', () => ({
  GthAgentRunner: AgentRunnerConstructor,
}));

const consoleUtilsMock = {
  display: vi.fn(),
  displayError: vi.fn(),
  displayInfo: vi.fn(),
  displayWarning: vi.fn(),
};
vi.mock('#src/consoleUtils.js', () => consoleUtilsMock);

const systemUtilsMock = {
  stdout: {
    write: vi.fn(),
  },
};
vi.mock('#src/systemUtils.js', () => systemUtilsMock);

describe('llmUtils', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    AgentRunnerConstructor.mockImplementation(() => agentRunnerMock);
  });

  it('should create Agent Runner and call its methods correctly', async () => {
    agentRunnerMock.processMessages.mockResolvedValue('Test response');

    const { invoke } = await import('#src/llmUtils.js');

    const mockConfig: GthConfig = {
      streamOutput: false,
      llm: {} as any,
      filesystem: 'none',
    } as GthConfig;
    const messages = [{ role: 'user', content: 'test message' }] as any;

    const result = await invoke('review', messages, mockConfig);

    expect(AgentRunnerConstructor).toHaveBeenCalledWith(expect.any(Function));
    expect(agentRunnerMock.init).toHaveBeenCalledWith('review', mockConfig);
    expect(agentRunnerMock.processMessages).toHaveBeenCalledWith(messages);
    expect(agentRunnerMock.cleanup).toHaveBeenCalled();
    expect(result).toBe('Test response');
  });

  it('should pass runConfig and checkpointSaver when provided', async () => {
    agentRunnerMock.processMessages.mockResolvedValue('Another response');

    const { invoke } = await import('#src/llmUtils.js');

    const mockConfig: GthConfig = {
      streamOutput: true,
      llm: {} as any,
      filesystem: 'all',
    } as GthConfig;
    const messages = [{ role: 'system', content: 'system message' }] as any;
    const result = await invoke('chat', messages, mockConfig);

    expect(agentRunnerMock.init).toHaveBeenCalledWith('chat', mockConfig);
    expect(agentRunnerMock.processMessages).toHaveBeenCalledWith(messages);
    expect(result).toBe('Another response');
  });

  it('should call cleanup even when invoke throws an error', async () => {
    const error = new Error('Test error');
    agentRunnerMock.processMessages.mockRejectedValue(error);

    const { invoke } = await import('#src/llmUtils.js');

    const mockConfig: GthConfig = {
      streamOutput: false,
      llm: {} as any,
      filesystem: 'none',
    } as GthConfig;
    const messages = [] as any;

    await expect(invoke('ask', messages, mockConfig)).rejects.toThrow('Test error');
    expect(agentRunnerMock.cleanup).toHaveBeenCalled();
  });
});
