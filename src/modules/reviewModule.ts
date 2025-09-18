import type { GthConfig } from '#src/config.js';
import {
  defaultStatusCallback,
  display,
  displayDebug,
  displayError,
  displaySuccess,
  flushSessionLog,
  initSessionLogging,
  stopSessionLogging,
} from '#src/utils/consoleUtils.js';
import { getCommandOutputFilePath } from '#src/utils/fileUtils.js';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { GthAgentRunner } from '#src/core/GthAgentRunner.js';
import { MemorySaver } from '@langchain/langgraph';
import { ProgressIndicator } from '#src/utils/ProgressIndicator.js';

export async function review(
  source: string,
  preamble: string,
  diff: string,
  config: GthConfig,
  command: 'pr' | 'review' = 'review'
): Promise<void> {
  const progressIndicator = config.streamOutput ? undefined : new ProgressIndicator('Reviewing.');
  const messages = [new SystemMessage(preamble), new HumanMessage(diff)];

  // Prepare logging path (if enabled by config)
  const filePath = getCommandOutputFilePath(config, source);
  if (filePath) {
    initSessionLogging(filePath, config.streamSessionInferenceLog);
  }

  const runner = new GthAgentRunner(defaultStatusCallback);
  let outputContent = '';
  try {
    await runner.init(command, config, new MemorySaver());
    outputContent = await runner.processMessages(messages);
  } catch (error) {
    displayDebug(error instanceof Error ? error : String(error));
    displayError('Failed to run review with agent.');
  } finally {
    await runner.cleanup();
  }

  progressIndicator?.stop();

  if (!config.streamOutput) {
    display('\n' + outputContent);
  }

  if (filePath) {
    try {
      flushSessionLog();
      stopSessionLogging();
      displaySuccess(`\n\nThis report can be found in ${filePath}`);
    } catch (error) {
      displayDebug(error instanceof Error ? error : String(error));
      displayError(`Failed to write review to file: ${filePath}`);
    }
  }
}
