/**
 * @packageDocumentation
 * Middleware registry for Gaunt Sloth Assistant.
 *
 * This module provides factory functions for creating predefined middleware instances
 * and a resolver to convert middleware configurations into middleware objects.
 */

import type { GthConfig } from '#src/config.js';
import { displayDebug, displayWarning } from '#src/utils/consoleUtils.js';
import { debugLog } from '#src/utils/debugUtils.js';
import type {
  AnthropicPromptCachingConfig,
  CustomMiddleware,
  HumanInLoopConfig,
  MiddlewareConfig,
  ModelFallbackConfig,
  ModelLimiterConfig,
  PiiDetectionConfig,
  PlanningConfig,
  PredefinedMiddlewareConfig,
  SummarizationConfig,
  ToolLimiterConfig,
} from '#src/middleware/types.js';
import {
  humanInTheLoopMiddleware,
  summarizationMiddleware,
  // modelCallLimitMiddleware,
  // toolCallLimitMiddleware,
  // modelFallbackMiddleware,
  // piiDetectionMiddleware,
  // planningMiddleware,
} from 'langchain';

/**
 * Create Anthropic prompt caching middleware.
 * This middleware adds cache control headers to reduce API costs.
 *
 * @param config - Configuration for the middleware
 * @param gthConfig - Full Gaunt Sloth configuration
 * @returns Middleware object
 */
export function createAnthropicPromptCachingMiddleware(
  config: AnthropicPromptCachingConfig,
  gthConfig: GthConfig
): CustomMiddleware {
  debugLog(`Creating Anthropic prompt caching middleware with TTL: ${config.ttl || 'default'}`);

  // This will be implemented in anthropicCaching.ts
  // For now, return a placeholder that will be replaced
  const { createAnthropicCachingMiddleware } = require('#src/middleware/anthropicCaching.js');
  return createAnthropicCachingMiddleware(config, gthConfig);
}

/**
 * Create summarization middleware.
 * This middleware automatically condenses conversation history when approaching token limits.
 *
 * @param config - Configuration for the middleware
 * @param gthConfig - Full Gaunt Sloth configuration
 * @returns Middleware object
 */
export function createSummarizationMiddleware(
  config: SummarizationConfig,
  gthConfig: GthConfig
): any {
  debugLog('Creating summarization middleware');

  return summarizationMiddleware({
    model: config.model || gthConfig.llm,
    maxTokensBeforeSummary: config.maxTokensBeforeSummary,
    messagesToKeep: config.messagesToKeep,
    summaryPrompt: config.summaryPrompt,
  });
}

/**
 * Create human-in-the-loop middleware.
 * This middleware pauses execution for human approval before sensitive tool calls.
 *
 * @param config - Configuration for the middleware
 * @param _gthConfig - Full Gaunt Sloth configuration (unused)
 * @returns Middleware object
 */
export function createHumanInLoopMiddleware(config: HumanInLoopConfig, _gthConfig: GthConfig): any {
  debugLog('Creating human-in-the-loop middleware');

  return humanInTheLoopMiddleware({
    interruptOn: (config.interruptOn as any) || {},
  });
}

/**
 * Create model call limiter middleware.
 * This middleware enforces maximum model invocations per thread or run.
 *
 * @param config - Configuration for the middleware
 * @param _gthConfig - Full Gaunt Sloth configuration (unused)
 * @returns Middleware object
 */
export function createModelLimiterMiddleware(
  config: ModelLimiterConfig,
  _gthConfig: GthConfig
): CustomMiddleware {
  debugLog(`Creating model limiter middleware with max calls: ${config.maxCalls || 'unlimited'}`);

  displayWarning(
    'Model limiter middleware is not yet available in LangChain. This middleware will be skipped.'
  );

  // TODO: Implement when available in LangChain
  // return modelCallLimitMiddleware({
  //   maxCalls: config.maxCalls,
  //   onLimitExceeded: config.onLimitExceeded,
  // });

  return { name: 'model-limiter-placeholder' };
}

/**
 * Create tool call limiter middleware.
 * This middleware restricts specific tool usage or all tools collectively.
 *
 * @param config - Configuration for the middleware
 * @param _gthConfig - Full Gaunt Sloth configuration (unused)
 * @returns Middleware object
 */
export function createToolLimiterMiddleware(
  config: ToolLimiterConfig,
  _gthConfig: GthConfig
): CustomMiddleware {
  debugLog(`Creating tool limiter middleware with max calls: ${config.maxCalls || 'unlimited'}`);

  displayWarning(
    'Tool limiter middleware is not yet available in LangChain. This middleware will be skipped.'
  );

  // TODO: Implement when available in LangChain
  // return toolCallLimitMiddleware({
  //   maxCalls: config.maxCalls,
  //   toolLimits: config.toolLimits,
  //   onLimitExceeded: config.onLimitExceeded,
  // });

  return { name: 'tool-limiter-placeholder' };
}

/**
 * Create model fallback middleware.
 * This middleware automatically switches to alternative models when primary ones fail.
 *
 * @param config - Configuration for the middleware
 * @param _gthConfig - Full Gaunt Sloth configuration (unused)
 * @returns Middleware object
 */
export function createModelFallbackMiddleware(
  config: ModelFallbackConfig,
  _gthConfig: GthConfig
): CustomMiddleware {
  debugLog(
    `Creating model fallback middleware with fallbacks: ${config.fallbackModels.join(', ')}`
  );

  displayWarning(
    'Model fallback middleware is not yet available in LangChain. This middleware will be skipped.'
  );

  // TODO: Implement when available in LangChain
  // return modelFallbackMiddleware(...config.fallbackModels);

  return { name: 'model-fallback-placeholder' };
}

/**
 * Create PII detection middleware.
 * This middleware identifies sensitive information with various strategies.
 *
 * @param config - Configuration for the middleware
 * @param _gthConfig - Full Gaunt Sloth configuration (unused)
 * @returns Middleware object
 */
export function createPiiDetectionMiddleware(
  config: PiiDetectionConfig,
  _gthConfig: GthConfig
): CustomMiddleware {
  debugLog(`Creating PII detection middleware with strategy: ${config.strategy || 'redact'}`);

  displayWarning(
    'PII detection middleware is not yet available in LangChain. This middleware will be skipped.'
  );

  // TODO: Implement when available in LangChain
  // return piiDetectionMiddleware({
  //   strategy: config.strategy,
  //   customPatterns: config.customPatterns,
  // });

  return { name: 'pii-detection-placeholder' };
}

/**
 * Create planning middleware.
 * This middleware adds todo list management via automatic write_todos tool.
 *
 * @param config - Configuration for the middleware
 * @param _gthConfig - Full Gaunt Sloth configuration (unused)
 * @returns Middleware object
 */
export function createPlanningMiddleware(
  config: PlanningConfig,
  _gthConfig: GthConfig
): CustomMiddleware {
  debugLog(`Creating planning middleware: ${config.enabled ? 'enabled' : 'disabled'}`);

  displayWarning(
    'Planning middleware is not yet available in LangChain. This middleware will be skipped.'
  );

  // TODO: Implement when available in LangChain
  // return planningMiddleware({
  //   enabled: config.enabled,
  // });

  return { name: 'planning-placeholder' };
}

/**
 * Resolve middleware configuration into middleware instances.
 * Converts string identifiers and config objects into actual middleware.
 *
 * @param configs - Array of middleware configurations
 * @param gthConfig - Full Gaunt Sloth configuration
 * @returns Array of middleware instances
 */
export function resolveMiddleware(
  configs: MiddlewareConfig[] | undefined,
  gthConfig: GthConfig
): any[] {
  if (!configs || configs.length === 0) {
    return [];
  }

  const middleware: any[] = [];

  for (const config of configs) {
    try {
      // Handle string configuration (predefined middleware with defaults)
      if (typeof config === 'string') {
        middleware.push(createPredefinedMiddleware(config, {}, gthConfig));
      }
      // Handle predefined middleware with custom settings
      else if (typeof config === 'object' && 'name' in config) {
        const { name, ...settings } = config as PredefinedMiddlewareConfig;
        middleware.push(createPredefinedMiddleware(name, settings, gthConfig));
      }
      // Handle custom middleware object (JS config only)
      else {
        debugLog('Adding custom middleware');
        middleware.push(config as CustomMiddleware);
      }
    } catch (error) {
      displayWarning(
        `Failed to create middleware: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return middleware;
}

/**
 * Create a predefined middleware instance by name.
 *
 * @param name - Name of the predefined middleware
 * @param settings - Configuration settings for the middleware
 * @param gthConfig - Full Gaunt Sloth configuration
 * @returns Middleware instance
 */
function createPredefinedMiddleware(
  name: string,
  settings: Record<string, unknown>,
  gthConfig: GthConfig
): CustomMiddleware {
  switch (name) {
    case 'anthropic-prompt-caching':
      return createAnthropicPromptCachingMiddleware(
        settings as AnthropicPromptCachingConfig,
        gthConfig
      );

    case 'summarization':
      return createSummarizationMiddleware(settings as SummarizationConfig, gthConfig);

    case 'human-in-loop':
      return createHumanInLoopMiddleware(settings as HumanInLoopConfig, gthConfig);

    case 'model-limiter':
      return createModelLimiterMiddleware(settings as ModelLimiterConfig, gthConfig);

    case 'tool-limiter':
      return createToolLimiterMiddleware(settings as ToolLimiterConfig, gthConfig);

    case 'model-fallback':
      // Validate that fallbackModels exists
      if (!('fallbackModels' in settings) || !Array.isArray((settings as any).fallbackModels)) {
        throw new Error('model-fallback middleware requires "fallbackModels" array');
      }
      return createModelFallbackMiddleware(settings as unknown as ModelFallbackConfig, gthConfig);

    case 'pii-detection':
      return createPiiDetectionMiddleware(settings as PiiDetectionConfig, gthConfig);

    case 'planning':
      return createPlanningMiddleware(settings as PlanningConfig, gthConfig);

    default:
      throw new Error(`Unknown predefined middleware: ${name}`);
  }
}
