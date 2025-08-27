import { describe, test, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import { sep } from 'path';
import { platform } from 'node:os';

// Mock dependencies
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('#src/utils/systemUtils.js', () => ({
  getProjectDir: vi.fn(),
  getInstallDir: vi.fn(),
}));

/**
 * The logic is following:
 * if .gsloth dir exists - look for file in projectDir/.gsloth/.gsloth-settings/
 * if .gsloth dir exists, but file isn't there - fall back to projectDir/filename
 * if .gsloth does not exitst - look for file in projectDir/filename
 * if none of above exists - look for file in install dir
 */
describe('prompt reading functions', async () => {
  const prefix = platform() == 'win32' ? 'C:\\' : '/';
  const mockProjectDir = `${prefix}project`;
  const mockInstallDir = `${prefix}install`;

  const systemUtils = await import('#src/utils/systemUtils.js');
  const prompt = await import('#src/utils/llmUtils.js');

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(systemUtils, 'getProjectDir').mockReturnValue(mockProjectDir);
    vi.spyOn(systemUtils, 'getInstallDir').mockReturnValue(mockInstallDir);
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
  });

  const testCases = [
    { name: 'readGuidelines', filename: 'guidelines.md', acceptsParam: true },
    { name: 'readReviewInstructions', filename: 'review.md', acceptsParam: true },
    { name: 'readBackstory', filename: '.gsloth.backstory.md' },
    { name: 'readSystemPrompt', filename: '.gsloth.system.md' },
    { name: 'readChatPrompt', filename: '.gsloth.chat.md' },
    { name: 'readCodePrompt', filename: '.gsloth.code.md' },
  ];

  testCases.forEach(({ name, filename, acceptsParam }) => {
    describe(name, () => {
      test(`reads ${filename} from .gsloth directory when present`, () => {
        const gslothDirPath = `${mockProjectDir}${sep}.gsloth`;
        const filePath = `${gslothDirPath}${sep}.gsloth-settings${sep}${filename}`;
        vi.mocked(fs.existsSync).mockImplementation((path) =>
          [gslothDirPath, filePath].includes(String(path))
        );
        vi.mocked(fs.readFileSync).mockReturnValue('gsloth content');

        let func = (prompt as any)[name] as (_?: string) => string;
        let result;
        if (acceptsParam) {
          result = func(filename);
        } else {
          result = func();
        }
        expect(result).toBe('gsloth content');
        expect(fs.readFileSync).toHaveBeenCalledWith(filePath, { encoding: 'utf8' });
      });

      test(`reads ${filename} from project directory when not in .gsloth`, () => {
        const filePath = `${mockProjectDir}${sep}${filename}`;

        vi.mocked(fs.existsSync).mockImplementation((path) => [filePath].includes(String(path)));
        vi.mocked(fs.readFileSync).mockImplementationOnce(() => 'current content'); // Install dir read succeeds

        let func = (prompt as any)[name] as (_?: string) => string;
        let result;
        if (acceptsParam) {
          result = func(filename);
        } else {
          result = func();
        }
        expect(result).toBe('current content');
        expect(fs.readFileSync).toHaveBeenCalledWith(filePath, { encoding: 'utf8' });
      });

      test(`reads ${filename} from install directory when file neither exists in .gsloth nor in project dir`, () => {
        const fileInInstallDir = `${mockInstallDir}${sep}${filename}`;

        vi.mocked(fs.existsSync).mockImplementation((path) =>
          [fileInInstallDir].includes(String(path))
        );
        vi.mocked(fs.readFileSync).mockImplementationOnce(() => 'install content'); // Install dir read succeeds

        let func = (prompt as any)[name] as (_?: string) => string;
        let result;
        if (acceptsParam) {
          result = func(filename);
        } else {
          result = func();
        }
        expect(result).toBe('install content');
        expect(fs.readFileSync).toHaveBeenCalledWith(fileInInstallDir, { encoding: 'utf8' });
      });

      test(`throws error when ${filename} not found anywhere`, () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(fs.readFileSync).mockImplementation(() => {
          throw new Error();
        });

        let func = (prompt as any)[name] as (_?: string) => string;
        if (acceptsParam) {
          expect(() => func(filename)).toThrow();
        } else {
          expect(() => func()).toThrow();
        }
      });
    });
  });

  describe('readGuidelines formatting with organization', () => {
    test('appends organization, locale/timezone and date when enabled', () => {
      const filename = 'guidelines.md';
      const filePath = `${mockProjectDir}${sep}${filename}`;

      vi.mocked(fs.existsSync).mockImplementation((path) => [filePath].includes(String(path)));
      vi.mocked(fs.readFileSync).mockReturnValue('Guidelines content');

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-08-25T10:20:30.000Z'));

      const cfg = {
        projectGuidelines: filename,
        includeCurrentDateAfterGuidelines: true,
        organization: { name: 'Dancing Kakapo', locale: 'en-NZ', timezone: 'Pacific/Auckland' },
      };

      const result = (prompt as any).readGuidelines(cfg);

      expect(result).toContain('Guidelines content');
      expect(result).toContain('Organization: Dancing Kakapo');
      expect(result).toContain(
        'Current Date: 2024-08-25T10:20:30.000Z - Sunday, 25 August 2024 at 10:20:30 pm NZST'
      );
      expect(fs.readFileSync).toHaveBeenCalledWith(filePath, { encoding: 'utf8' });

      vi.useRealTimers();
    });

    test('Only includes UTC time when no org details provided', () => {
      const filename = 'guidelines.md';
      const filePath = `${mockProjectDir}${sep}${filename}`;

      vi.mocked(fs.existsSync).mockImplementation((path) => [filePath].includes(String(path)));
      vi.mocked(fs.readFileSync).mockReturnValue('Guidelines content');

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-08-25T10:20:30.000Z'));

      const cfg = {
        projectGuidelines: filename,
        includeCurrentDateAfterGuidelines: true,
      };

      const result = (prompt as any).readGuidelines(cfg);

      expect(result).not.toContain('Organization');
      expect(result).toContain('Current Date: 2024-08-25T10:20:30.000Z');
      expect(result).not.toContain(' - ');
      expect(fs.readFileSync).toHaveBeenCalledWith(filePath, { encoding: 'utf8' });

      vi.useRealTimers();
    });
  });
});
