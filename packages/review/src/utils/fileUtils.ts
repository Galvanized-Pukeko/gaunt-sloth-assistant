export * from '@gaunt-sloth/core/utils/fileUtils.js';
import { readFileFromProjectDir } from '@gaunt-sloth/core/utils/fileUtils.js';
import { wrapContent } from '@gaunt-sloth/core/utils/llmUtils.js';

/**
 * Reads multiple files from the current directory and returns their contents
 * @param fileNames - Array of file names to read
 * @returns Combined content of all files with proper formatting, each file is wrapped in random block like <file-abvesde>
 */
export function readMultipleFilesFromProjectDir(fileNames: string | string[]): string {
  if (!Array.isArray(fileNames)) {
    return wrapContent(readFileFromProjectDir(fileNames), 'file', `file ${fileNames}`, true);
  }

  return fileNames
    .map((fileName) => {
      const content = readFileFromProjectDir(fileName);
      return `${wrapContent(content, 'file', `file ${fileName}`, true)}`;
    })
    .join('\n\n');
}
