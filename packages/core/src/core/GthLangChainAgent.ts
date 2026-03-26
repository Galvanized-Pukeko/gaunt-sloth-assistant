import { GthConfig, ServerTool } from '#src/config.js';
import {
  AgentResolvers,
  GthAgentInterface,
  GthCommand,
  Message,
  StatusLevel,
  StatusUpdateCallback,
} from '#src/core/types.js';
import { debugLog, debugLogError, debugLogObject } from '#src/utils/debugUtils.js';
import { formatToolCalls } from '#src/utils/llmUtils.js';
import { ProgressIndicator } from '#src/utils/ProgressIndicator.js';
import { stopWaitingForEscape, waitForEscape, getCurrentWorkDir } from '#src/utils/systemUtils.js';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { BaseToolkit, StructuredToolInterface } from '@langchain/core/tools';
import { IterableReadableStream } from '@langchain/core/utils/stream';
import { BaseCheckpointSaver } from '@langchain/langgraph';
import { createAgent, createMiddleware } from 'langchain';
import {
  extractInlineBinaryBlocks,
  materializeBinaryOutputs,
  renderAssistantContent,
} from '#src/utils/binaryOutputUtils.js';

export type AgentStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; id: string; name: string }
  | { type: 'tool_args'; id: string; delta: string }
  | { type: 'tool_end'; id: string }
  | { type: 'tool_result'; id: string; content: string };

export class GthLangChainAgent implements GthAgentInterface {
  private statusUpdate: StatusUpdateCallback;
  private resolvers: AgentResolvers | undefined;
  private agent: ReturnType<typeof createAgent> | null = null;
  private config: GthConfig | null = null;
  private command: GthCommand | undefined = undefined;

  constructor(statusUpdate: StatusUpdateCallback, resolvers?: AgentResolvers) {
    this.statusUpdate = (level: StatusLevel, message: string) => {
      statusUpdate(level, message);
    };
    this.resolvers = resolvers;
  }

  async init(
    command: GthCommand | undefined,
    configIn: GthConfig,
    checkpointer?: BaseCheckpointSaver | undefined
  ): Promise<void> {
    this.command = command;
    debugLog(`GthLangChainAgent.init called with command: ${command || 'default'}`);

    // Merge command-specific filesystem config if provided
    this.config = this.getEffectiveConfig(configIn, command);
    debugLogObject('Effective Config', {
      filesystem: this.config.filesystem,
      builtInTools: this.config.builtInTools,
      streamOutput: this.config.streamOutput,
      debugLog: this.config.debugLog,
    });

    this.statusUpdate(StatusLevel.INFO, `Workdir: ${getCurrentWorkDir()}`);

    if (this.config.modelDisplayName) {
      this.statusUpdate(StatusLevel.INFO, `Model: ${this.config.modelDisplayName}`);
    }

    // Resolve tools via resolver or fall back to config tools only
    debugLog('Resolving tools...');
    const resolvedTools = this.resolvers?.resolveTools
      ? await this.resolvers.resolveTools(this.config, command)
      : [];
    debugLog(`Resolved tools loaded: ${resolvedTools.length}`);

    // Get user config tools
    const flattenedConfigTools = this.extractAndFlattenTools(this.config.tools || []);
    debugLog(`User config tools loaded: ${flattenedConfigTools.length}`);

    // Combine all tools
    const tools = [...resolvedTools, ...flattenedConfigTools];

    if (tools.length > 0) {
      const toolNames = tools
        .map((tool) => tool.name)
        .filter((name) => name)
        .join(', ');
      this.statusUpdate(StatusLevel.INFO, `Loaded tools: ${toolNames}`);
      debugLog(`Total tools available: ${tools.length}`);
      debugLogObject('All Tools', toolNames.split(', '));
    }

    // Create the React agent
    debugLog('Creating React agent...');

    // Resolve middleware via resolver or fall back to empty
    const configuredMiddleware = this.resolvers?.resolveMiddleware
      ? await this.resolvers.resolveMiddleware(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          this.config.middleware as any[] | undefined,
          this.config
        )
      : [];

    // Add tool call status update middleware
    const toolCallStatusMiddleware = createMiddleware({
      name: 'GthMiddlewareToolCallStatusUpdate',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      afterModel: (state: any) => {
        debugLogObject('postModel state', state);
        const lastMessage = state.messages[state.messages.length - 1];
        if (
          AIMessage.isInstance(lastMessage) &&
          lastMessage.tool_calls &&
          lastMessage.tool_calls?.length > 0
        ) {
          this.statusUpdate(
            StatusLevel.INFO,
            `\nRequested tools: ${formatToolCalls(lastMessage.tool_calls)}\n`
          );
        }
        return state;
      },
    });

    // Combine all middleware
    const middleware = [...configuredMiddleware, toolCallStatusMiddleware];

    this.statusUpdate(
      StatusLevel.INFO,
      `Loaded middleware: ${middleware.map((m) => m.name).join(', ')}`
    );

    // Create agent with configured middleware
    this.agent = createAgent({
      model: this.config.llm,
      tools,
      middleware,
      checkpointer,
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
        const finalMessage = response.messages[response.messages.length - 1];
        const finalContent = finalMessage?.content;
        const processedContent = !this.config.writeBinaryOutputsToFile
          ? {
              renderedContent: renderAssistantContent(finalContent),
              successMessages: [],
            }
          : materializeBinaryOutputs(finalContent, this.command);

        if (processedContent.renderedContent.trim().length > 0) {
          this.statusUpdate(StatusLevel.DISPLAY, processedContent.renderedContent);
        }
        for (const successMessage of processedContent.successMessages) {
          this.statusUpdate(StatusLevel.SUCCESS, successMessage);
        }
        return [processedContent.renderedContent, ...processedContent.successMessages]
          .filter((part) => part.trim().length > 0)
          .join('\n');
      } catch (e) {
        debugLogError('invoke inner', e);
        if (e instanceof Error && e?.name === 'ToolException') {
          throw e; // Re-throw ToolException to be handled by outer catch
        }
        const message = e instanceof Error ? e.message : String(e);
        this.statusUpdate(StatusLevel.ERROR, `LLM invocation failed: ${message}`);
        throw e;
      } finally {
        progress.stop();
      }
    } catch (error) {
      debugLogError('invoke outer', error);
      if (error instanceof Error) {
        if (error?.name === 'ToolException') {
          this.statusUpdate(StatusLevel.ERROR, `Tool execution failed: ${error?.message}`);
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

    this.statusUpdate(StatusLevel.INFO, '\nThinking...\n');

    const statusUpdate = this.statusUpdate;
    const config = this.config;
    const command = this.command;
    const interruptState = { escape: false, messageShown: false };
    const abortController = new AbortController();
    const showInterruptMessage = () => {
      if (!interruptState.messageShown) {
        interruptState.messageShown = true;
        statusUpdate(StatusLevel.WARNING, '\n\nInterrupted by user, exiting\n\n');
      }
    };
    waitForEscape(() => {
      interruptState.escape = true;
      showInterruptMessage();
      if (!abortController.signal.aborted) {
        abortController.abort();
      }
    }, this.config.canInterruptInferenceWithEsc);

    const stream = await this.agent.stream(
      { messages },
      { ...runConfig, streamMode: 'messages', signal: abortController.signal }
    );

    return new IterableReadableStream({
      async start(controller) {
        try {
          debugLog('Starting stream processing...');
          let totalChunks = 0;
          const seenBinaryBlocks = new Set<string>();
          const binaryBlocks: Array<{ mimeType: string; data: string }> = [];

          for await (const [chunk, _metadata] of stream) {
            debugLogObject('Stream chunk', { chunk, _metadata });
            if (AIMessage.isInstance(chunk)) {
              const text = (chunk.text as string) ?? '';
              totalChunks++;

              if (text.length > 0) {
                statusUpdate(StatusLevel.STREAM, text);
                controller.enqueue(text);
              }

              if (config?.writeBinaryOutputsToFile) {
                for (const block of extractInlineBinaryBlocks(chunk.content)) {
                  const binaryKey = `${block.mimeType}:${block.data.length}:${block.data}`;
                  if (seenBinaryBlocks.has(binaryKey)) {
                    continue;
                  }
                  seenBinaryBlocks.add(binaryKey);
                  binaryBlocks.push({ mimeType: block.mimeType, data: block.data });
                }
              }
            }
            if (interruptState.escape) {
              if (typeof stream.cancel === 'function') {
                await stream.cancel();
              }
              break;
            }
          }
          if (config?.writeBinaryOutputsToFile && binaryBlocks.length > 0) {
            const processedContent = materializeBinaryOutputs(
              binaryBlocks.map((block) => ({
                type: 'inlineData',
                inlineData: block,
              })),
              command
            );
            for (const successMessage of processedContent.successMessages) {
              statusUpdate(StatusLevel.SUCCESS, successMessage);
            }
          }
          debugLog(`Stream completed. Total chunks: ${totalChunks}`);
          controller.close();
        } catch (error) {
          if (interruptState.escape || (error instanceof Error && error.name === 'AbortError')) {
            showInterruptMessage();
            controller.close();
          } else {
            debugLogError('stream processing', error);
            if (error instanceof Error) {
              if (error?.name === 'ToolException') {
                statusUpdate(StatusLevel.ERROR, `Tool execution failed: ${error?.message}`);
              }
            }
            controller.error(error);
          }
        } finally {
          stopWaitingForEscape();
        }
      },
      async cancel() {
        stopWaitingForEscape();
        if (!abortController.signal.aborted) {
          abortController.abort();
        }
        // Clean up the underlying stream if it has a cancel method
        if (stream && typeof stream.cancel === 'function') {
          await stream.cancel();
        }
      },
    });
  }

  /**
   * Stream agent events as typed AgentStreamEvent objects.
   * Yields text deltas, tool call lifecycle events, and tool results.
   */
  async *streamWithEvents(
    messages: Message[],
    runConfig: RunnableConfig
  ): AsyncGenerator<AgentStreamEvent> {
    if (!this.agent || !this.config) {
      throw new Error('Agent not initialized. Call init() first.');
    }

    debugLog('=== Starting streamWithEvents ===');
    debugLogObject('LLM Input Messages', messages);

    const stream = await this.agent.stream({ messages }, { ...runConfig, streamMode: 'messages' });

    // Buffer tool calls across chunks so we use final (complete) args
    const pendingToolCalls = new Map<string, { id: string; name: string; args: unknown }>();

    for await (const [chunk, _metadata] of stream) {
      debugLogObject('streamWithEvents chunk', { chunk, _metadata });

      if (AIMessage.isInstance(chunk) && chunk.tool_calls && chunk.tool_calls.length > 0) {
        for (const tool_call of chunk.tool_calls) {
          // Keep updating with latest args as LLM streams them across chunks
          pendingToolCalls.set(tool_call.id as string, {
            id: tool_call.id as string,
            name: tool_call.name,
            args: tool_call.args,
          });
        }
      } else if (AIMessage.isInstance(chunk) && chunk.text) {
        yield { type: 'text', delta: chunk.text as string };
      }

      if (chunk instanceof ToolMessage) {
        // Flush buffered tool calls with their final args before the tool result
        for (const tc of pendingToolCalls.values()) {
          yield { type: 'tool_start', id: tc.id, name: tc.name };
          yield { type: 'tool_args', id: tc.id, delta: JSON.stringify(tc.args ?? {}) };
          yield { type: 'tool_end', id: tc.id };
        }
        pendingToolCalls.clear();

        const content =
          typeof chunk.content === 'string' ? chunk.content : JSON.stringify(chunk.content);
        yield { type: 'tool_result', id: chunk.tool_call_id as string, content };
      }
    }

    // Flush any tool calls not followed by a ToolMessage (e.g. terminal tool calls)
    for (const tc of pendingToolCalls.values()) {
      yield { type: 'tool_start', id: tc.id, name: tc.name };
      yield { type: 'tool_args', id: tc.id, delta: JSON.stringify(tc.args ?? {}) };
      yield { type: 'tool_end', id: tc.id };
    }
  }

  async cleanup(): Promise<void> {
    debugLog('Cleaning up GthLangChainAgent...');
    if (this.resolvers?.cleanupTools) {
      await this.resolvers.cleanupTools();
    }
    if (this.resolvers?.cleanupMiddleware) {
      await this.resolvers.cleanupMiddleware();
    }
    this.agent = null;
    this.config = null;
    this.command = undefined;
    debugLog('GthLangChainAgent cleanup complete');
  }

  getEffectiveConfig(config: GthConfig, command: GthCommand | undefined): GthConfig {
    debugLog(`Getting effective config for command: ${command || 'default'}`);
    const supportsTools = !!config.llm.bindTools;
    if (!supportsTools) {
      this.statusUpdate(StatusLevel.WARNING, 'Model does not seem to support tools.');
      debugLog('Warning: Model does not support tools');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cmdConfig = (command && config.commands?.[command]) as any;
    return {
      ...config,
      filesystem: cmdConfig?.filesystem !== undefined ? cmdConfig.filesystem : config.filesystem,
      builtInTools:
        cmdConfig?.builtInTools !== undefined ? cmdConfig.builtInTools : config.builtInTools,
      binaryFormats:
        cmdConfig?.binaryFormats !== undefined ? cmdConfig.binaryFormats : config.binaryFormats,
    };
  }

  /**
   * Extract and flatten tools from toolkits
   */
  private extractAndFlattenTools(
    tools: (StructuredToolInterface | BaseToolkit | ServerTool)[]
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
}
