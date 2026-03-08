import express from 'express';
import { randomUUID } from 'node:crypto';
import { EventEncoder } from '@ag-ui/encoder';
import { EventType } from '@ag-ui/core';
import { GthConfig } from '#src/config.js';
import { GthLangChainAgent } from '#src/core/GthLangChainAgent.js';
import { defaultStatusCallback } from '#src/utils/consoleUtils.js';
import { displayInfo } from '#src/utils/consoleUtils.js';
import { getNewRunnableConfig, buildSystemMessages, readChatPrompt } from '#src/utils/llmUtils.js';
import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';

const initializedThreads = new Set<string>();

/**
 * Convert AG-UI message format to LangChain BaseMessage
 */
function convertMessage(msg: { role: string; content?: string; id: string }): BaseMessage {
  const content = typeof msg.content === 'string' ? msg.content : '';
  switch (msg.role) {
    case 'user':
      return new HumanMessage(content);
    case 'assistant':
      return new AIMessage(content);
    case 'system':
    case 'developer':
      return new SystemMessage(content);
    case 'tool':
      return new ToolMessage({ content, tool_call_id: msg.id });
    default:
      return new HumanMessage(content);
  }
}

export async function startAgUiServer(config: GthConfig, port: number): Promise<void> {
  const app = express();
  app.use(express.json());

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
  const agent = new GthLangChainAgent(defaultStatusCallback);
  await agent.init('api', config, checkpointSaver);

  displayInfo(`AG-UI agent initialized`);

  // AG-UI endpoint — standard path per AG-UI protocol
  app.post('/agents/:agentId/run', async (req, res) => {
    const { threadId, runId, messages } = req.body;
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

      // Build LangChain messages, prepending system prompt for new threads
      const langChainMessages: BaseMessage[] = [];
      if (!initializedThreads.has(effectiveThreadId)) {
        initializedThreads.add(effectiveThreadId);
        langChainMessages.push(...buildSystemMessages(config, readChatPrompt(config)));
      }
      langChainMessages.push(...(messages || []).map(convertMessage));

      const messageId = randomUUID();

      // Get runnable config with thread_id for checkpointing
      const runConfig = {
        ...getNewRunnableConfig(),
        configurable: { thread_id: effectiveThreadId },
      };

      // Stream the response with typed events
      let textMessageStarted = false;

      for await (const event of agent.streamWithEvents(langChainMessages, runConfig)) {
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

  return new Promise((resolve) => {
    app.listen(port, () => {
      displayInfo(`AG-UI server listening at http://localhost:${port}`);
      displayInfo(`AG-UI endpoint: POST http://localhost:${port}/agents/{agentId}/run`);
      resolve();
    });
  });
}
