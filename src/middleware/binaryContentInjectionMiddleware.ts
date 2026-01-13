/**
 * @packageDocumentation
 * Middleware to inject binary content (images, PDFs, audio) as HumanMessage.
 *
 * Tools return binary data as objects, and this middleware:
 * 1. Detects binary content in ToolMessage results
 * 2. Converts ToolMessage content to simple text
 * 3. Injects HumanMessage with binary content blocks before next model call
 *
 * This works around LangChain's limitation where ToolMessage doesn't properly
 * support binary content blocks for most providers.
 */

import { createMiddleware, type AgentMiddleware } from 'langchain';
import type { GthConfig } from '#src/config.js';
import { debugLog } from '#src/utils/debugUtils.js';
import { ToolMessage, HumanMessage } from '@langchain/core/messages';
import type { MessageContent } from '@langchain/core/messages';
import type { BinaryContentData } from '#src/types/binaryContent.js';

export interface BinaryContentInjectionMiddlewareSettings {
  name?: 'binary-content-injection';
}

function isBinaryContentData(content: unknown): content is BinaryContentData {
  return (
    typeof content === 'object' &&
    content !== null &&
    '__binaryContent' in content &&
    content.__binaryContent === true
  );
}

function createContentBlock(binaryData: BinaryContentData): Record<string, unknown> {
  const { formatType, media_type, data } = binaryData;

  // For images, use OpenAI image_url format (works with OpenRouter and most providers)
  // LangChain will convert this to provider-specific format as needed
  if (formatType === 'image') {
    return {
      type: 'image_url',
      image_url: {
        url: `data:${media_type};base64,${data}`,
      },
    };
  }

  // For audio and files, use Anthropic format
  // (these are less commonly supported across providers)
  if (formatType === 'audio') {
    return {
      type: 'audio',
      source: {
        type: 'base64',
        media_type,
        data,
      },
    };
  }

  // PDF and other files
  return {
    type: 'file',
    source: {
      type: 'base64',
      media_type,
      data,
    },
  };
}

function getFormatLabel(formatType: string): string {
  const labels: Record<string, string> = {
    image: 'image',
    audio: 'audio',
    file: 'file',
    binary: 'binary file',
  };
  return labels[formatType] || 'file';
}

export function createBinaryContentInjectionMiddleware(
  _settings: BinaryContentInjectionMiddlewareSettings,
  _gthConfig: GthConfig
): Promise<AgentMiddleware> {
  debugLog('Creating binary content injection middleware');

  return Promise.resolve(
    createMiddleware({
      name: 'binary-content-injection',

      // Step 1: Transform ToolMessage content from binary data object to simple text
      wrapToolCall: async (request, handler) => {
        const result = await handler(request);

        if (!(result instanceof ToolMessage)) {
          return result;
        }

        // Parse content if it's a JSON string
        let content = result.content;
        if (typeof content === 'string' && content.trim().startsWith('{')) {
          try {
            content = JSON.parse(content);
          } catch (_) {
            // Not JSON, proceed with original string
          }
        }

        // Check if this is binary content
        if (isBinaryContentData(content)) {
          const binaryData = content;
          const formatLabel = getFormatLabel(binaryData.formatType);

          debugLog(
            `Binary content detected in tool result: ${formatLabel} from ${binaryData.path}`
          );

          // Convert to simple text and store binary data in artifact
          return new ToolMessage({
            content: `Successfully read ${formatLabel} from ${binaryData.path} (${Math.round(binaryData.size / 1024)}KB)`,
            tool_call_id: result.tool_call_id,
            name: result.name,
            // Store binary data in artifact so beforeModel can access it
            artifact: binaryData,
            status: result.status || 'success',
          });
        }

        return result;
      },

      // Step 2: Before next model call, inject HumanMessage with binary content
      beforeModel: async (state) => {
        const messages = state.messages || [];

        // Find recent ToolMessages with binary artifacts
        const binaryMessages: Array<{ message: ToolMessage; binaryData: BinaryContentData }> = [];

        // Check last few messages (usually just need to check the most recent)
        for (let i = messages.length - 1; i >= Math.max(0, messages.length - 5); i--) {
          const msg = messages[i];
          if (msg instanceof ToolMessage && isBinaryContentData(msg.artifact)) {
            binaryMessages.push({ message: msg, binaryData: msg.artifact });
          }
        }

        // If we found binary content, inject HumanMessage(s)
        if (binaryMessages.length > 0) {
          debugLog(`Injecting ${binaryMessages.length} HumanMessage(s) with binary content`);

          const newMessages = [...messages];

          for (const { binaryData } of binaryMessages) {
            const formatLabel = getFormatLabel(binaryData.formatType);
            const contentBlock = createContentBlock(binaryData);

            const humanMessage = new HumanMessage({
              content: [
                {
                  type: 'text',
                  text: `Here is the ${formatLabel} content from the file:`,
                },
                contentBlock,
              ] as MessageContent,
            });

            newMessages.push(humanMessage);
          }

          // Return the modified state with new messages
          return {
            messages: newMessages,
          };
        }

        // No binary content, pass through
        return undefined;
      },
    })
  );
}
