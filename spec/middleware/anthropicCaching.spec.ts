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

  describe('createAnthropicServerToolFilterMiddleware', () => {
    it('should create server tool filter middleware', async () => {
      const { createAnthropicServerToolFilterMiddleware } = await import(
        '#src/middleware/anthropicCaching.js'
      );

      const middleware = createAnthropicServerToolFilterMiddleware();

      expect(middleware).toBeDefined();
      expect(middleware.afterModel).toBeDefined();
      expect(debugLogMock).toHaveBeenCalledWith(
        expect.stringContaining('Creating Anthropic server tool filter middleware')
      );
    });

    it('should filter out server tool calls from AI messages', async () => {
      const { createAnthropicServerToolFilterMiddleware } = await import(
        '#src/middleware/anthropicCaching.js'
      );

      const middleware = createAnthropicServerToolFilterMiddleware();

      const aiMessage = new AIMessage({
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'server_tool_use', name: 'web_search' },
        ],
        tool_calls: [
          { name: 'web_search', args: {}, id: '1', type: 'tool_call' },
          { name: 'regular_tool', args: {}, id: '2', type: 'tool_call' },
        ],
      });

      const mockState = {
        messages: [aiMessage],
      };

      const result = middleware.afterModel!(mockState as any, {} as any);

      expect(result).toBe(mockState);
      expect(aiMessage.tool_calls).toHaveLength(1);
      expect(aiMessage.tool_calls![0].name).toBe('regular_tool');
      expect(debugLogMock).toHaveBeenCalledWith(
        expect.stringContaining('Found server tool calls: web_search')
      );
    });

    it('should handle messages without server tools', async () => {
      const { createAnthropicServerToolFilterMiddleware } = await import(
        '#src/middleware/anthropicCaching.js'
      );

      const middleware = createAnthropicServerToolFilterMiddleware();

      const aiMessage = new AIMessage({
        content: 'Just text',
        tool_calls: [{ name: 'regular_tool', args: {}, id: '1', type: 'tool_call' }],
      });

      const mockState = {
        messages: [aiMessage],
      };

      const result = middleware.afterModel!(mockState as any, {} as any);

      expect(result).toBe(mockState);
      expect(aiMessage.tool_calls).toHaveLength(1);
    });

    it('should handle errors gracefully', async () => {
      const { createAnthropicServerToolFilterMiddleware } = await import(
        '#src/middleware/anthropicCaching.js'
      );

      const middleware = createAnthropicServerToolFilterMiddleware();

      // Create a state that will cause an error
      const mockState = {
        messages: [],
      };

      const result = middleware.afterModel!(mockState as any, {} as any);

      // Should return the original state even with error
      expect(result).toBe(mockState);
    });
  });
});
