/**
 * @packageDocumentation
 * Type definitions for middleware configuration in Gaunt Sloth Assistant.
 *
 * Middleware provides hooks to intercept and control agent execution at critical points.
 * This module defines the configuration interfaces for both predefined and custom middleware.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AIMessage } from '@langchain/core/messages';
import type { BinaryOperatorAggregate, Messages, StateType } from '@langchain/langgraph';

/**
 * Predefined middleware types that can be configured via JSON config.
 */
export type PredefinedMiddlewareName =
  | 'anthropic-prompt-caching'
  | 'summarization'
  | 'human-in-loop'
  | 'model-limiter'
  | 'tool-limiter'
  | 'model-fallback'
  | 'pii-detection'
  | 'planning';

/**
 * Configuration for Anthropic prompt caching middleware.
 */
export interface AnthropicPromptCachingConfig {
  /**
   * Cache TTL (time to live).
   * Examples: "5m" for 5 minutes, "1h" for 1 hour
   */
  ttl?: string;
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
   * Default: ~4000
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
 * Configuration for human-in-the-loop middleware.
 */
export interface HumanInLoopConfig {
  /**
   * Map tool names to approval settings.
   */
  interruptOn?: Record<
    string,
    {
      allowAccept?: boolean;
      allowEdit?: boolean;
      allowRespond?: boolean;
    }
  >;
}

/**
 * Configuration for model call limiter middleware.
 */
export interface ModelLimiterConfig {
  /**
   * Maximum number of model calls per thread or run.
   */
  maxCalls?: number;
  /**
   * Action on limit exceeded: "end" or "error"
   */
  onLimitExceeded?: 'end' | 'error';
}

/**
 * Configuration for tool call limiter middleware.
 */
export interface ToolLimiterConfig {
  /**
   * Maximum tool calls (overall or per-tool).
   */
  maxCalls?: number;
  /**
   * Specific tool limits.
   */
  toolLimits?: Record<string, number>;
  /**
   * Action on limit exceeded: "end" or "error"
   */
  onLimitExceeded?: 'end' | 'error';
}

/**
 * Configuration for model fallback middleware.
 */
export interface ModelFallbackConfig {
  /**
   * Fallback models to try in order.
   */
  fallbackModels: string[];
}

/**
 * Configuration for PII detection middleware.
 */
export interface PiiDetectionConfig {
  /**
   * Detection strategy: "redact", "mask", "hash", or "block"
   */
  strategy?: 'redact' | 'mask' | 'hash' | 'block';
  /**
   * Custom regex patterns for detection.
   */
  customPatterns?: RegExp[];
}

/**
 * Configuration for planning middleware (todo list management).
 */
export interface PlanningConfig {
  /**
   * Enable automatic todo list management.
   */
  enabled?: boolean;
}

/**
 * Union type of all predefined middleware configurations.
 */
export type PredefinedMiddlewareConfig =
  | ({ name: 'anthropic-prompt-caching' } & AnthropicPromptCachingConfig)
  | ({ name: 'summarization' } & SummarizationConfig)
  | ({ name: 'human-in-loop' } & HumanInLoopConfig)
  | ({ name: 'model-limiter' } & ModelLimiterConfig)
  | ({ name: 'tool-limiter' } & ToolLimiterConfig)
  | ({ name: 'model-fallback' } & ModelFallbackConfig)
  | ({ name: 'pii-detection' } & PiiDetectionConfig)
  | ({ name: 'planning' } & PlanningConfig);

/**
 * LangGraph middleware interface.
 * Custom middleware must conform to this structure.
 */
export interface CustomMiddleware {
  /**
   * Middleware name (required by LangChain).
   */
  name: string;

  /**
   * Hook called before agent initialization.
   */
  beforeAgent?: (state: any, runtime: any) => any;

  /**
   * Hook called before model invocation.
   */
  beforeModel?: (state: any, runtime: any) => any;

  /**
   * Hook called after model response.
   */
  afterModel?: (state: any, runtime: any) => any;

  /**
   * Hook called after agent completion.
   */
  afterAgent?: (state: any, runtime: any) => any;

  /**
   * Wrap-style hook for model calls (full control).
   */
  wrapModelCall?: (handler: () => Promise<unknown>) => Promise<unknown>;

  /**
   * Wrap-style hook for tool calls (full control).
   */
  wrapToolCall?: (handler: () => Promise<unknown>) => Promise<unknown>;
}

/**
 * Middleware configuration that can be specified in JSON or JS config.
 * - String: Name of predefined middleware with default settings
 * - PredefinedMiddlewareConfig: Predefined middleware with custom settings (JSON compatible)
 * - CustomMiddleware: Custom middleware object (JS config only)
 */
export type MiddlewareConfig = string | PredefinedMiddlewareConfig | CustomMiddleware;
