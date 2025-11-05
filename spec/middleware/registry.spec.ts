import type { GthConfig } from '#src/config.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const displayDebugMock = vi.fn();
const displayWarningMock = vi.fn();
vi.mock('#src/utils/consoleUtils.js', () => ({
  displayDebug: displayDebugMock,
  displayWarning: displayWarningMock,
}));

const debugLogMock = vi.fn();
vi.mock('#src/utils/debugUtils.js', () => ({
  debugLog: debugLogMock,
  debugLogObject: vi.fn(),
  debugLogError: vi.fn(),
}));

const summarizationMiddlewareMock = vi.fn();
const anthropicPromptCachingMiddlewareMock = vi.fn();
vi.mock('langchain', () => ({
  summarizationMiddleware: summarizationMiddlewareMock,
  anthropicPromptCachingMiddleware: anthropicPromptCachingMiddlewareMock,
}));

describe('Middleware Registry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('resolveMiddleware', () => {
    it('should return empty array when no middleware configured', async () => {
      const { resolveMiddleware } = await import('#src/middleware/registry.js');
      const mockConfig = { llm: {} } as GthConfig;

      const result = await resolveMiddleware(undefined, mockConfig);

      expect(result).toEqual([]);
    });

    it('should resolve string middleware name with defaults', async () => {
      const { resolveMiddleware } = await import('#src/middleware/registry.js');
      const mockConfig = { llm: {} } as GthConfig;
      const mockMiddleware = { beforeModel: vi.fn() };
      summarizationMiddlewareMock.mockReturnValue(mockMiddleware);

      const result = await resolveMiddleware(['summarization'], mockConfig);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(mockMiddleware);
      expect(summarizationMiddlewareMock).toHaveBeenCalledWith({
        model: mockConfig.llm,
        maxTokensBeforeSummary: 10000, // Default value is now 10000
        messagesToKeep: undefined,
        summaryPrompt: undefined,
      });
    });

    it('should resolve predefined middleware with custom settings', async () => {
      const { resolveMiddleware } = await import('#src/middleware/registry.js');
      const mockConfig = { llm: {} } as GthConfig;
      const mockMiddleware = { beforeModel: vi.fn() };
      summarizationMiddlewareMock.mockReturnValue(mockMiddleware);

      const result = await resolveMiddleware(
        [{ name: 'summarization', maxTokensBeforeSummary: 5000, messagesToKeep: 10 }],
        mockConfig
      );

      expect(result).toHaveLength(1);
      expect(summarizationMiddlewareMock).toHaveBeenCalledWith({
        model: mockConfig.llm,
        maxTokensBeforeSummary: 5000,
        messagesToKeep: 10,
        summaryPrompt: undefined,
      });
    });

    it('should handle custom middleware objects', async () => {
      const { resolveMiddleware } = await import('#src/middleware/registry.js');
      const mockConfig = { llm: {} } as GthConfig;
      const customMiddleware = {
        name: 'custom-middleware',
        beforeModel: vi.fn(),
        afterModel: vi.fn(),
      };

      const result = await resolveMiddleware([customMiddleware], mockConfig);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(customMiddleware);
    });

    it('should handle multiple middleware configurations', async () => {
      const { resolveMiddleware } = await import('#src/middleware/registry.js');
      const mockConfig = { llm: {} } as GthConfig;
      const mockSummarizationMiddleware = { beforeModel: vi.fn() };
      const mockAnthropicPromptCachingMiddleware = { beforeModel: vi.fn() };
      const customMiddleware = { name: 'custom', afterModel: vi.fn() };

      summarizationMiddlewareMock.mockReturnValue(mockSummarizationMiddleware);
      anthropicPromptCachingMiddlewareMock.mockReturnValue(mockAnthropicPromptCachingMiddleware);

      const result = await resolveMiddleware(
        ['summarization', { name: 'anthropic-prompt-caching' }, customMiddleware],
        mockConfig
      );

      expect(result).toHaveLength(3);
      expect(result[0]).toBe(mockSummarizationMiddleware);
      expect(result[1]).toBe(mockAnthropicPromptCachingMiddleware);
      expect(result[2]).toBe(customMiddleware);
    });

    it('should warn on unknown predefined middleware', async () => {
      const { resolveMiddleware } = await import('#src/middleware/registry.js');
      const mockConfig = { llm: {} } as GthConfig;

      const result = await resolveMiddleware(['unknown-middleware'], mockConfig);

      expect(result).toHaveLength(0);
      expect(displayWarningMock).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create middleware')
      );
    });
  });

  describe('createAnthropicPromptCachingMiddleware', () => {
    it('should create Anthropic caching middleware with default TTL', async () => {
      const { createAnthropicPromptCachingMiddleware } = await import(
        '#src/middleware/registry.js'
      );
      const mockConfig = { llm: {} } as GthConfig;
      const mockMiddleware = { beforeModel: vi.fn() };
      anthropicPromptCachingMiddlewareMock.mockReturnValue(mockMiddleware);

      const result = await createAnthropicPromptCachingMiddleware({}, mockConfig);

      expect(result).toBe(mockMiddleware);
      expect(anthropicPromptCachingMiddlewareMock).toHaveBeenCalledWith({ ttl: undefined });
    });

    it('should create Anthropic caching middleware with custom TTL', async () => {
      const { createAnthropicPromptCachingMiddleware } = await import(
        '#src/middleware/registry.js'
      );
      const mockConfig = { llm: {} } as GthConfig;
      const mockMiddleware = { beforeModel: vi.fn() };
      anthropicPromptCachingMiddlewareMock.mockReturnValue(mockMiddleware);

      const result = await createAnthropicPromptCachingMiddleware({ ttl: '1h' }, mockConfig);

      expect(result).toBe(mockMiddleware);
      expect(anthropicPromptCachingMiddlewareMock).toHaveBeenCalledWith({ ttl: '1h' });
    });
  });

  describe('createSummarizationMiddleware', () => {
    it('should create summarization middleware with config model', async () => {
      const { createSummarizationMiddleware } = await import('#src/middleware/registry.js');
      const mockConfig = { llm: { model: 'test-model' } } as unknown as GthConfig;
      const mockMiddleware = { beforeModel: vi.fn() };
      summarizationMiddlewareMock.mockReturnValue(mockMiddleware);

      const result = await createSummarizationMiddleware({}, mockConfig);

      expect(result).toBe(mockMiddleware);
      expect(summarizationMiddlewareMock).toHaveBeenCalledWith({
        model: mockConfig.llm,
        maxTokensBeforeSummary: 10000,
        messagesToKeep: undefined,
        summaryPrompt: undefined,
      });
    });

    it('should create summarization middleware with custom settings', async () => {
      const { createSummarizationMiddleware } = await import('#src/middleware/registry.js');
      const mockConfig = { llm: { model: 'test-model' } } as unknown as GthConfig;
      const mockMiddleware = { beforeModel: vi.fn() };
      summarizationMiddlewareMock.mockReturnValue(mockMiddleware);

      const result = await createSummarizationMiddleware(
        {
          maxTokensBeforeSummary: 6000,
          messagesToKeep: 5,
          summaryPrompt: 'Custom prompt',
        },
        mockConfig
      );

      expect(result).toBe(mockMiddleware);
      expect(summarizationMiddlewareMock).toHaveBeenCalledWith({
        model: mockConfig.llm,
        maxTokensBeforeSummary: 6000,
        messagesToKeep: 5,
        summaryPrompt: 'Custom prompt',
      });
    });
  });
});
