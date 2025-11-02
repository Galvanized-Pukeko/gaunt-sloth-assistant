import { GthConfig } from '#src/config.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const consoleUtilsMock = {
  displayInfo: vi.fn(),
  displayWarning: vi.fn(),
};
vi.mock('#src/utils/consoleUtils.js', () => consoleUtilsMock);

const debugUtilsMock = {
  debugLog: vi.fn(),
};
vi.mock('#src/utils/debugUtils.js', () => debugUtilsMock);

const createAnthropicServerToolFilterMiddlewareMock = vi.fn();
vi.mock('#src/middleware/anthropicCaching.js', () => ({
  createAnthropicServerToolFilterMiddleware: createAnthropicServerToolFilterMiddlewareMock,
}));

describe('anthropic preset', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('postProcessJsonConfig', () => {
    it('should add server tool filter middleware', async () => {
      const { postProcessJsonConfig } = await import('#src/presets/anthropic.js');
      const mockMiddleware = { afterModel: vi.fn() };
      createAnthropicServerToolFilterMiddlewareMock.mockReturnValue(mockMiddleware);

      const config = { middleware: [] } as Partial<GthConfig>;
      const result = postProcessJsonConfig(config as GthConfig);

      expect(result.middleware).toHaveLength(1);
      expect(result.middleware![0]).toBe(mockMiddleware);
      expect(consoleUtilsMock.displayInfo).toHaveBeenCalledWith(
        'Applying Anthropic post-processing to config.'
      );
    });

    it('should add middleware when middleware array is not defined', async () => {
      const { postProcessJsonConfig } = await import('#src/presets/anthropic.js');
      const mockMiddleware = { afterModel: vi.fn() };
      createAnthropicServerToolFilterMiddlewareMock.mockReturnValue(mockMiddleware);

      const config = {} as Partial<GthConfig>;
      const result = postProcessJsonConfig(config as GthConfig);

      expect(result.middleware).toHaveLength(1);
      expect(result.middleware![0]).toBe(mockMiddleware);
    });

    it('should append to existing middleware', async () => {
      const { postProcessJsonConfig } = await import('#src/presets/anthropic.js');
      const existingMiddleware = { name: 'existing', beforeModel: vi.fn() };
      const mockMiddleware = { afterModel: vi.fn() };
      createAnthropicServerToolFilterMiddlewareMock.mockReturnValue(mockMiddleware);

      const config = { middleware: [existingMiddleware] } as Partial<GthConfig>;
      const result = postProcessJsonConfig(config as GthConfig);

      expect(result.middleware).toHaveLength(2);
      expect(result.middleware![0]).toBe(existingMiddleware);
      expect(result.middleware![1]).toBe(mockMiddleware);
    });
  });
});
