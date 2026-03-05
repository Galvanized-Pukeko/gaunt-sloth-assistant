import express from 'express';
import { randomUUID } from 'node:crypto';
import { EventEncoder } from '@ag-ui/encoder';
import { EventType } from '@ag-ui/core';
import { GthConfig } from '#src/config.js';
import { GthLangChainAgent } from '#src/core/GthLangChainAgent.js';
import { defaultStatusCallback } from '#src/utils/consoleUtils.js';
import { displayInfo } from '#src/utils/consoleUtils.js';
import { getNewRunnableConfig, buildSystemMessages, readChatPrompt } from '#src/utils/llmUtils.js';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
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
    default:
      return new HumanMessage(content);
  }
}

export async function startAgUiServer(config: GthConfig, port: number): Promise<void> {
  const app = express();
  app.use(express.json());

  displayInfo('WARNING: AG-UI server is intended for local clients only. Do not expose to public networks.');

  // CORS — wide open, local use only
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    if (_req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Initialize agent
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

      // TEXT_MESSAGE_START
      res.write(
        encoder.encode({
          type: EventType.TEXT_MESSAGE_START,
          messageId,
          role: 'assistant',
        })
      );

      // Get runnable config with thread_id for checkpointing
      const runConfig = {
        ...getNewRunnableConfig(),
        configurable: { thread_id: effectiveThreadId },
      };

      // Stream the response
      const stream = await agent.stream(langChainMessages, runConfig);

      for await (const chunk of stream) {
        if (chunk) {
          res.write(
            encoder.encode({
              type: EventType.TEXT_MESSAGE_CONTENT,
              messageId,
              delta: chunk,
            })
          );
        }
      }

      // TEXT_MESSAGE_END
      res.write(
        encoder.encode({
          type: EventType.TEXT_MESSAGE_END,
          messageId,
        })
      );

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
