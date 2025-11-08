import type { GthConfig } from '#src/config.js';
import {
  defaultStatusCallback,
  displayDebug,
  displayError,
  displaySuccess,
  flushSessionLog,
  initSessionLogging,
  stopSessionLogging,
  displayInfo,
  displayWarning,
} from '#src/utils/consoleUtils.js';
import { getCommandOutputFilePath } from '#src/utils/fileUtils.js';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { GthAgentRunner } from '#src/core/GthAgentRunner.js';
import { MemorySaver } from '@langchain/langgraph';
import { ProgressIndicator } from '#src/utils/ProgressIndicator.js';
import { RateResponse, isRatingEnabled } from '#src/core/ratingSchema.js';
import { exit } from '#src/utils/systemUtils.js';

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
  let result = '';
  try {
    await runner.init(command, config, new MemorySaver());
    result = await runner.processMessages(messages);
  } catch (error) {
    displayDebug(error instanceof Error ? error : String(error));
    displayError('Failed to run review with agent.');
  } finally {
    await runner.cleanup();
  }

  progressIndicator?.stop();

  // Handle rating if enabled - do this BEFORE closing the file
  const ratingConfig = config.commands?.[command]?.rating;
  const ratingEnabledForCommand = isRatingEnabled(command, ratingConfig);

  if (ratingEnabledForCommand && result) {
    try {
      // Parse the structured rating response
      // Extract JSON from the result - it might have prefix text like "Returning structured response:"
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in rating response');
      }
      const rating: RateResponse = JSON.parse(jsonMatch[0]);
      // Defaults are set in DEFAULT_CONFIG, but TypeScript needs fallbacks for type safety
      const passThreshold = ratingConfig?.passThreshold ?? 6;
      const errorOnReviewFail = ratingConfig?.errorOnReviewFail ?? true;
      const passed = rating.rate >= passThreshold;

      // Display rating with clear formatting (will be written to file if logging is enabled)
      displayInfo('\n' + '='.repeat(60));
      displayInfo('REVIEW RATING');
      displayInfo('='.repeat(60));

      if (passed) {
        displaySuccess(`PASS ${rating.rate}/10 (threshold: ${passThreshold})`);
      } else {
        displayError(`FAIL ${rating.rate}/10 (threshold: ${passThreshold})`);
      }

      displayInfo(`\nComment: ${rating.comment}\n`);
      displayInfo('='.repeat(60) + '\n');

      // Exit with appropriate code if review failed
      if (!passed && errorOnReviewFail) {
        exit(1);
      }
    } catch (error) {
      displayDebug(error instanceof Error ? error : String(error));
      displayWarning('Failed to parse rating response. Review completed without rating.');
    }
  }

  // Close the file AFTER rating is written
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
