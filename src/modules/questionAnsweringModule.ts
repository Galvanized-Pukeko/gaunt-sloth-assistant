import type { GthConfig } from '#src/config.js';
import {
  defaultStatusCallback,
  display,
  displayError,
  displaySuccess,
  flushSessionLog,
  initSessionLogging,
  stopSessionLogging,
} from '#src/utils/consoleUtils.js';
import { appendToFile, getCommandOutputFilePath } from '#src/utils/fileUtils.js';
import { ProgressIndicator } from '#src/utils/utils.js';
import { GthAgentRunner } from '#src/core/GthAgentRunner.js';
import { MemorySaver } from '@langchain/langgraph';
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

  // Resolve output path and initialize session logging if enabled
  const filePath = getCommandOutputFilePath(config, source);
  if (filePath) {
    initSessionLogging(filePath, config.streamSessionInferenceLog);
  }

  // Run via Agent Runner (consistent with interactive session)
  const runner = new GthAgentRunner(defaultStatusCallback);
  let outputContent = '';
  try {
    await runner.init('ask', config, new MemorySaver());
    outputContent = await runner.processMessages(messages);
  } catch (err) {
    displayError(`Failed to get answer: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await runner.cleanup();
  }

  progressIndicator?.stop();

  if (!config.streamOutput) {
    display('\n' + outputContent);
  }
  if (config.writeOutputToFile === false) {
    display('\n'); // something going on in some terminals, they swallow last line of output
  }
  if (filePath) {
    try {
      appendToFile(filePath, outputContent);
      flushSessionLog();
      stopSessionLogging();
      displaySuccess(`\n\nThis report can be found in ${filePath}`);
    } catch (error) {
      displayError(`Failed to write answer to file: ${filePath}`);
      displayError(error instanceof Error ? error.message : String(error));
    }
  }
}
