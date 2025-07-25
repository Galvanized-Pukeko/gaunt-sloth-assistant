import type { GthConfig } from '#src/config.js';
import { display, displayError, displaySuccess } from '#src/consoleUtils.js';
import { getGslothFilePath } from '#src/filePathUtils.js';
import { generateStandardFileName, ProgressIndicator } from '#src/utils.js';
import { writeFileSync } from 'node:fs';
import { invoke } from '#src/llmUtils.js';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

/**
 * Ask a question and get an answer from the LLM
 * @param source - The source of the question (used for file naming)
 * @param preamble - The preamble to send to the LLM
 * @param content - The content of the question
 */
export async function askQuestion(
  source: string,
  preamble: string,
  content: string,
  config: GthConfig
): Promise<void> {
  const progressIndicator = config.streamOutput ? undefined : new ProgressIndicator('Thinking.');
  const messages = [new SystemMessage(preamble), new HumanMessage(content)];
  const outputContent = await invoke('ask', messages, config);
  progressIndicator?.stop();
  const filename = generateStandardFileName(source);
  const filePath = getGslothFilePath(filename);
  if (!config.streamOutput) {
    display('\n' + outputContent);
  }
  try {
    writeFileSync(filePath, outputContent);
    displaySuccess(`\n\nThis report can be found in ${filePath}`);
  } catch (error) {
    displayError(`Failed to write answer to file: ${filePath}`);
    displayError(error instanceof Error ? error.message : String(error));
    // TODO Consider if we want to exit or just log the error
    // exit(1);
  }
}
