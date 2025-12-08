import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the process object and its methods
const processMock = {
  stdin: {
    setRawMode: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
  versions: {
    node: '24.0.0',
  },
};

// Mock console utilities
const consoleUtilsMock = {
  displayWarning: vi.fn(),
  displayInfo: vi.fn(),
};

// Mock fs module
const fsMock = {
  createWriteStream: vi.fn(),
};

// Mock process events
const processEventMocks = {
  on: vi.fn(),
};

vi.mock('node:fs', () => fsMock);
vi.mock('#src/utils/consoleUtils.js', () => consoleUtilsMock);

// Mock the global process object
Object.defineProperty(global, 'process', {
  value: {
    ...processMock,
    ...processEventMocks,
  },
  writable: true,
});

describe('systemUtils', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('waitForEscape', () => {
    it('should not set up escape handler when disabled', async () => {
      // Import the function after mocks are set up
      const { waitForEscape } = await import('#src/utils/systemUtils.js');

      // Act
      waitForEscape(() => {}, false);

      // Assert
      expect(processMock.stdin.setRawMode).not.toHaveBeenCalled();
      expect(processMock.stdin.on).not.toHaveBeenCalled();
      expect(consoleUtilsMock.displayInfo).not.toHaveBeenCalled();
    });

    it('should set up escape handler when enabled', async () => {
      // Import the function after mocks are set up
      const { waitForEscape } = await import('#src/utils/systemUtils.js');

      const callback = vi.fn();

      // Act
      waitForEscape(callback, true);

      // Assert
      expect(processMock.stdin.setRawMode).toHaveBeenCalledWith(true);
      expect(processMock.stdin.on).toHaveBeenCalledWith('keypress', expect.any(Function));
      expect(consoleUtilsMock.displayInfo).toHaveBeenCalledWith(
        expect.stringContaining('Press Escape or Q to interrupt Agent')
      );
    });

    it('should call callback when escape key is pressed', async () => {
      // Import the function after mocks are set up
      const { waitForEscape } = await import('#src/utils/systemUtils.js');

      const callback = vi.fn();
      let keypressHandler: (_chunk: any, _key: any) => void;

      // Mock stdin.on to capture the keypress handler
      processMock.stdin.on.mockImplementation((event: string, handler: any) => {
        if (event === 'keypress') {
          keypressHandler = handler;
        }
      });

      // Act
      waitForEscape(callback, true);

      // Simulate escape key press
      keypressHandler!('', { name: 'escape' });

      // Assert
      expect(callback).toHaveBeenCalled();
      expect(consoleUtilsMock.displayWarning).toHaveBeenCalledWith('\nInterrupting...');
    });

    it('should not call callback when other keys are pressed', async () => {
      // Import the function after mocks are set up
      const { waitForEscape } = await import('#src/utils/systemUtils.js');

      const callback = vi.fn();
      let keypressHandler: (_chunk: any, _key: any) => void;

      // Mock stdin.on to capture the keypress handler
      processMock.stdin.on.mockImplementation((event: string, handler: any) => {
        if (event === 'keypress') {
          keypressHandler = handler;
        }
      });

      // Act
      waitForEscape(callback, true);

      // Simulate other key presses
      keypressHandler!('a', { name: 'a' });
      keypressHandler!('', { name: 'enter' });
      keypressHandler!('', { name: 'space' });

      // Assert
      expect(callback).not.toHaveBeenCalled();
      expect(consoleUtilsMock.displayWarning).not.toHaveBeenCalled();
    });
  });

  describe('stopWaitingForEscape', () => {
    it('should clean up escape handler', async () => {
      // Import the functions after mocks are set up
      const { waitForEscape, stopWaitingForEscape } = await import('#src/utils/systemUtils.js');

      const callback = vi.fn();
      let keypressHandler: any;

      // Mock stdin.on to capture the keypress handler
      processMock.stdin.on.mockImplementation((event: string, handler: any) => {
        if (event === 'keypress') {
          keypressHandler = handler;
        }
      });

      // Act - set up and then clean up
      waitForEscape(callback, true);
      stopWaitingForEscape();

      // Assert
      expect(processMock.stdin.setRawMode).toHaveBeenCalledWith(false);
      expect(processMock.stdin.off).toHaveBeenCalledWith('keypress', keypressHandler);
    });

    it('should handle multiple calls safely', async () => {
      // Import the function after mocks are set up
      const { stopWaitingForEscape } = await import('#src/utils/systemUtils.js');

      // Act - call multiple times
      stopWaitingForEscape();
      stopWaitingForEscape();

      // Assert - should not throw errors
      expect(processMock.stdin.setRawMode).not.toHaveBeenCalled();
      expect(processMock.stdin.off).not.toHaveBeenCalled();
    });
  });

  describe('log stream functions', () => {
    let mockWriteStream: any;

    beforeEach(() => {
      mockWriteStream = {
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
        destroyed: false,
      };
      fsMock.createWriteStream.mockReturnValue(mockWriteStream);
    });

    describe('initLogStream', () => {
      it('should create a write stream with correct options', async () => {
        // Import the function after mocks are set up
        const { initLogStream } = await import('#src/utils/systemUtils.js');

        const fileName = 'test.log';

        // Act
        initLogStream(fileName);

        // Assert
        expect(fsMock.createWriteStream).toHaveBeenCalledWith(fileName, {
          flags: 'a',
          autoClose: true,
        });
        expect(mockWriteStream.on).toHaveBeenCalledWith('error', expect.any(Function));
        expect(mockWriteStream.on).toHaveBeenCalledWith('close', expect.any(Function));
      });

      it('should handle stream creation errors', async () => {
        // Import the function after mocks are set up
        const { initLogStream } = await import('#src/utils/systemUtils.js');

        const error = new Error('Stream creation failed');
        fsMock.createWriteStream.mockImplementation(() => {
          throw error;
        });

        // Act
        initLogStream('test.log');

        // Assert
        expect(consoleUtilsMock.displayWarning).toHaveBeenCalledWith(
          expect.stringContaining('Failed to create log stream')
        );
      });
    });

    describe('writeToLogStream', () => {
      it('should write to active stream', async () => {
        // Import the functions after mocks are set up
        const { initLogStream, writeToLogStream } = await import('#src/utils/systemUtils.js');

        const message = 'test message';

        // Set up log stream
        initLogStream('test.log');

        // Act
        writeToLogStream(message);

        // Assert
        expect(mockWriteStream.write).toHaveBeenCalledWith(message);
      });

      it('should not write to destroyed stream', async () => {
        // Import the functions after mocks are set up
        const { initLogStream, writeToLogStream } = await import('#src/utils/systemUtils.js');

        const message = 'test message';

        // Set up log stream but mark as destroyed
        initLogStream('test.log');
        mockWriteStream.destroyed = true;

        // Act
        writeToLogStream(message);

        // Assert
        expect(mockWriteStream.write).not.toHaveBeenCalled();
      });
    });

    describe('closeLogStream', () => {
      it('should close active stream', async () => {
        // Import the functions after mocks are set up
        const { initLogStream, closeLogStream } = await import('#src/utils/systemUtils.js');

        // Set up log stream
        initLogStream('test.log');

        // Act
        closeLogStream();

        // Assert
        expect(mockWriteStream.end).toHaveBeenCalled();
      });

      it('should not close destroyed stream', async () => {
        // Import the functions after mocks are set up
        const { initLogStream, closeLogStream } = await import('#src/utils/systemUtils.js');

        // Set up log stream but mark as destroyed
        initLogStream('test.log');
        mockWriteStream.destroyed = true;

        // Act
        closeLogStream();

        // Assert
        expect(mockWriteStream.end).not.toHaveBeenCalled();
      });
    });
  });
});
