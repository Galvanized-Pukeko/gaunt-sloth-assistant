import { CommandLineConfigOverrides, initConfig } from '#src/config.js';
import {
  defaultStatusCallback,
  display,
  displayInfo,
  flushSessionLog,
  formatInputPrompt,
  initSessionLogging,
  stopSessionLogging,
} from '#src/utils/consoleUtils.js';
import { GthAgentRunner } from '#src/core/GthAgentRunner.js';
import { getCommandOutputFilePath } from '#src/utils/fileUtils.js';
import {
  createInterface,
  error,
  exit,
  setRawMode,
  stdin as input,
  stdout as output,
} from '#src/utils/systemUtils.js';
import { appendToFile } from '#src/utils/utils.js';
import { type BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';
import { readBackstory, readGuidelines, readSystemPrompt } from '#src/utils/llmUtils.js';

export interface SessionConfig {
  mode: 'chat' | 'code';
  readModePrompt: () => string | null;
  description: string;
  readyMessage: string;
  exitMessage: string;
}

export async function createInteractiveSession(
  sessionConfig: SessionConfig,
  commandLineConfigOverrides: CommandLineConfigOverrides,
  message?: string
) {
  const config = { ...(await initConfig(commandLineConfigOverrides)) };
  const checkpointSaver = new MemorySaver();
  // Initialize Runner

  const logFileName = getCommandOutputFilePath(config, sessionConfig.mode);
  if (logFileName) {
    initSessionLogging(logFileName, config.streamSessionInferenceLog);
  }
  const runner = new GthAgentRunner(defaultStatusCallback);

  try {
    await runner.init(sessionConfig.mode, config, checkpointSaver);
    const rl = createInterface({ input, output });
    let isFirstMessage = true;
    let shouldExit = false;

    if (logFileName) {
      displayInfo(`${sessionConfig.mode} session will be logged to ${logFileName}\n`);
    }

    const processMessage = async (userInput: string) => {
      const logEntry = `## User\n\n${userInput}\n\n## Assistant\n\n`;
      if (logFileName) {
        appendToFile(logFileName, logEntry);
      }
      flushSessionLog(); // Ensure user input is immediately written to file
      const messages: BaseMessage[] = [];
      if (isFirstMessage) {
        const systemPromptParts = [readBackstory(), readGuidelines(config.projectGuidelines)];
        const modePrompt = sessionConfig.readModePrompt();
        if (modePrompt) {
          systemPromptParts.push(modePrompt);
        }
        const systemPrompt = readSystemPrompt();
        if (systemPrompt) {
          systemPromptParts.push(systemPrompt);
        }
        // TODO add cache control for Anthropic
        // messages.push(
        //   new SystemMessage({
        //     content: [
        //       {
        //         text: systemPromptParts.join('\n'),
        //         type: 'text',
        //         // cache_control: { type: 'ephemeral' },
        //       },
        //     ],
        //   })
        // );
        messages.push(new SystemMessage(systemPromptParts.join('\n')));
      }
      messages.push(new HumanMessage(userInput));

      const response = await runner.processMessages(messages);
      if (!config.streamSessionInferenceLog) {
        if (logFileName) {
          appendToFile(logFileName, response);
        }
      }

      isFirstMessage = false;
    };

    const askQuestion = async () => {
      while (!shouldExit) {
        setRawMode(true); // resume raw mode for user input (without it every user input is parroted)
        const userInput = await rl.question(formatInputPrompt('  > '));
        if (!userInput.trim()) {
          continue; // Skip inference if no input
        }
        const lowerInput = userInput.toLowerCase();
        if (lowerInput === 'exit' || lowerInput === '/exit') {
          display('Exiting...');
          shouldExit = true;
          await runner.cleanup();
          stopSessionLogging();
          rl.close();
          break;
        }

        let shouldRetry = false;

        do {
          try {
            await processMessage(userInput);
            shouldRetry = false;
          } catch (err) {
            display(
              `\n❌ Error processing message: ${err instanceof Error ? err.message : String(err)}\n`
            );
            const retryResponse = await rl.question(
              'Do you want to try again with the same prompt? (y/n): '
            );
            shouldRetry = retryResponse.toLowerCase().trim().startsWith('y');
            isFirstMessage = false; // To make sure we don't resend system prompt if the first message failed

            if (!shouldRetry) {
              display('\nSkipping to next prompt...');
            }
          }
        } while (shouldRetry && !shouldExit);

        if (!shouldExit) {
          display('\n\n');
          displayInfo(sessionConfig.exitMessage);
        }
      }
      rl.close();
    };

    if (message) {
      await processMessage(message);
    } else {
      display(sessionConfig.readyMessage);
      displayInfo(sessionConfig.exitMessage);
    }
    if (!shouldExit) await askQuestion();
    if (shouldExit) {
      setTimeout(() => {
        exit();
      }, 500);
    }
  } catch (err) {
    await runner.cleanup();
    stopSessionLogging();
    error(`Error in ${sessionConfig.mode} command: ${err}`);
    exit(1);
  }
}
