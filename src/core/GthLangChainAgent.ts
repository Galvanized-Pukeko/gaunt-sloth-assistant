import { AIMessage, isAIMessage } from '@langchain/core/messages';
import { GthConfig } from '#src/config.js';
import type { Connection } from '@langchain/mcp-adapters';
import { MultiServerMCPClient, StreamableHTTPConnection } from '@langchain/mcp-adapters';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { BaseCheckpointSaver, CompiledStateGraph } from '@langchain/langgraph';
import { formatToolCalls, ProgressIndicator } from '#src/utils.js';
import { ToolCall } from '@langchain/core/messages/tool';
import { GthAgentInterface, GthCommand, StatusLevel } from '#src/core/types.js';
import { BaseToolkit, StructuredToolInterface } from '@langchain/core/tools';
import { getDefaultTools } from '#src/builtInToolsConfig.js';
import { createAuthProviderAndAuthenticate } from '#src/mcp/OAuthClientProviderImpl.js';
import { displayInfo } from '#src/consoleUtils.js';
import { IterableReadableStream } from '@langchain/core/utils/stream';
import { RunnableConfig } from '@langchain/core/runnables';
import type { Message } from '#src/modules/types.js';
import { debugLog, debugLogError, debugLogObject } from '#src/debugUtils.js';

export type StatusUpdateCallback = (level: StatusLevel, message: string) => void;

export class GthLangChainAgent implements GthAgentInterface {
  private statusUpdate: StatusUpdateCallback;
  private mcpClient: MultiServerMCPClient | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private agent: CompiledStateGraph<any, any> | null = null;
  private config: GthConfig | null = null;

  constructor(statusUpdate: StatusUpdateCallback) {
    this.statusUpdate = (level: StatusLevel, message: string) => {
      statusUpdate(level, message);
    };
  }

  async init(
    command: GthCommand | undefined,
    configIn: GthConfig,
    checkpointSaver?: BaseCheckpointSaver | undefined
  ): Promise<void> {
    debugLog(`GthLangChainAgent.init called with command: ${command || 'default'}`);

    // Merge command-specific filesystem config if provided
    this.config = this.getEffectiveConfig(configIn, command);
    debugLogObject('Effective Config', {
      filesystem: this.config.filesystem,
      builtInTools: this.config.builtInTools,
      streamOutput: this.config.streamOutput,
      debugLog: this.config.debugLog,
    });

    this.mcpClient = await this.getMcpClient(this.config);

    // Get default filesystem tools (filtered based on config)
    debugLog('Loading default tools...');
    const defaultTools = await getDefaultTools(this.config, command);
    debugLog(`Default tools loaded: ${defaultTools.length}`);

    // Get user config tools
    const flattenedConfigTools = this.extractAndFlattenTools(this.config.tools || []);
    debugLog(`User config tools loaded: ${flattenedConfigTools.length}`);

    // Get MCP tools
    const mcpTools = (await this.mcpClient?.getTools()) ?? [];
    debugLog(`MCP tools loaded: ${mcpTools.length}`);

    // Combine all tools
    const tools = [...defaultTools, ...flattenedConfigTools, ...mcpTools];

    if (tools.length > 0) {
      const toolNames = tools
        .map((tool) => tool.name)
        .filter((name) => name)
        .join(', ');
      this.statusUpdate('info', `Loaded tools: ${toolNames}`);
      debugLog(`Total tools available: ${tools.length}`);
      debugLogObject('All Tools', toolNames.split(', '));
    }

    // Create the React agent
    debugLog('Creating React agent...');
    this.agent = createReactAgent({
      llm: this.config.llm,
      tools,
      checkpointSaver,
    });
    debugLog('React agent created successfully');
  }

  /**
   * Invoke LLM with a message and runnable config.
   * For streaming use {@link #stream} method, streaming is preferred if model API supports it.
   * Please note that this when tools are involved, this method will anyway do multiple LLM
   * calls within LangChain dependency.
   */
  async invoke(messages: Message[], runConfig: RunnableConfig): Promise<string> {
    if (!this.agent || !this.config) {
      throw new Error('Agent not initialized. Call init() first.');
    }

    debugLog('=== Starting non-streaming invoke ===');
    debugLogObject('LLM Input Messages', messages);
    debugLogObject('Invoke RunConfig', runConfig);

    try {
      const progress = new ProgressIndicator('Thinking.');
      try {
        debugLog('Calling agent.invoke...');
        const response = await this.agent.invoke({ messages }, runConfig);

        debugLog(`Response received with ${response.messages.length} messages`);
        debugLogObject('Full Response', response);

        const aiMessage = response.messages[response.messages.length - 1].content as string;
        debugLogObject('LLM Response', aiMessage);

        const toolCalls = response.messages
          .filter((msg: AIMessage) => msg.tool_calls && msg.tool_calls.length > 0)
          .flatMap((msg: AIMessage) => msg.tool_calls ?? [])
          .filter((tc: ToolCall) => tc.name);

        if (toolCalls.length > 0) {
          debugLogObject('Tool Calls', toolCalls);
          this.statusUpdate('info', `\nRequested tools: ${formatToolCalls(toolCalls)}`);
        }

        this.statusUpdate('display', aiMessage);
        return aiMessage;
      } catch (e) {
        debugLogError('invoke inner', e);
        if (e instanceof Error && e?.name === 'ToolException') {
          throw e; // Re-throw ToolException to be handled by outer catch
        }
        this.statusUpdate('warning', `Something went wrong ${(e as Error).message}`);
        return '';
      } finally {
        progress.stop();
      }
    } catch (error) {
      debugLogError('invoke outer', error);
      if (error instanceof Error) {
        if (error?.name === 'ToolException') {
          this.statusUpdate('error', `Tool execution failed: ${error?.message}`);
          return `Tool execution failed: ${error?.message}`;
        }
      }
      throw error;
    }
  }

  /**
   * Induce LLM to stream AI messages with a user message and runnable config.
   * When stream is not appropriate use {@link invoke}.
   */
  async stream(
    messages: Message[],
    runConfig: RunnableConfig
  ): Promise<IterableReadableStream<string>> {
    if (!this.agent || !this.config) {
      throw new Error('Agent not initialized. Call init() first.');
    }

    debugLog('=== Starting streaming invoke ===');
    debugLogObject('LLM Input Messages', messages);
    debugLogObject('Stream RunConfig', runConfig);

    this.statusUpdate('info', '\nThinking...\n');
    const stream = await this.agent.stream({ messages }, { ...runConfig, streamMode: 'messages' });

    const statusUpdate = this.statusUpdate;
    return new IterableReadableStream({
      async start(controller) {
        try {
          debugLog('Starting stream processing...');
          let totalChunks = 0;

          for await (const [chunk, _metadata] of stream) {
            debugLogObject('Stream chunk', { chunk, _metadata });
            if (isAIMessage(chunk)) {
              const text = chunk.text as string;
              totalChunks++;

              statusUpdate('stream', text);
              controller.enqueue(text);

              const toolCalls = chunk.tool_calls?.filter((tc) => tc.name);
              if (toolCalls && toolCalls.length > 0) {
                statusUpdate('info', `\nRequested tools: ${formatToolCalls(toolCalls)}`);
              }
            }
          }

          debugLog(`Stream completed. Total chunks: ${totalChunks}`);
          controller.close();
        } catch (error) {
          debugLogError('stream processing', error);
          if (error instanceof Error) {
            if (error?.name === 'ToolException') {
              statusUpdate('error', `Tool execution failed: ${error?.message}`);
            }
          }
          controller.error(error);
        }
      },
      async cancel() {
        // Clean up the underlying stream if it has a cancel method
        if (stream && typeof stream.cancel === 'function') {
          await stream.cancel();
        }
      },
    });
  }

  // noinspection JSUnusedGlobalSymbols
  public getMCPClient(): MultiServerMCPClient | null {
    return this.mcpClient;
  }

  async cleanup(): Promise<void> {
    debugLog('Cleaning up GthLangChainAgent...');
    if (this.mcpClient) {
      debugLog('Closing MCP client...');
      await this.mcpClient.close();
      this.mcpClient = null;
    }
    this.agent = null;
    this.config = null;
    debugLog('GthLangChainAgent cleanup complete');
  }

  getEffectiveConfig(config: GthConfig, command: GthCommand | undefined): GthConfig {
    debugLog(`Getting effective config for command: ${command || 'default'}`);
    const supportsTools = !!config.llm.bindTools;
    if (!supportsTools) {
      this.statusUpdate('warning', 'Model does not seem to support tools.');
      debugLog('Warning: Model does not support tools');
    }
    return {
      ...config,
      filesystem:
        command && config.commands?.[command]?.filesystem !== undefined
          ? config.commands[command].filesystem!
          : config.filesystem,
      builtInTools:
        command && config.commands?.[command]?.builtInTools !== undefined
          ? config.commands[command].builtInTools!
          : config.builtInTools,
    };
  }

  /**
   * Extract and flatten tools from toolkits
   */
  private extractAndFlattenTools(
    tools: (StructuredToolInterface | BaseToolkit)[]
  ): StructuredToolInterface[] {
    const flattenedTools: StructuredToolInterface[] = [];
    for (const toolOrToolkit of tools) {
      // eslint-disable-next-line
      if ((toolOrToolkit as any)['getTools'] instanceof Function) {
        // This is a toolkit
        flattenedTools.push(...(toolOrToolkit as BaseToolkit).getTools());
      } else {
        // This is a regular tool
        flattenedTools.push(toolOrToolkit as StructuredToolInterface);
      }
    }
    return flattenedTools;
  }

  protected getDefaultMcpServers(): Record<string, Connection> {
    return {};
  }

  protected async getMcpClient(config: GthConfig) {
    debugLog('Setting up MCP client...');
    const defaultServers = this.getDefaultMcpServers();

    // Merge with user's mcpServers
    const rawMcpServers = { ...defaultServers, ...(config.mcpServers || {}) };
    debugLog(`MCP servers count: ${Object.keys(rawMcpServers).length}`);

    const mcpServers = {} as Record<string, StreamableHTTPConnection>;
    for (const serverName of Object.keys(rawMcpServers)) {
      const server = rawMcpServers[serverName] as StreamableHTTPConnection;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (server.url && server && (server.authProvider as any) === 'OAuth') {
        displayInfo(`Starting OAuth for for ${server.url}`);
        const authProvider = await createAuthProviderAndAuthenticate(server);
        mcpServers[serverName] = {
          ...server,
          authProvider,
        };
      } else {
        // Add non-OAuth servers as-is
        mcpServers[serverName] = server;
      }
    }

    if (Object.keys(mcpServers).length > 0) {
      debugLog('Creating MultiServerMCPClient...');
      return new MultiServerMCPClient({
        throwOnLoadError: true,
        prefixToolNameWithServerName: true,
        additionalToolNamePrefix: 'mcp',
        mcpServers: mcpServers,
      });
    } else {
      debugLog('No MCP servers configured');
      return null;
    }
  }
}
