import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runCommandWithArgs } from './support/commandRunner';

const MINIMAL_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

describe('Binary Formats Integration Tests', () => {
  let tempDir: string;
  let tempConfigPath: string;

  beforeEach(async () => {
    const testRoot = path.join(process.cwd(), 'integration-tests');
    tempDir = await mkdtemp(path.join(testRoot, 'binary-test-'));
    const pngPath = path.join(tempDir, 'test.png');
    await writeFile(pngPath, MINIMAL_PNG);

    const baseConfigPath = path.join(testRoot, '.gsloth.config.json');
    const baseConfigRaw = JSON.parse(await readFile(baseConfigPath, 'utf8')) as Record<
      string,
      unknown
    >;

    baseConfigRaw.binaryFormats = [{ type: 'image', extensions: ['png'] }];

    tempConfigPath = path.join(tempDir, 'binary.gsloth.config.json');
    await writeFile(tempConfigPath, JSON.stringify(baseConfigRaw, null, 2));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('should read binary images with multimodal output', async () => {
    const testRoot = path.join(process.cwd(), 'integration-tests');
    const relativeConfigPath = path.relative(testRoot, tempConfigPath);
    const relativeFilePath = path.relative(testRoot, path.join(tempDir, 'test.png'));

    const output = await runCommandWithArgs('npx', [
      'gth',
      '-c',
      relativeConfigPath,
      'ask',
      `"Use the read_binary tool on ${relativeFilePath} and then respond with OK."`,
    ]);

    expect(output.toLowerCase()).toContain('ok');
  });
});
