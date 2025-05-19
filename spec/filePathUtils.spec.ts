import { beforeEach, describe, expect, it, vi } from 'vitest';

const nodeFsMock = {
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
};
vi.mock('node:fs', () => nodeFsMock);

const nodePathMock = {
  resolve: vi.fn(),
};
vi.mock('node:path', () => nodePathMock);

const systemUtilsMock = {
  getCurrentDir: vi.fn(),
};
vi.mock('#src/systemUtils.js', () => systemUtilsMock);

describe('filePathUtils', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // Default mock values
    systemUtilsMock.getCurrentDir.mockImplementation(() => '/test/project');
    nodePathMock.resolve.mockImplementation((...args: string[]) => args.join('/'));
  });

  it('gslothDirExists should return true when .gsloth directory exists', async () => {
    nodeFsMock.existsSync.mockImplementation((path: string) => {
      return path === '/test/project/.gsloth';
    });

    const { gslothDirExists } = await import('#src/filePathUtils.js');

    expect(gslothDirExists()).toBe(true);
    expect(nodeFsMock.existsSync).toHaveBeenCalledWith('/test/project/.gsloth');
  });

  it('gslothDirExists should return false when .gsloth directory does not exist', async () => {
    nodeFsMock.existsSync.mockImplementation((path: string) => {
      return !path.includes('.gsloth');
    });

    const { gslothDirExists } = await import('#src/filePathUtils.js');

    expect(gslothDirExists()).toBe(false);
    expect(nodeFsMock.existsSync).toHaveBeenCalledWith('/test/project/.gsloth');
  });

  it('getGslothFilePath should return path within .gsloth directory when it exists', async () => {
    nodeFsMock.existsSync.mockImplementation((path: string) => {
      return path.includes('.gsloth');
    });

    const { getGslothFilePath } = await import('#src/filePathUtils.js');

    const result = getGslothFilePath('test-file.md');

    expect(result).toBe('/test/project/.gsloth/test-file.md');
    expect(nodeFsMock.existsSync).toHaveBeenCalledWith('/test/project/.gsloth');
  });

  it('getGslothFilePath should return path in project root when .gsloth directory does not exist', async () => {
    nodeFsMock.existsSync.mockImplementation((path: string) => {
      return !path.includes('.gsloth');
    });

    const { getGslothFilePath } = await import('#src/filePathUtils.js');

    const result = getGslothFilePath('test-file.md');

    expect(result).toBe('/test/project/test-file.md');
    expect(nodeFsMock.existsSync).toHaveBeenCalledWith('/test/project/.gsloth');
  });

  it('getGslothConfigWritePath should create .gsloth-settings directory when it does not exist', async () => {
    // First call to existsSync returns true for .gsloth dir, second call returns false for .gsloth-settings dir
    let callCount = 0;
    nodeFsMock.existsSync.mockImplementation((_path: string) => {
      callCount++;
      if (callCount === 1) return true; // .gsloth exists
      return false; // .gsloth-settings does not exist
    });

    const { getGslothConfigWritePath } = await import('#src/filePathUtils.js');

    const result = getGslothConfigWritePath('.gsloth.config.json');

    expect(result).toBe('/test/project/.gsloth/.gsloth-settings/.gsloth.config.json');
    expect(
      nodeFsMock.mkdirSync,
      'getGslothConfigWritePath should create the .gsloth/.gsloth-settings'
    ).toHaveBeenCalledWith('/test/project/.gsloth/.gsloth-settings', {
      recursive: true,
    });
  });

  it('getGslothConfigReadPath should return path in .gsloth-settings when config file exists there', async () => {
    // Mock existsSync to return true for both .gsloth dir and config file within .gsloth-settings
    nodeFsMock.existsSync.mockImplementation((_path: string) => true);

    const { getGslothConfigReadPath } = await import('#src/filePathUtils.js');

    const result = getGslothConfigReadPath('.gsloth.config.json');

    expect(result).toBe('/test/project/.gsloth/.gsloth-settings/.gsloth.config.json');
  });

  it('getGslothConfigReadPath should return path in project root when .gsloth exists but config file does not exist in .gsloth-settings', async () => {
    // Mock existsSync to return true for .gsloth dir but false for config file within .gsloth-settings
    nodeFsMock.existsSync.mockImplementation((_path: string) => {
      return !_path.includes('.gsloth-settings/.gsloth.config.json');
    });

    const { getGslothConfigReadPath } = await import('#src/filePathUtils.js');

    const result = getGslothConfigReadPath('.gsloth.config.json');

    expect(result).toBe('/test/project/.gsloth.config.json');
  });
});
