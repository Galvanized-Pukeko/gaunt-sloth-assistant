/**
 * @packageDocumentation
 * Middleware registry for Gaunt Sloth Assistant.
 *
 * This module provides factory functions for creating predefined middleware instances
 * and a resolver to convert middleware configurations into middleware objects.
 */

import type { GthConfig } from '#src/config.js';
import type {
  AnthropicPromptCachingConfig,
  MiddlewareConfig,
  PredefinedMiddlewareConfig,
  SummarizationConfig,
} from '#src/middleware/types.js';
import { displayWarning } from '#src/utils/consoleUtils.js';
import { debugLog } from '#src/utils/debugUtils.js';
import {
  anthropicPromptCachingMiddleware,
  summarizationMiddleware,
  type AgentMiddleware,
} from 'langchain';
import {
  createReviewRateMiddleware,
  type ReviewRateMiddlewareSettings,
} from '#src/middleware/reviewRateMiddleware.js';

type PredefinedMiddlewareFactory = (
  settings: Record<string, unknown>,
  gthConfig: GthConfig
) => Promise<AgentMiddleware>;

const predefinedMiddlewareFactories = {
  'anthropic-prompt-caching': (
    settings: Record<string, unknown>,
    gthConfig: GthConfig
  ): Promise<AgentMiddleware> =>
    createAnthropicPromptCachingMiddleware(settings as AnthropicPromptCachingConfig, gthConfig),
  summarization: (
    settings: Record<string, unknown>,
    gthConfig: GthConfig
  ): Promise<AgentMiddleware> =>
    createSummarizationMiddleware(settings as SummarizationConfig, gthConfig),
  'review-rate': (
    settings: Record<string, unknown>,
    gthConfig: GthConfig
  ): Promise<AgentMiddleware> =>
    createReviewRateMiddleware(settings as ReviewRateMiddlewareSettings, gthConfig),
} satisfies Record<string, PredefinedMiddlewareFactory>;

function isPredefinedMiddlewareName(
  name: string
): name is keyof typeof predefinedMiddlewareFactories {
  return name in predefinedMiddlewareFactories;
}

function isPredefinedMiddlewareObject(
  config: MiddlewareConfig
): config is PredefinedMiddlewareConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    'name' in config &&
    typeof (config as { name: unknown }).name === 'string' &&
    isPredefinedMiddlewareName((config as { name: string }).name)
  );
}

/**
 * Create Anthropic prompt caching middleware.
 * This middleware adds cache control headers to reduce API costs.
 *
 * @param config - Configuration for the middleware
 * @param gthConfig - Full Gaunt Sloth configuration
 * @returns Middleware object
 */
export async function createAnthropicPromptCachingMiddleware(
  config: AnthropicPromptCachingConfig,
  _: GthConfig
): Promise<AgentMiddleware> {
  debugLog(`Creating Anthropic prompt caching middleware with TTL: ${config.ttl || 'default'}`);

  // Dynamic import for async initialization
  return Promise.resolve(anthropicPromptCachingMiddleware({ ttl: config.ttl }));
}

/**
 * Create summarization middleware.
 * This middleware automatically condenses conversation history when approaching token limits.
 *
 * @param config - Configuration for the middleware
 * @param gthConfig - Full Gaunt Sloth configuration
 * @returns Middleware object
 */
export async function createSummarizationMiddleware(
  config: SummarizationConfig,
  gthConfig: GthConfig
): Promise<AgentMiddleware> {
  debugLog('Creating summarization middleware');

  return Promise.resolve(
    summarizationMiddleware({
      model: config.model || gthConfig.llm,
      maxTokensBeforeSummary: config.maxTokensBeforeSummary || 10000,
      messagesToKeep: config.messagesToKeep,
      summaryPrompt: config.summaryPrompt,
    })
  );
}

/**
 * Resolve middleware configuration into middleware instances.
 * Converts string identifiers and config objects into actual middleware.
 *
 * @param configs - Array of middleware configurations
 * @param gthConfig - Full Gaunt Sloth configuration
 * @returns Array of middleware instances
 */
export async function resolveMiddleware(
  configs: MiddlewareConfig[] | undefined,
  gthConfig: GthConfig
): Promise<AgentMiddleware[]> {
  if (!configs || configs.length === 0) {
    return [];
  }

  const middleware: AgentMiddleware[] = [];

  for (const config of configs) {
    try {
      // Handle string configuration (predefined middleware with defaults)
      if (typeof config === 'string') {
        middleware.push(await createPredefinedMiddleware(config, {}, gthConfig));
      }
      // Handle predefined middleware with custom settings
      else if (isPredefinedMiddlewareObject(config)) {
        const { name, ...settings } = config;
        middleware.push(await createPredefinedMiddleware(name, settings, gthConfig));
      }
      // Handle custom middleware object (JS config only)
      else {
        debugLog('Adding custom middleware');
        middleware.push(config as AgentMiddleware);
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
async function createPredefinedMiddleware(
  name: string,
  settings: Record<string, unknown>,
  gthConfig: GthConfig
): Promise<AgentMiddleware> {
  if (!isPredefinedMiddlewareName(name)) {
    throw new Error(`Unknown predefined middleware: ${name}`);
  }

  const factory = predefinedMiddlewareFactories[name];
  return factory(settings, gthConfig);
}
