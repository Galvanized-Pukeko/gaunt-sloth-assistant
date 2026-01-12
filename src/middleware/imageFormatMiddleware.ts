/**
 * @packageDocumentation
 * Middleware to transform image content blocks from LangChain universal format to Anthropic format.
 *
 * Tools return images in LangChain universal format (works with most providers):
 * { type: 'image', source_type: 'base64', media_type: '...', data: '...' }
 *
 * This middleware transforms them to Anthropic format when needed:
 * { type: 'image', source: { type: 'base64', media_type: '...', data: '...' } }
 */

import { createMiddleware, type AgentMiddleware } from 'langchain';
import type { GthConfig } from '#src/config.js';
import { debugLog } from '#src/utils/debugUtils.js';
import { ToolMessage } from '@langchain/core/messages';

export interface ImageFormatMiddlewareSettings {
  name?: 'image-format-transform';
  /**
   * Detail level for image processing: 'low', 'high', or 'auto'
   * Default: 'high'
   */
  detail?: 'low' | 'high' | 'auto';
}

interface LangChainImageBlock {
  type: 'image';
  source_type: 'base64';
  media_type: string;
  data: string;
}

interface AnthropicImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

function isLangChainImageBlock(block: unknown): block is LangChainImageBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    'type' in block &&
    block.type === 'image' &&
    'source_type' in block &&
    block.source_type === 'base64' &&
    'media_type' in block &&
    typeof block.media_type === 'string' &&
    'data' in block &&
    typeof block.data === 'string'
  );
}

function transformImageBlock(block: LangChainImageBlock): AnthropicImageBlock {
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: block.media_type,
      data: block.data,
    },
  };
}

function transformToolResult(result: unknown): unknown {
  // If result is an array, transform each element
  if (Array.isArray(result)) {
    return result.map((item) => {
      if (isLangChainImageBlock(item)) {
        return transformImageBlock(item);
      }
      return item;
    });
  }

  // If result is a single image block, transform it
  if (isLangChainImageBlock(result)) {
    return transformImageBlock(result);
  }

  // Return unchanged if not an image block
  return result;
}

/**
 * Detect if the model is Anthropic by checking the model type from config
 */
function isAnthropicModel(config: GthConfig): boolean {
  const llmConfig = config.llm as { type?: string };
  const modelType = llmConfig?.type?.toLowerCase() || '';

  return modelType === 'anthropic';
}

export function createImageFormatMiddleware(
  settings: ImageFormatMiddlewareSettings,
  gthConfig: GthConfig
): Promise<AgentMiddleware> {
  const shouldTransform = isAnthropicModel(gthConfig);

  debugLog(
    `Creating image format middleware: ${shouldTransform ? 'will transform' : 'passthrough'} (model type: ${(gthConfig.llm as { type?: string })?.type})`
  );

  if (!shouldTransform) {
    // For OpenAI, OpenRouter, and other models, no transformation needed
    debugLog('Image format middleware: passthrough mode (LangChain universal format)');
    return Promise.resolve(
      createMiddleware({
        name: 'image-format-transform',
        // No-op middleware
      })
    );
  }

  // For Anthropic models, transform LangChain universal format to Anthropic nested format
  return Promise.resolve(
    createMiddleware({
      name: 'image-format-transform',
      wrapToolCall: async (request, handler) => {
        // Execute the tool call to get the ToolMessage or Command
        const result = await handler(request);

        // Only transform ToolMessages (not Commands)
        if (!(result instanceof ToolMessage)) {
          return result;
        }

        // Transform the content if it contains image blocks
        const transformedContent = transformToolResult(result.content);

        if (result.content !== transformedContent) {
          debugLog(
            'Image format middleware: transformed LangChain universal format → Anthropic format'
          );
        }

        // Return a new ToolMessage with transformed content

        return new ToolMessage({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          content: transformedContent as any,
          tool_call_id: result.tool_call_id,
          name: result.name,
          artifact: result.artifact,
          status: result.status,
        });
      },
    })
  );
}
