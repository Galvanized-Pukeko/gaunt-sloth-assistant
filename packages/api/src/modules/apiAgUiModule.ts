import express from 'express';
import { randomUUID } from 'node:crypto';
import { EventEncoder } from '@ag-ui/encoder';
import { EventType } from '@ag-ui/core';
import { GthConfig } from '@gaunt-sloth/core/config.js';
import { GthLangChainAgent } from '@gaunt-sloth/core/core/GthLangChainAgent.js';
import {
  defaultStatusCallback,
  displayInfo,
  displayWarning,
} from '@gaunt-sloth/core/utils/consoleUtils.js';
import {
  getNewRunnableConfig,
  buildSystemMessages,
  readChatPrompt,
} from '@gaunt-sloth/core/utils/llmUtils.js';
import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import { createResolvers } from '#src/resolvers.js';

const initializedThreads = new Set<string>();

/**
 * Return the first complete JSON value at the start of `s`, ignoring any
 * trailing characters. Used to recover from streamed tool-call argument
 * reassembly that concatenates objects (e.g. `{}{}` or `{"steps":3}{}`) when a
 * model emits parallel tool calls — local models like Ollama/Gemma don't honor
 * `disable_parallel_tool_use`, and their delta streams can merge sibling calls'
 * argument buffers. Returns `undefined` if no complete leading value is found.
 */
function extractFirstJsonValue(s: string): unknown {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
    } else if (c === '{' || c === '[') {
      depth++;
    } else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(0, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/**
 * Parse a tool call's `arguments` string defensively. A single malformed
 * argument payload must not abort the whole run — the message is part of the
 * persisted history and would otherwise poison every subsequent turn on the
 * thread.
 */
function parseToolArguments(raw: string | undefined, toolName: string): Record<string, unknown> {
  const s = (raw ?? '').trim();
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    const recovered = extractFirstJsonValue(s);
    if (recovered && typeof recovered === 'object') {
      displayWarning(
        `Recovered malformed tool arguments for ${toolName} (${JSON.stringify(s)} -> ${JSON.stringify(recovered)}). ` +
          'Likely parallel tool calls from a model that ignores disable_parallel_tool_use.'
      );
      return recovered as Record<string, unknown>;
    }
    displayWarning(
      `Unparseable tool arguments for ${toolName} (${JSON.stringify(s)}); defaulting to {}.`
    );
    return {};
  }
}

/**
 * Convert AG-UI message format to LangChain BaseMessage
 */
function convertMessage(msg: {
  role: string;
  content?: string;
  id: string;
  toolCalls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  toolCallId?: string;
}): BaseMessage {
  const content = typeof msg.content === 'string' ? msg.content : '';
  switch (msg.role) {
    case 'user':
      return new HumanMessage(content);
    case 'assistant': {
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        return new AIMessage({
          content: content,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            args: parseToolArguments(tc.function.arguments, tc.function.name),
            type: 'tool_call' as const,
          })),
        });
      }
      return new AIMessage(content);
    }
    case 'system':
    case 'developer':
      return new SystemMessage(content);
    case 'tool':
      return new ToolMessage({ content, tool_call_id: msg.toolCallId || msg.id });
    default:
      return new HumanMessage(content);
  }
}

export async function startAgUiServer(config: GthConfig, port: number): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  displayInfo(
    'WARNING: AG-UI server is intended for local clients only. Do not expose to public networks.'
  );

  // CORS — configured via commands.api.cors in config
  const corsOrigin = config.commands?.api?.cors?.allowOrigin ?? 'http://localhost:3000';
  const corsMethods = config.commands?.api?.cors?.allowMethods ?? 'POST, GET, OPTIONS';
  const corsHeaders = config.commands?.api?.cors?.allowHeaders ?? 'Content-Type, Accept';

  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', corsMethods);
    res.setHeader('Access-Control-Allow-Headers', corsHeaders);
    if (_req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Initialize agent.
  // Note this would need a refactoring if it is to be used for a public web server,
  // For connecting local WEB to local CLI agent, this is absolutely OK, since one thread is OK.
  const checkpointSaver = new MemorySaver();
  const agent = new GthLangChainAgent(defaultStatusCallback, createResolvers());
  await agent.init('api', config, checkpointSaver);

  displayInfo(`AG-UI agent initialized`);

  // AG-UI endpoint — standard path per AG-UI protocol
  app.post('/agents/:agentId/run', async (req, res) => {
    const { threadId, runId, messages, forwardedProps } = req.body;
    const effectiveThreadId = threadId || randomUUID();
    const effectiveRunId = runId || randomUUID();

    const encoder = new EventEncoder({ accept: req.headers.accept });
    res.setHeader('Content-Type', encoder.getContentType());
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      // RUN_STARTED
      res.write(
        encoder.encode({
          type: EventType.RUN_STARTED,
          threadId: effectiveThreadId,
          runId: effectiveRunId,
        })
      );

      const messageId = randomUUID();

      // Get runnable config with thread_id for checkpointing
      const runConfig = {
        ...getNewRunnableConfig(),
        configurable: { thread_id: effectiveThreadId },
      };

      // Stream the response with typed events
      let textMessageStarted = false;
      let reasoningMessageId: string | null = null;

      let eventStream;
      if (forwardedProps?.command?.resume !== undefined) {
        // Follow-up messages piggy-backed on the resume: deliver them to the
        // agent on its next decision turn via Command.update (see
        // GthLangChainAgent.streamWithEventsResume). Accepts plain strings or
        // AG-UI message objects.
        const queued = forwardedProps.command.queuedMessages;
        const queuedMessages: BaseMessage[] = Array.isArray(queued)
          ? queued
              .map((s: unknown) =>
                typeof s === 'string'
                  ? new HumanMessage(s)
                  : convertMessage(s as Parameters<typeof convertMessage>[0])
              )
              .filter((m): m is BaseMessage => Boolean(m))
          : [];
        eventStream = agent.streamWithEventsResume(
          forwardedProps.command.resume,
          runConfig,
          queuedMessages
        );
      } else {
        // Build LangChain messages, prepending system prompt for new threads
        const langChainMessages: BaseMessage[] = [];
        if (!initializedThreads.has(effectiveThreadId)) {
          initializedThreads.add(effectiveThreadId);
          langChainMessages.push(...buildSystemMessages(config, readChatPrompt(config)));
        }
        langChainMessages.push(...(messages || []).map(convertMessage));
        eventStream = agent.streamWithEvents(langChainMessages, runConfig);
      }

      for await (const event of eventStream) {
        switch (event.type) {
          case 'text': {
            if (!textMessageStarted) {
              res.write(
                encoder.encode({
                  type: EventType.TEXT_MESSAGE_START,
                  messageId,
                  role: 'assistant',
                })
              );
              textMessageStarted = true;
            }
            res.write(
              encoder.encode({
                type: EventType.TEXT_MESSAGE_CONTENT,
                messageId,
                delta: event.delta,
              })
            );
            break;
          }
          case 'tool_start': {
            res.write(
              encoder.encode({
                type: EventType.TOOL_CALL_START,
                toolCallId: event.id,
                toolCallName: event.name,
                parentMessageId: messageId,
              })
            );
            break;
          }
          case 'tool_args': {
            res.write(
              encoder.encode({
                type: EventType.TOOL_CALL_ARGS,
                toolCallId: event.id,
                delta: event.delta,
              })
            );
            break;
          }
          case 'tool_end': {
            res.write(
              encoder.encode({
                type: EventType.TOOL_CALL_END,
                toolCallId: event.id,
              })
            );
            break;
          }
          case 'tool_result': {
            res.write(
              encoder.encode({
                type: EventType.TOOL_CALL_RESULT,
                toolCallId: event.id,
                content: event.content,
                role: 'tool',
                messageId: randomUUID(),
              })
            );
            break;
          }
          case 'reasoning_start': {
            reasoningMessageId = randomUUID();
            res.write(
              encoder.encode({
                type: EventType.REASONING_MESSAGE_START,
                messageId: reasoningMessageId,
                role: 'reasoning',
              })
            );
            break;
          }
          case 'reasoning_delta': {
            if (reasoningMessageId) {
              res.write(
                encoder.encode({
                  type: EventType.REASONING_MESSAGE_CONTENT,
                  messageId: reasoningMessageId,
                  delta: event.delta,
                })
              );
            }
            break;
          }
          case 'reasoning_end': {
            if (reasoningMessageId) {
              res.write(
                encoder.encode({
                  type: EventType.REASONING_MESSAGE_END,
                  messageId: reasoningMessageId,
                })
              );
              reasoningMessageId = null;
            }
            break;
          }
        }
      }

      // TEXT_MESSAGE_END (only if a text message was started)
      if (textMessageStarted) {
        res.write(
          encoder.encode({
            type: EventType.TEXT_MESSAGE_END,
            messageId,
          })
        );
      }

      // RUN_FINISHED
      res.write(
        encoder.encode({
          type: EventType.RUN_FINISHED,
          threadId: effectiveThreadId,
          runId: effectiveRunId,
        })
      );

      res.end();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.write(
        encoder.encode({
          type: EventType.RUN_ERROR,
          message: errorMessage,
        })
      );
      res.end();
    }
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Agent metadata — lets clients display which model/provider is serving them.
  // provider is read from the LangChain model's _llmType() (e.g. "ollama",
  // "anthropic"); model from config.modelDisplayName, falling back to the
  // chat model's own `model` field.
  app.get('/info', (_req, res) => {
    const llm = config.llm as { _llmType?: () => string; model?: string } | undefined;
    let provider: string | null = null;
    try {
      provider = typeof llm?._llmType === 'function' ? llm._llmType() : null;
    } catch {
      provider = null;
    }
    res.json({
      status: 'ok',
      provider,
      model: config.modelDisplayName ?? llm?.model ?? null,
    });
  });

  return new Promise((resolve) => {
    app.listen(port, () => {
      displayInfo(`AG-UI server listening at http://localhost:${port}`);
      displayInfo(`AG-UI endpoint: POST http://localhost:${port}/agents/{agentId}/run`);
      resolve();
    });
  });
}
