import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the systemUtils module
const systemUtilsMock = {
  getUseColour: vi.fn(),
  initLogStream: vi.fn(),
  writeToLogStream: vi.fn(),
  closeLogStream: vi.fn(),
  log: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  stream: vi.fn(),
};

vi.mock('#src/utils/systemUtils.js', () => systemUtilsMock);

describe('consoleUtils', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    systemUtilsMock.getUseColour.mockReturnValue(false); // Default to no colors for easier testing
  });

  describe('initSessionLogging', () => {
    it('should initialize session logging when enabled', async () => {
      // Import the function after mocks are set up
      const { initSessionLogging } = await import('#src/utils/consoleUtils.js');

      const logFileName = 'test-session.log';

      // Act
      initSessionLogging(logFileName, true);

      // Assert
      expect(systemUtilsMock.initLogStream).toHaveBeenCalledWith(logFileName);
    });

    it('should not initialize session logging when disabled', async () => {
      // Import the function after mocks are set up
      const { initSessionLogging } = await import('#src/utils/consoleUtils.js');

      const logFileName = 'test-session.log';

      // Act
      initSessionLogging(logFileName, false);

      // Assert
      expect(systemUtilsMock.initLogStream).not.toHaveBeenCalled();
    });
  });

  describe('stopSessionLogging', () => {
    it('should close log stream and reset state', async () => {
      // Import the functions after mocks are set up
      const { initSessionLogging, stopSessionLogging } = await import('#src/utils/consoleUtils.js');

      // Set up session logging first
      initSessionLogging('test.log', true);

      // Act
      stopSessionLogging();

      // Assert
      expect(systemUtilsMock.closeLogStream).toHaveBeenCalled();
    });
  });

  describe('display functions', () => {
    beforeEach(async () => {
      // Import and initialize session logging for each test
      const { initSessionLogging } = await import('#src/utils/consoleUtils.js');
      initSessionLogging('test.log', true);
    });

    describe('displayError', () => {
      it('should display error message and log to session', async () => {
        // Import the function after mocks are set up
        const { displayError } = await import('#src/utils/consoleUtils.js');

        const message = 'Test error message';

        // Act
        displayError(message);

        // Assert
        expect(systemUtilsMock.log).toHaveBeenCalledWith(message); // Without colors
        expect(systemUtilsMock.writeToLogStream).toHaveBeenCalledWith(message + '\n');
      });

      it('should display colored error when colors enabled', async () => {
        systemUtilsMock.getUseColour.mockReturnValue(true);

        // Import the function after mocks are set up
        const { displayError } = await import('#src/utils/consoleUtils.js');

        const message = 'Test error message';

        // Act
        displayError(message);

        // Assert
        expect(systemUtilsMock.log).toHaveBeenCalledWith(expect.stringContaining('\x1b[31m')); // Red color
        expect(systemUtilsMock.writeToLogStream).toHaveBeenCalledWith(message + '\n'); // Clean message
      });
    });

    describe('displayWarning', () => {
      it('should display warning message and log to session', async () => {
        // Import the function after mocks are set up
        const { displayWarning } = await import('#src/utils/consoleUtils.js');

        const message = 'Test warning message';

        // Act
        displayWarning(message);

        // Assert
        expect(systemUtilsMock.warn).toHaveBeenCalledWith(message);
        expect(systemUtilsMock.writeToLogStream).toHaveBeenCalledWith(message + '\n');
      });
    });

    describe('displaySuccess', () => {
      it('should display success message and log to session', async () => {
        // Import the function after mocks are set up
        const { displaySuccess } = await import('#src/utils/consoleUtils.js');

        const message = 'Test success message';

        // Act
        displaySuccess(message);

        // Assert
        expect(systemUtilsMock.log).toHaveBeenCalledWith(message);
        expect(systemUtilsMock.writeToLogStream).toHaveBeenCalledWith(message + '\n');
      });
    });

    describe('displayInfo', () => {
      it('should display info message and log to session', async () => {
        // Import the function after mocks are set up
        const { displayInfo } = await import('#src/utils/consoleUtils.js');

        const message = 'Test info message';

        // Act
        displayInfo(message);

        // Assert
        expect(systemUtilsMock.info).toHaveBeenCalledWith(message);
        expect(systemUtilsMock.writeToLogStream).toHaveBeenCalledWith(message + '\n');
      });
    });

    describe('display', () => {
      it('should display plain message and log to session', async () => {
        // Import the function after mocks are set up
        const { display } = await import('#src/utils/consoleUtils.js');

        const message = 'Test plain message';

        // Act
        display(message);

        // Assert
        expect(systemUtilsMock.log).toHaveBeenCalledWith(message);
        expect(systemUtilsMock.writeToLogStream).toHaveBeenCalledWith(message + '\n');
      });
    });

    describe('displayDebug', () => {
      it('should display debug message and log to session', async () => {
        // Import the function after mocks are set up
        const { displayDebug } = await import('#src/utils/consoleUtils.js');

        const message = 'Test debug message';

        // Act
        displayDebug(message);

        // Assert
        expect(systemUtilsMock.debug).toHaveBeenCalledWith(message);
        expect(systemUtilsMock.writeToLogStream).toHaveBeenCalledWith(message + '\n');
      });

      it('should handle Error objects', async () => {
        // Import the function after mocks are set up
        const { displayDebug } = await import('#src/utils/consoleUtils.js');

        const error = new Error('Test error');
        error.stack = 'Error: Test error\n    at test.js:1:1';

        // Act
        displayDebug(error);

        // Assert
        expect(systemUtilsMock.debug).toHaveBeenCalledWith(error.stack);
        expect(systemUtilsMock.writeToLogStream).toHaveBeenCalledWith(error.stack + '\n');
      });

      it('should handle undefined values', async () => {
        // Import the function after mocks are set up
        const { displayDebug } = await import('#src/utils/consoleUtils.js');

        // Act
        displayDebug(undefined);

        // Assert
        expect(systemUtilsMock.debug).not.toHaveBeenCalled();
        expect(systemUtilsMock.writeToLogStream).not.toHaveBeenCalled();
      });
    });
  });

  describe('defaultStatusCallback', () => {
    beforeEach(async () => {
      // Import and initialize session logging for each test
      const { initSessionLogging } = await import('#src/utils/consoleUtils.js');
      initSessionLogging('test.log', true);
    });

    it('should handle all status levels correctly', async () => {
      // Import the callback after mocks are set up
      const { defaultStatusCallback } = await import('#src/utils/consoleUtils.js');

      // Test info level
      defaultStatusCallback('info', 'Info message');
      expect(systemUtilsMock.info).toHaveBeenCalledWith('Info message');

      // Test warning level
      defaultStatusCallback('warning', 'Warning message');
      expect(systemUtilsMock.warn).toHaveBeenCalledWith('Warning message');

      // Test error level
      defaultStatusCallback('error', 'Error message');
      expect(systemUtilsMock.log).toHaveBeenCalledWith('Error message');

      // Test success level
      defaultStatusCallback('success', 'Success message');
      expect(systemUtilsMock.log).toHaveBeenCalledWith('Success message');

      // Test debug level
      defaultStatusCallback('debug', 'Debug message');
      expect(systemUtilsMock.debug).toHaveBeenCalledWith('Debug message');

      // Test display level
      defaultStatusCallback('display', 'Display message');
      expect(systemUtilsMock.log).toHaveBeenCalledWith('Display message');

      // Test stream level
      defaultStatusCallback('stream', 'Stream message');
      expect(systemUtilsMock.stream).toHaveBeenCalledWith('Stream message');
      expect(systemUtilsMock.writeToLogStream).toHaveBeenCalledWith('Stream message');
    });
  });

  describe('formatInputPrompt', () => {
    it('should format input prompt without colors when disabled', async () => {
      systemUtilsMock.getUseColour.mockReturnValue(false);

      // Import the function after mocks are set up
      const { formatInputPrompt } = await import('#src/utils/consoleUtils.js');

      const message = 'Enter input:';

      // Act
      const result = formatInputPrompt(message);

      // Assert
      expect(result).toBe(message);
    });

    it('should format input prompt with colors when enabled', async () => {
      systemUtilsMock.getUseColour.mockReturnValue(true);

      // Import the function after mocks are set up
      const { formatInputPrompt } = await import('#src/utils/consoleUtils.js');

      const message = 'Enter input:';

      // Act
      const result = formatInputPrompt(message);

      // Assert
      expect(result).toContain('\x1b[35m'); // Magenta color
      expect(result).toContain('\x1b[0m'); // Reset color
      expect(result).toContain(message);
    });
  });

  describe('session logging with disabled state', () => {
    it('should not log to session when logging is disabled', async () => {
      // Import the functions after mocks are set up
      const { initSessionLogging, displayInfo } = await import('#src/utils/consoleUtils.js');

      // Initialize with logging disabled
      initSessionLogging('test.log', false);

      const message = 'Test message';

      // Act
      displayInfo(message);

      // Assert
      expect(systemUtilsMock.info).toHaveBeenCalledWith(message);
      expect(systemUtilsMock.writeToLogStream).not.toHaveBeenCalled();
    });
  });

  describe('parseBooleanOrString', async () => {
    const { parseBooleanOrString } = await import('#src/utils/consoleUtils.js');
    it('parses false-like tokens', () => {
      expect(parseBooleanOrString('false')).toEqual({ kind: 'boolean', value: false });
      expect(parseBooleanOrString('False')).toEqual({ kind: 'boolean', value: false });
      expect(parseBooleanOrString('0')).toEqual({ kind: 'boolean', value: false });
      expect(parseBooleanOrString('n')).toEqual({ kind: 'boolean', value: false });
      expect(parseBooleanOrString('NO')).toEqual({ kind: 'boolean', value: false });
    });

    it('parses true-like tokens', () => {
      expect(parseBooleanOrString('true')).toEqual({ kind: 'boolean', value: true });
      expect(parseBooleanOrString('True')).toEqual({ kind: 'boolean', value: true });
      expect(parseBooleanOrString('1')).toEqual({ kind: 'boolean', value: true });
      expect(parseBooleanOrString('y')).toEqual({ kind: 'boolean', value: true });
      expect(parseBooleanOrString('YES')).toEqual({ kind: 'boolean', value: true });
    });

    it('returns string for non-boolean tokens', () => {
      expect(parseBooleanOrString('review.md')).toEqual({ kind: 'string', value: 'review.md' });
      expect(parseBooleanOrString('out/rev.md')).toEqual({ kind: 'string', value: 'out/rev.md' });
      // literal string, not a special token
      expect(parseBooleanOrString(' -w0 ')).toEqual({ kind: 'string', value: '-w0' });
    });

    it('returns none for nullish or empty input', () => {
      expect(parseBooleanOrString(undefined)).toEqual({ kind: 'none' });
      expect(parseBooleanOrString(null)).toEqual({ kind: 'none' });
      expect(parseBooleanOrString('')).toEqual({ kind: 'none' });
      expect(parseBooleanOrString('   ')).toEqual({ kind: 'none' });
    });
  });

  describe('coerceBooleanOrString', async () => {
    const { coerceBooleanOrString } = await import('#src/utils/consoleUtils.js');
    it('coerces to boolean for boolean-like tokens', () => {
      expect(coerceBooleanOrString('false')).toBe(false);
      expect(coerceBooleanOrString('0')).toBe(false);
      expect(coerceBooleanOrString('n')).toBe(false);
      expect(coerceBooleanOrString('true')).toBe(true);
      expect(coerceBooleanOrString('1')).toBe(true);
      expect(coerceBooleanOrString('y')).toBe(true);
    });

    it('coerces to string for other values', () => {
      expect(coerceBooleanOrString('review.md')).toBe('review.md');
      expect(coerceBooleanOrString('out/rev.md')).toBe('out/rev.md');
      expect(coerceBooleanOrString(' -wn ')).toBe('-wn');
    });

    it('returns undefined for none', () => {
      expect(coerceBooleanOrString(undefined)).toBeUndefined();
      expect(coerceBooleanOrString(null)).toBeUndefined();
      expect(coerceBooleanOrString('   ')).toBeUndefined();
    });
  });
});
