import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the fs module
let fsUtilsMock = {
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
};
vi.mock('node:fs', () => fsUtilsMock);

// Mock the systemUtils module
const systemUtilsMock = {
  getProjectDir: vi.fn(),
  getInstallDir: vi.fn(),
  exit: vi.fn(),
};
vi.mock('#src/utils/systemUtils.js', () => systemUtilsMock);

// Mock the consoleUtils module
const consoleUtilsMock = {
  display: vi.fn(),
  displayError: vi.fn(),
  displayWarning: vi.fn(),
  displaySuccess: vi.fn(),
  displayInfo: vi.fn(),
};
vi.mock('#src/utils/consoleUtils.js', () => consoleUtilsMock);

describe('utils', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // Set up default mock values
    systemUtilsMock.getProjectDir.mockReturnValue('/mock/project/dir');
    systemUtilsMock.getInstallDir.mockReturnValue('/mock/install/dir');
  });

  describe('generateStandardFileName', () => {
    it('should generate filename with prefix, date, time and command', async () => {
      // Mock the Date object to return a fixed date and time
      const originalDate = global.Date;
      const mockDate = new Date('2025-05-17T21:45:30');
      global.Date = class extends Date {
        constructor() {
          super();
          return mockDate;
        }
      } as typeof Date;

      try {
        // Import the function after mocks are set up
        const { generateStandardFileName, toFileSafeString } =
          await import('#src/utils/fileUtils.js');

        // Define test commands
        const commands = ['ASK', 'REVIEW', 'PR-123'];

        for (const command of commands) {
          // Act
          const result = generateStandardFileName(command);

          // Assert
          expect(result).toBe(
            `gth_2025-05-17_21-45-30_${toFileSafeString(command.toUpperCase())}.md`
          );
          expect(result).toMatch(/^gth_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_[A-Z0-9-]+\.md$/);

          // Verify parts of the filename
          const parts = result.replace('.md', '').split('_');
          expect(parts[0]).toBe('gth');
          expect(parts[1]).toBe('2025-05-17'); // date
          expect(parts[2]).toBe('21-45-30'); // time
          expect(parts[3]).toBe(toFileSafeString(command.toUpperCase())); // command
        }
      } finally {
        // Restore the original Date
        global.Date = originalDate;
      }
    });
  });

  describe('readMultipleFilesFromProjectDir', () => {
    it('should read file from project directory if it exists', async () => {
      // Arrange
      const fileName = 'test.file';
      const projectDirPath = '/mock/project/dir';
      const filePath = resolve(projectDirPath, fileName);
      const fileContent = 'file content from project dir';

      fsUtilsMock.readFileSync.mockReturnValue(fileContent);

      // Import the function after mocks are set up
      const { readFileFromProjectDir } = await import('#src/utils/fileUtils.js');

      // Act
      const result = readFileFromProjectDir(fileName);

      // Assert
      expect(result).toBe(fileContent);
      expect(fsUtilsMock.writeFileSync).not.toHaveBeenCalled();
      expect(fsUtilsMock.readFileSync).toHaveBeenCalledWith(filePath, { encoding: 'utf8' });
      expect(systemUtilsMock.getProjectDir).toHaveBeenCalled();
      expect(systemUtilsMock.getInstallDir).not.toHaveBeenCalled();
      expect(consoleUtilsMock.displayInfo).toHaveBeenCalledWith(expect.stringContaining('Reading'));
    });

    it('should exit with error if file not found in install directory', async () => {
      // Arrange
      const fileName = 'test.file';
      const installDirPath = '/mock/install/dir';
      const installFilePath = resolve(installDirPath, fileName);

      // Mock readFileSync to throw ENOENT for both directories
      const enoentError = new Error('File not found') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';

      fsUtilsMock.readFileSync
        .mockImplementationOnce(() => {
          throw enoentError;
        })
        .mockImplementationOnce(() => {
          throw enoentError;
        });

      // Import the function after mocks are set up
      const { readFileFromInstallDir } = await import('#src/utils/fileUtils.js');

      // Act & Assert
      expect(() => readFileFromInstallDir(fileName)).toThrow();
      expect(fsUtilsMock.writeFileSync).not.toHaveBeenCalled();
      expect(fsUtilsMock.readFileSync).toHaveBeenCalledWith(installFilePath, { encoding: 'utf8' });
      expect(systemUtilsMock.getInstallDir).toHaveBeenCalled();
      expect(consoleUtilsMock.displayError).toHaveBeenCalledWith(
        expect.stringContaining(installFilePath)
      );
    });
  });
});
