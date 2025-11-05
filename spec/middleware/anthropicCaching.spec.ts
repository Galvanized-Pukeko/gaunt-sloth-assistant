import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GthConfig } from '#src/config.js';
import { AIMessage } from '@langchain/core/messages';

const debugLogMock = vi.fn();
const debugLogObjectMock = vi.fn();
vi.mock('#src/utils/debugUtils.js', () => ({
  debugLog: debugLogMock,
  debugLogObject: debugLogObjectMock,
  debugLogError: vi.fn(),
}));

describe('Anthropic Caching Middleware', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('createAnthropicCachingMiddleware', () => {
    it('should create middleware with default TTL', async () => {
      const { createAnthropicCachingMiddleware } = await import(
        '#src/middleware/anthropicCaching.js'
      );
      const mockConfig = {
        llm: {
          _llmType: () => 'anthropic',
        },
      } as unknown as GthConfig;

      const middleware = createAnthropicCachingMiddleware({}, mockConfig);

      expect(middleware).toBeDefined();
      expect(middleware.beforeModel).toBeDefined();
      expect(debugLogMock).toHaveBeenCalledWith(
        expect.stringContaining('Creating Anthropic caching middleware with TTL: 5m')
      );
    });

    it('should create middleware with custom TTL', async () => {
      const { createAnthropicCachingMiddleware } = await import(
        '#src/middleware/anthropicCaching.js'
      );
      const mockConfig = {
        llm: {
          _llmType: () => 'anthropic',
        },
      } as unknown as GthConfig;

      const middleware = createAnthropicCachingMiddleware({ ttl: '1h' }, mockConfig);

      expect(middleware).toBeDefined();
      expect(debugLogMock).toHaveBeenCalledWith(
        expect.stringContaining('Creating Anthropic caching middleware with TTL: 1h')
      );
    });

    it('should handle non-Anthropic models gracefully', async () => {
      const { createAnthropicCachingMiddleware } = await import(
        '#src/middleware/anthropicCaching.js'
      );
      const mockConfig = {
        llm: {
          _llmType: () => 'openai',
          constructor: { name: 'ChatOpenAI' },
        },
      } as unknown as GthConfig;

      const middleware = createAnthropicCachingMiddleware({}, mockConfig);

      expect(middleware).toBeDefined();
      expect(debugLogMock).toHaveBeenCalledWith(
        expect.stringContaining('Not an Anthropic model, middleware will be no-op')
      );
    });

    it('beforeModel should pass through state for Anthropic models', async () => {
      const { createAnthropicCachingMiddleware } = await import(
        '#src/middleware/anthropicCaching.js'
      );
      const mockConfig = {
        llm: {
          _llmType: () => 'anthropic',
        },
      } as unknown as GthConfig;

      const middleware = createAnthropicCachingMiddleware({}, mockConfig);
      const mockState = {
        messages: [new AIMessage('test')],
      };

      const result = middleware.beforeModel!(mockState as any, {} as any);

      expect(result).toBe(mockState);
      expect(debugLogMock).toHaveBeenCalledWith(
        expect.stringContaining('Processing state before model call')
      );
    });

    it('beforeModel should pass through state for non-Anthropic models', async () => {
      const { createAnthropicCachingMiddleware } = await import(
        '#src/middleware/anthropicCaching.js'
      );
      const mockConfig = {
        llm: {
          _llmType: () => 'openai',
          constructor: { name: 'ChatOpenAI' },
        },
      } as unknown as GthConfig;

      const middleware = createAnthropicCachingMiddleware({}, mockConfig);
      const mockState = {
        messages: [new AIMessage('test')],
      };

      const result = middleware.beforeModel!(mockState as any, {} as any);

      expect(result).toBe(mockState);
    });
  });
});
