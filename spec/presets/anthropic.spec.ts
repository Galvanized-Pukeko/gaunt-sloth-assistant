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

describe('anthropic preset', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // TODO: postProcessJsonConfig is not exported from anthropic preset module
  describe.skip('postProcessJsonConfig', () => {
    it('should create empty middleware array when middleware is not defined', async () => {
      // const { postProcessJsonConfig } = await import('#src/presets/anthropic.js');

      const config = {} as Partial<GthConfig>;
      // const result = postProcessJsonConfig(config as GthConfig);

      // expect(result.middleware).toHaveLength(0);
      // expect(result.middleware).toEqual([]);
    });

    it('should preserve provided middleware', async () => {
      // const { postProcessJsonConfig } = await import('#src/presets/anthropic.js');
      const providedMiddleware = { name: 'provided', beforeModel: vi.fn() };

      const config = { middleware: [providedMiddleware] } as Partial<GthConfig>;
      // const result = postProcessJsonConfig(config as GthConfig);

      // expect(result.middleware).toHaveLength(1);
      // expect(result.middleware![0]).toBe(providedMiddleware);
    });
  });
});
