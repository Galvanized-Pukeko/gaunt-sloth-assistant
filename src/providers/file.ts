import { resolve } from 'node:path';
import { display } from '#src/utils/consoleUtils.js';
import { getProjectDir } from '#src/utils/systemUtils.js';
import type { ProviderConfig } from './types.js';

import { readFileSyncWithMessages } from '#src/utils/fileUtils.js';

/**
 * Reads the text file from current dir
 * @param _ config (unused in this provider)
 * @param fileName
 * @returns file contents
 */
export async function get(
  _: ProviderConfig | null,
  fileName: string | undefined
): Promise<string | null> {
  if (!fileName) {
    return null;
  }
  const currentDir = getProjectDir();
  const filePath = resolve(currentDir, fileName);
  display(`Reading file ${fileName}...`);
  return readFileSyncWithMessages(filePath);
}
