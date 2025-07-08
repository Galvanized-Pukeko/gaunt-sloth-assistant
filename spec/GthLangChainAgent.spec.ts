import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { AIMessage, AIMessageChunk, HumanMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';
import type { SlothConfig } from '#src/config.js';
import type { BaseToolkit, StructuredToolInterface } from '@langchain/core/tools';
import {
  FakeChatInput,
  FakeListChatModel,
  FakeStreamingChatModel,
} from '@langchain/core/utils/testing';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { StatusUpdateCallback } from '#src/core/GthLangChainAgent.js';

const systemUtilsMock = {
  getCurrentDir: vi.fn(),
};
vi.mock('#src/systemUtils.js', () => systemUtilsMock);

const configMock = {
  getDefaultTools: vi.fn(),
};
vi.mock('#src/builtInToolsConfig.js', () => ({
  getDefaultTools: configMock.getDefaultTools,
}));

const progressIndicatorInstanceMock = {
  stop: vi.fn(),
};
const progressIndicatorMock = vi.fn().mockImplementation(() => progressIndicatorInstanceMock);
vi.mock('#src/utils.js', () => ({
  ProgressIndicator: progressIndicatorMock,
  formatToolCalls: vi.fn((toolCalls) => toolCalls.map((tc: any) => `${tc.name}()`).join(', ')),
}));

const multiServerMCPClientMock = vi.fn();
const mcpClientInstanceMock = {
  getTools: vi.fn(),
  close: vi.fn(),
};
vi.mock('@langchain/mcp-adapters', () => ({
  MultiServerMCPClient: multiServerMCPClientMock,
}));

const createAuthProviderAndAuthenticateMock = vi.fn();
vi.mock('#src/mcp/OAuthClientProviderImpl.js', () => ({
  createAuthProviderAndAuthenticate: createAuthProviderAndAuthenticateMock,
}));

const consoleUtilsMock = {
  displayInfo: vi.fn(),
};
vi.mock('#src/consoleUtils.js', () => consoleUtilsMock);

describe('GthLangChainAgent', () => {
  let GthLangChainAgent: typeof import('#src/core/GthLangChainAgent.ts').GthLangChainAgent;
  let statusUpdateCallback: Mock<StatusUpdateCallback>;
  let mockConfig: SlothConfig;

  beforeEach(async () => {
    vi.resetAllMocks();

    systemUtilsMock.getCurrentDir.mockReturnValue('/test/dir');
    multiServerMCPClientMock.mockImplementation(() => mcpClientInstanceMock);
    progressIndicatorMock.mockImplementation(() => progressIndicatorInstanceMock);

    // Setup config mocks
    configMock.getDefaultTools.mockResolvedValue([]);

    statusUpdateCallback = vi.fn();

    mockConfig = {
      projectGuidelines: 'test guidelines',
      llm: {
        _llmType: vi.fn().mockReturnValue('test'),
        verbose: false,
        bindTools: vi.fn(),
      } as any,
      streamOutput: false,
      contentProvider: 'file',
      requirementsProvider: 'file',
      projectReviewInstructions: '.gsloth.review.md',
      filesystem: 'none',
      useColour: false,
    };

    ({ GthLangChainAgent } = await import('#src/core/GthLangChainAgent.js'));
  });

  describe('constructor', () => {
    it('should initialize with status update callback', () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      expect(agent).toBeDefined();
    });
  });

  describe('setVerbose', () => {
    it('should set verbose mode', () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      agent.setVerbose(true);
      expect(agent['verbose']).toBe(true);
    });

    it('should unset verbose mode', () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      agent.setVerbose(true);
      agent.setVerbose(false);
      expect(agent['verbose']).toBe(false);
    });
  });

  describe('init', () => {
    it('should initialize with basic configuration', async () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      mcpClientInstanceMock.getTools.mockResolvedValue([]);

      await agent.init(undefined, mockConfig);
    });

    it('should set verbose on LLM when verbose mode is enabled', async () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      agent.setVerbose(true);
      mcpClientInstanceMock.getTools.mockResolvedValue([]);

      await agent.init(undefined, mockConfig);

      expect(mockConfig.llm.verbose).toBe(true);
    });

    it('should keep verbose=false on LLM when verbose mode is disabled', async () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      agent.setVerbose(false);
      mcpClientInstanceMock.getTools.mockResolvedValue([]);

      await agent.init(undefined, mockConfig);

      expect(mockConfig.llm.verbose).toBe(false);
    });

    it('should use command-specific filesystem config', async () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      const configWithCommands = {
        ...mockConfig,
        commands: {
          code: {
            filesystem: ['read_file', 'write_file'],
          },
        },
      };

      await agent.init('code', configWithCommands);

      expect(agent['config']?.filesystem).toEqual(['read_file', 'write_file']);
    });

    it('should display loaded tools as comma-separated list', async () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      const mockTools = [
        { name: 'custom_tool_1', invoke: vi.fn(), description: 'Test tool 1' },
        { name: 'custom_tool_2', invoke: vi.fn(), description: 'Test tool 2' },
        { name: 'custom_tool_3', invoke: vi.fn(), description: 'Test tool 3' },
      ] as Partial<StructuredToolInterface>[];

      const configWithTools = {
        ...mockConfig,
        tools: mockTools,
        filesystem: 'none',
      } as SlothConfig;

      mcpClientInstanceMock.getTools.mockResolvedValue([]);

      await agent.init(undefined, configWithTools);

      expect(statusUpdateCallback).toHaveBeenCalledWith(
        'info',
        'Loaded tools: custom_tool_1, custom_tool_2, custom_tool_3'
      );
    });

    it('should initialize with checkpoint saver', async () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      const checkpointSaver = new MemorySaver();
      mcpClientInstanceMock.getTools.mockResolvedValue([]);

      await agent.init(undefined, mockConfig, checkpointSaver);
    });

    it('should flatten toolkits into individual tools', async () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      // Toolkit has one single method - getTools
      const mockToolkit = {
        getTools: () => [
          { name: 'custom_tool_1' } as StructuredToolInterface,
          { name: 'custom_tool_2' } as StructuredToolInterface,
        ],
      } as BaseToolkit;
      const mockTool = { name: 'gth_status_update' } as StructuredToolInterface;

      const configWithTools = {
        ...mockConfig,
        tools: [mockToolkit, mockTool],
      } as SlothConfig;

      mcpClientInstanceMock.getTools.mockResolvedValue([]);

      await agent.init(undefined, configWithTools);
    });

    it('should combine toolkit tools with MCP tools', async () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      const mockToolkit = {
        getTools: () => [{ name: 'custom_tool' } as StructuredToolInterface],
      };

      const configWithTools = {
        ...mockConfig,
        tools: [mockToolkit],
      } as SlothConfig;

      const mcpTools = [{ name: 'mcp__filesystem__list_directory' } as StructuredToolInterface];
      mcpClientInstanceMock.getTools.mockResolvedValue(mcpTools);

      await agent.init(undefined, configWithTools);
    });
  });

  describe('invoke', () => {
    it('should throw error if not initialized', async () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      const runConfig: RunnableConfig = {
        recursionLimit: 250,
        configurable: { thread_id: 'test-thread-id' },
      };

      await expect(agent.invoke([new HumanMessage('test')], runConfig)).rejects.toThrow(
        'Agent not initialized. Call init() first.'
      );
    });

    it('should invoke agent in non-streaming mode', async () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      const fakeListChatModel = new FakeListChatModel({
        responses: ['test response'],
      });
      fakeListChatModel.bindTools = vi.fn().mockReturnValue(fakeListChatModel);

      const config = {
        ...mockConfig,
        llm: fakeListChatModel,
      };
      await agent.init(undefined, config);

      const runConfig: RunnableConfig = {
        recursionLimit: 250,
        configurable: { thread_id: 'test-thread-id' },
      };
      const result = await agent.invoke([new HumanMessage('test message')], runConfig);

      expect(statusUpdateCallback).toHaveBeenCalledWith('display', 'test response');
      expect(result).toBe('test response');
    });

    it('should display tool usage in non-streaming mode', async () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      const fakeListChatModel = new FakeListChatModel({
        responses: [
          new AIMessage({
            content: 'test response',
            tool_calls: [
              { name: 'read_file', args: {}, id: '1' },
              { name: 'write_file', args: {}, id: '2' },
            ],
          }) as any as string,
        ],
      });
      fakeListChatModel.bindTools = vi.fn().mockReturnValue(fakeListChatModel);

      const config = {
        ...mockConfig,
        llm: fakeListChatModel,
      };
      await agent.init(undefined, config);

      const runConfig: RunnableConfig = {
        recursionLimit: 250,
        configurable: { thread_id: 'test-thread-id' },
      };
      await agent.invoke([new HumanMessage('test message')], runConfig);

      expect(statusUpdateCallback).toHaveBeenCalledWith(
        'info',
        '\nUsed tools: read_file(), write_file()'
      );
    });

    it('should handle errors in non-streaming mode', async () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      const fakeListChatModel = new FakeListChatModel({
        responses: [],
        simulateError: true,
      } as FakeChatInput);
      fakeListChatModel.bindTools = vi.fn().mockReturnValue(fakeListChatModel);

      const config = {
        ...mockConfig,
        llm: fakeListChatModel,
      };
      await agent.init(undefined, config);

      const runConfig: RunnableConfig = {
        recursionLimit: 250,
        configurable: { thread_id: 'test-thread-id' },
      };
      const result = await agent.invoke([new HumanMessage('test message')], runConfig);

      expect(statusUpdateCallback).toHaveBeenCalledWith(
        'warning',
        expect.stringContaining('Something went wrong')
      );
      expect(progressIndicatorMock).toHaveBeenCalled();
      expect(progressIndicatorInstanceMock.stop).toHaveBeenCalled();
      expect(result).toBe('');
    });

    it('should invoke agent in non-streaming mode only', async () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      const fakeListChatModel = new FakeListChatModel({
        responses: ['test response'],
      });
      fakeListChatModel.bindTools = vi.fn().mockReturnValue(fakeListChatModel);

      const config = {
        ...mockConfig,
        llm: fakeListChatModel,
        streamOutput: true, // This should be ignored by invoke method
      };
      await agent.init(undefined, config);

      const runConfig: RunnableConfig = {
        recursionLimit: 250,
        configurable: { thread_id: 'test-thread-id' },
      };
      const result = await agent.invoke([new HumanMessage('test message')], runConfig);

      expect(statusUpdateCallback).toHaveBeenCalledWith('display', 'test response');
      expect(result).toBe('test response');
    });

    it('should display tool usage in non-streaming mode', async () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      // Use FakeListChatModel to simulate a response with tool calls
      const fakeListChatModel = new FakeListChatModel({
        responses: [
          new AIMessage({
            content: 'response done',
            tool_calls: [{ name: 'read_file', args: {}, id: '1' }],
          }) as any as string,
        ],
      });
      fakeListChatModel.bindTools = vi.fn().mockReturnValue(fakeListChatModel);

      const config = {
        ...mockConfig,
        llm: fakeListChatModel,
        streamOutput: false,
      };
      await agent.init(undefined, config);

      const runConfig: RunnableConfig = {
        recursionLimit: 250,
        configurable: { thread_id: 'test-thread-id' },
      };
      await agent.invoke([new HumanMessage('test message')], runConfig);

      expect(statusUpdateCallback).toHaveBeenCalledWith('info', '\nUsed tools: read_file()');
    });

    it('should handle multiple tool calls in non-streaming mode', async () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      // Use FakeListChatModel to simulate a response with multiple tool calls
      const fakeListChatModel = new FakeListChatModel({
        responses: [
          new AIMessage({
            content: 'chunk content bye',
            tool_calls: [
              { name: 'read_file', args: {}, id: '1' },
              { name: 'write_file', args: {}, id: '2' },
            ],
          }) as any as string,
        ],
      });
      fakeListChatModel.bindTools = vi.fn().mockReturnValue(fakeListChatModel);

      const mockTools = [
        {
          name: 'read_file',
          description: 'Mock read file tool',
          invoke: vi.fn().mockResolvedValue('file content'),
        } as Partial<StructuredToolInterface>,
        {
          name: 'write_file',
          description: 'Mock write file tool',
          invoke: vi.fn().mockResolvedValue('write success'),
        } as Partial<StructuredToolInterface>,
      ];

      const config = {
        ...mockConfig,
        llm: fakeListChatModel,
        streamOutput: false,
        tools: mockTools,
      } as SlothConfig;
      await agent.init(undefined, config);

      const runConfig: RunnableConfig = {
        recursionLimit: 250,
        configurable: { thread_id: 'test-thread-id' },
      };
      await agent.invoke([new HumanMessage('test message')], runConfig);

      expect(statusUpdateCallback).toHaveBeenCalledWith(
        'info',
        '\nUsed tools: read_file(), write_file()'
      );
    });

    it('should handle ToolException errors in non-streaming mode', async () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      const error = new Error('Tool failed');
      error.name = 'ToolException';

      const fakeListChatModel = new FakeListChatModel({
        responses: ['test response'],
      });
      fakeListChatModel.bindTools = vi.fn().mockReturnValue(fakeListChatModel);

      const config = {
        ...mockConfig,
        llm: fakeListChatModel,
        streamOutput: false,
      };
      await agent.init(undefined, config);

      const reactAgent = agent['agent'];
      if (reactAgent) {
        reactAgent.invoke = vi.fn().mockRejectedValue(error);
      }

      const runConfig: RunnableConfig = {
        recursionLimit: 250,
        configurable: { thread_id: 'test-thread-id' },
      };
      const result = await agent.invoke([new HumanMessage('test message')], runConfig);
      expect(result).toBe('Tool execution failed: Tool failed');
      expect(statusUpdateCallback).toHaveBeenCalledWith(
        'error',
        'Tool execution failed: Tool failed'
      );
    });

    it('should pass run config to agent', async () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      const fakeListChatModel = new FakeListChatModel({
        responses: ['test response'],
      });
      fakeListChatModel.bindTools = vi.fn().mockReturnValue(fakeListChatModel);

      const config = {
        ...mockConfig,
        llm: fakeListChatModel,
      };
      await agent.init(undefined, config);

      const runConfig: RunnableConfig = {
        recursionLimit: 250,
        configurable: { thread_id: 'test-thread-id' },
      };
      const result = await agent.invoke([new HumanMessage('test message')], runConfig);

      expect(result).toBe('test response');
    });
  });

  describe('stream', () => {
    it('should throw error if not initialized', async () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      const runConfig: RunnableConfig = {
        recursionLimit: 250,
        configurable: { thread_id: 'test-thread-id' },
      };

      await expect(agent.stream([new HumanMessage('test')], runConfig)).rejects.toThrow(
        'Agent not initialized. Call init() first.'
      );
    });

    it('should stream agent responses', async () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      const fakeStreamingChatModel = new FakeStreamingChatModel({
        chunks: [
          new AIMessageChunk({ content: 'chunk1' }),
          new AIMessageChunk({ content: 'chunk2' }),
        ],
      });
      fakeStreamingChatModel.bindTools = vi.fn().mockReturnValue(fakeStreamingChatModel);

      const streamConfig = {
        ...mockConfig,
        llm: fakeStreamingChatModel,
        streamOutput: true,
      };
      await agent.init(undefined, streamConfig);

      const runConfig: RunnableConfig = {
        recursionLimit: 250,
        configurable: { thread_id: 'test-thread-id' },
      };
      const stream = await agent.stream([new HumanMessage('test message')], runConfig);

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['chunk1', 'chunk2']);
    });
  });

  describe('cleanup', () => {
    it('should cleanup MCP client and reset state', async () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      const configWithMcp = {
        ...mockConfig,
        mcpServers: {
          custom: {
            transport: 'stdio' as const,
            command: 'custom-server',
            args: [],
          },
        },
      } as SlothConfig;
      mcpClientInstanceMock.getTools.mockResolvedValue([]);

      await agent.init(undefined, configWithMcp);
      await agent.cleanup();

      expect(mcpClientInstanceMock.close).toHaveBeenCalled();
      expect(agent['mcpClient']).toBeNull();
      expect(agent['agent']).toBeNull();
      expect(agent['config']).toBeNull();
    });

    it('should handle cleanup when not initialized', async () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);

      await expect(agent.cleanup()).resolves.not.toThrow();
    });
  });

  describe('getMcpClient', () => {
    it('should return null when no MCP servers configured', async () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      const config = {
        ...mockConfig,
        filesystem: 'none',
        mcpServers: undefined,
      } as SlothConfig;

      const result = await agent['getMcpClient'](config);

      expect(result).toBeNull();
    });

    it('should create MCP client with custom server', async () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      const config = {
        ...mockConfig,
        filesystem: 'all' as const,
        mcpServers: {
          custom: {
            transport: 'stdio' as const,
            command: 'custom-server',
            args: ['--arg'],
          },
        },
      };

      const result = await agent['getMcpClient'](config);

      expect(multiServerMCPClientMock).toHaveBeenCalledWith({
        throwOnLoadError: true,
        prefixToolNameWithServerName: true,
        additionalToolNamePrefix: 'mcp',
        mcpServers: {
          custom: {
            transport: 'stdio',
            command: 'custom-server',
            args: ['--arg'],
          },
        },
      });
      expect(result).toBe(mcpClientInstanceMock);
    });

    it('should handle OAuth authentication', async () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      const mockAuthProvider = { token: 'test-token' };
      createAuthProviderAndAuthenticateMock.mockResolvedValue(mockAuthProvider);

      const config = {
        ...mockConfig,
        mcpServers: {
          oauth: {
            url: 'https://example.com',
            authProvider: 'OAuth',
          },
        },
      } as any as SlothConfig;

      await agent['getMcpClient'](config);

      expect(createAuthProviderAndAuthenticateMock).toHaveBeenCalledWith({
        url: 'https://example.com',
        authProvider: 'OAuth',
      });
      expect(consoleUtilsMock.displayInfo).toHaveBeenCalledWith(
        'Starting OAuth for for https://example.com'
      );
    });
  });

  describe('getEffectiveConfig', () => {
    it('should merge command-specific config', () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      const config = {
        ...mockConfig,
        filesystem: 'read',
        builtInTools: ['general'],
        commands: {
          code: {
            filesystem: 'all',
            builtInTools: ['specific'],
          },
        },
      } as SlothConfig;

      const result = agent.getEffectiveConfig(config, 'code');

      expect(result.filesystem).toBe('all');
      expect(result.builtInTools).toEqual(['specific']);
    });

    it('should use default config when no command-specific config', () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      const config = {
        ...mockConfig,
        filesystem: 'read',
        builtInTools: ['general'],
      } as SlothConfig;

      const result = agent.getEffectiveConfig(config, 'code');

      expect(result.filesystem).toBe('read');
      expect(result.builtInTools).toEqual(['general']);
    });

    it('should warn when model does not support tools', () => {
      const agent = new GthLangChainAgent(statusUpdateCallback);
      const config = {
        ...mockConfig,
        llm: {
          ...mockConfig.llm,
          bindTools: undefined,
        },
      } as SlothConfig;

      agent.getEffectiveConfig(config, undefined);

      expect(statusUpdateCallback).toHaveBeenCalledWith(
        'warning',
        'Model does not seem to support tools.'
      );
    });
  });
});
