import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsMock = {
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(),
};
vi.mock('node:fs', () => fsMock);

const pathMock = {
  dirname: vi.fn(),
  resolve: vi.fn(),
};
vi.mock('node:path', () => pathMock);

describe('debugUtils', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // Set up default mock implementations
    pathMock.resolve.mockImplementation((path: string) => `/resolved/${path}`);
    pathMock.dirname.mockImplementation((path: string) => path.substring(0, path.lastIndexOf('/')));
  });

  describe('initDebugLogging', () => {
    it('should initialize logging when enabled', async () => {
      const { initDebugLogging } = await import('#src/debugUtils.js');

      initDebugLogging(true);

      expect(fsMock.mkdirSync).toHaveBeenCalledWith('/resolved', { recursive: true });
      expect(fsMock.appendFileSync).toHaveBeenCalledWith(
        '/resolved/gaunt-sloth.log',
        expect.stringContaining('=== Debug logging initialized ==='),
        'utf8'
      );
    });

    it('should not initialize logging when disabled', async () => {
      const { initDebugLogging } = await import('#src/debugUtils.js');

      initDebugLogging(false);

      expect(fsMock.mkdirSync).not.toHaveBeenCalled();
      expect(fsMock.appendFileSync).not.toHaveBeenCalled();
    });
  });

  describe('debugLog', () => {
    it('should write to log file when debug is enabled', async () => {
      const { initDebugLogging, debugLog } = await import('#src/debugUtils.js');

      initDebugLogging(true);
      vi.clearAllMocks(); // Clear initialization calls

      debugLog('Test message');

      expect(fsMock.appendFileSync).toHaveBeenCalledWith(
        '/resolved/gaunt-sloth.log',
        expect.stringMatching(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] Test message\n/),
        'utf8'
      );
    });

    it('should not write to log file when debug is disabled', async () => {
      const { initDebugLogging, debugLog } = await import('#src/debugUtils.js');

      initDebugLogging(false);
      debugLog('Test message');

      expect(fsMock.appendFileSync).not.toHaveBeenCalled();
    });
  });

  describe('debugLogMultiline', () => {
    it('should format multiline content with title', async () => {
      const { initDebugLogging, debugLogMultiline } = await import('#src/debugUtils.js');

      initDebugLogging(true);
      vi.clearAllMocks();

      debugLogMultiline('Test Title', 'Line 1\nLine 2');

      expect(fsMock.appendFileSync).toHaveBeenCalledTimes(3);
      expect(fsMock.appendFileSync).toHaveBeenCalledWith(
        '/resolved/gaunt-sloth.log',
        expect.stringContaining('=== Test Title ==='),
        'utf8'
      );
      expect(fsMock.appendFileSync).toHaveBeenCalledWith(
        '/resolved/gaunt-sloth.log',
        expect.stringContaining('Line 1\nLine 2'),
        'utf8'
      );
    });
  });

  describe('debugLogObject', () => {
    it('should format object using node inspect', async () => {
      const { initDebugLogging, debugLogObject } = await import('#src/debugUtils.js');

      initDebugLogging(true);
      vi.clearAllMocks();

      const testObj = { foo: 'bar', nested: { value: 123 } };
      debugLogObject('Test Object', testObj);

      expect(fsMock.appendFileSync).toHaveBeenCalledWith(
        '/resolved/gaunt-sloth.log',
        expect.stringContaining('=== Test Object ==='),
        'utf8'
      );
      // Check that inspect format is used (contains properties without quotes around keys)
      expect(fsMock.appendFileSync).toHaveBeenCalledWith(
        '/resolved/gaunt-sloth.log',
        expect.stringContaining("foo: 'bar'"),
        'utf8'
      );
    });
  });

  describe('debugLogError', () => {
    it('should log error with stack trace', async () => {
      const { initDebugLogging, debugLogError } = await import('#src/debugUtils.js');

      initDebugLogging(true);
      vi.clearAllMocks();

      const error = new Error('Test error');
      error.stack = 'Error: Test error\n  at test.js:10:5';
      debugLogError('test context', error);

      expect(fsMock.appendFileSync).toHaveBeenCalledWith(
        '/resolved/gaunt-sloth.log',
        expect.stringContaining('❌ Error in test context:'),
        'utf8'
      );
      expect(fsMock.appendFileSync).toHaveBeenCalledWith(
        '/resolved/gaunt-sloth.log',
        expect.stringContaining('Message: Test error'),
        'utf8'
      );
    });
  });
});
