import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runCommandWithArgs } from './support/commandRunner.ts';

describe('Binary Image Integration Tests', () => {
  let tempDir: string;
  let tempConfigPath: string;

  beforeEach(async () => {
    const testRoot = path.join(process.cwd(), 'integration-tests');
    tempDir = await mkdtemp(path.join(testRoot, 'binary-vision-'));

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

  it('should recognize the image content (ball)', async () => {
    const testRoot = path.join(process.cwd(), 'integration-tests');
    const relativeConfigPath = path.relative(testRoot, tempConfigPath);

    const output = await runCommandWithArgs('npx', [
      'gth',
      '-c',
      relativeConfigPath,
      'ask',
      '"Use the read_binary tool on test-data/image.png. What is on the picture test-data/image.png?"',
    ]);

    // The image has a picture of a soccer ball,
    // any kind of ball would include the word ball.
    expect(output.toLowerCase()).toContain('ball');
  });

  it('should recognize the image content (bicycle)', async () => {
    const testRoot = path.join(process.cwd(), 'integration-tests');
    const relativeConfigPath = path.relative(testRoot, tempConfigPath);

    const output = await runCommandWithArgs('npx', [
      'gth',
      '-c',
      relativeConfigPath,
      'ask',
      '"Use the read_binary tool on test-data/image2.png. What is on the picture test-data/image2.png?"',
    ]);

    // The picture contains a road bike,
    // any variations of bicycle would either include cycle or bike.
    expect(output.toLowerCase()).to.contain.oneOf(['cycle', 'bike']);
  });
});
