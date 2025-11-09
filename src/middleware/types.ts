/**
 * @packageDocumentation
 * Type definitions for middleware configuration in Gaunt Sloth Assistant.
 *
 * Middleware provides hooks to intercept and control agent execution at critical points.
 * This module defines the configuration interfaces for both predefined and custom middleware.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { RatingConfig } from '#src/config.js';
import { AgentMiddleware } from 'langchain';

/**
 * Predefined middleware types that can be configured via JSON config.
 */
export type PredefinedMiddlewareName = 'anthropic-prompt-caching' | 'summarization' | 'review-rate';

/**
 * Configuration for Anthropic prompt caching middleware.
 */
export interface AnthropicPromptCachingConfig {
  /**
   * Cache TTL (time to live).
   * Examples: "5m" for 5 minutes, "1h" for 1 hour
   */
  ttl?: '5m' | '1h';
}

/**
 * Configuration for summarization middleware.
 */
export interface SummarizationConfig {
  /**
   * Model to use for summarization.
   * If not provided, uses the main LLM from config.
   */
  model?: BaseChatModel;
  /**
   * Maximum tokens before triggering summarization.
   * This parameter is not required, but without it summarization will not happen.
   * Gaunt Sloth default value is 10000.
   */
  maxTokensBeforeSummary?: number;
  /**
   * Number of recent messages to keep after summarization.
   */
  messagesToKeep?: number;
  /**
   * Custom prompt template for summarization.
   */
  summaryPrompt?: string;
}

/**
 * Union type of all predefined middleware configurations.
 */
export type PredefinedMiddlewareConfig =
  | ({ name: 'anthropic-prompt-caching' } & AnthropicPromptCachingConfig)
  | ({ name: 'summarization' } & SummarizationConfig)
  | ({ name: 'review-rate' } & RatingConfig);

/**
 * Middleware configuration that can be specified in JSON or JS config.
 * - String: Name of predefined middleware with default settings
 * - PredefinedMiddlewareConfig: Predefined middleware with custom settings (JSON compatible)
 * - CustomMiddleware: Custom middleware object (JS config only)
 */
export type MiddlewareConfig = string | PredefinedMiddlewareConfig | AgentMiddleware;
