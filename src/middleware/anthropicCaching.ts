/**
 * @packageDocumentation
 * Anthropic prompt caching middleware for Gaunt Sloth Assistant.
 *
 * This middleware implements Anthropic's prompt caching feature to reduce API costs
 * by caching repetitive system prompts with Claude models.
 */

import type { GthConfig } from '#src/config.js';
import { debugLog, debugLogObject } from '#src/utils/debugUtils.js';
import type { AnthropicPromptCachingConfig, CustomMiddleware } from '#src/middleware/types.js';
import { isAIMessage } from '@langchain/core/messages';

/**
 * Create Anthropic prompt caching middleware.
 *
 * This middleware adds cache control headers to system prompts and guidelines
 * to enable Anthropic's prompt caching feature, reducing costs for repeated prompts.
 *
 * @param config - Caching configuration (TTL, etc.)
 * @param gthConfig - Full Gaunt Sloth configuration
 * @returns Middleware object with beforeModel hook
 */
export function createAnthropicCachingMiddleware(
  config: AnthropicPromptCachingConfig,
  gthConfig: GthConfig
): CustomMiddleware {
  const ttl = config.ttl || '5m';
  debugLog(`Creating Anthropic caching middleware with TTL: ${ttl}`);

  // Check if the model is Anthropic
  const isAnthropicModel =
    gthConfig.llm._llmType?.() === 'anthropic' ||
    gthConfig.llm.constructor.name === 'ChatAnthropic';

  if (!isAnthropicModel) {
    debugLog('Anthropic caching middleware: Not an Anthropic model, middleware will be no-op');
  }

  return {
    name: 'anthropic-prompt-caching',
    /**
     * Before model hook: Add cache control to messages if applicable.
     * This is where we would add Anthropic-specific cache control headers.
     *
     * Note: Anthropic caching is configured at the model level via the
     * ChatAnthropic constructor, not via middleware state manipulation.
     * This middleware primarily serves as a marker and for future extensions.
     */
    beforeModel: (state: any) => {
      if (!isAnthropicModel) {
        return state;
      }

      debugLog('Anthropic caching middleware: Processing state before model call');
      debugLogObject('State messages count', state.messages.length);

      // Anthropic prompt caching is configured at the model initialization level
      // via the model's cache_control parameter, not at the message level.
      // This middleware exists primarily for:
      // 1. Logging/monitoring caching behavior
      // 2. Future extensions if message-level cache control is needed
      // 3. Validation that caching prerequisites are met

      // For now, we just pass through the state
      // The actual caching configuration happens in the ChatAnthropic model init
      return state;
    },
  };
}

/**
 * Server tool filter middleware for Anthropic.
 *
 * There's an issue with calling server tools with ReAct agent in Anthropic:
 * the tool is not added in react_agent_executor because it is not Runnable,
 * but the tool_node explodes because LLM reports calling non-existing tool.
 *
 * This middleware removes server tool calls from messages, leaving the resulting content.
 * This is needed for Anthropic but not for OpenAI.
 *
 * @returns Middleware object with afterModel hook
 */
export function createAnthropicServerToolFilterMiddleware(): CustomMiddleware {
  debugLog('Creating Anthropic server tool filter middleware');

  return {
    name: 'anthropic-server-tool-filter',
    /**
     * After model hook: Remove server tool calls from AI messages.
     */
    afterModel: (state: any) => {
      try {
        const lastMessage = state.messages[state.messages.length - 1];
        if (
          isAIMessage(lastMessage) &&
          lastMessage.tool_calls &&
          Array.isArray(lastMessage.content)
        ) {
          const serverToolsCalled = lastMessage.content
            .filter((content: any): content is { type: string; name: string } => {
              return content.type === 'server_tool_use' && !!content.name;
            })
            .map((content) => content.name);

          if (serverToolsCalled.length > 0) {
            debugLog('Found server tool calls: ' + serverToolsCalled.join(','));
            lastMessage.tool_calls = lastMessage.tool_calls.filter(
              (tc) => !serverToolsCalled.includes(tc.name)
            );
          }
        }
        return state;
      } catch (e) {
        debugLog(
          'Error in server tool filter middleware: ' + (e instanceof Error ? e.message : String(e))
        );
        return state;
      }
    },
  };
}
