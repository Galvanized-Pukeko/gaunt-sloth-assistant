import { Command } from 'commander';
import { CommandLineConfigOverrides, initConfig } from '#src/config.js';
import { getStringFromStdin } from '#src/utils/systemUtils.js';
import {
  readBackstory,
  readGuidelines,
  readSystemPrompt,
  wrapContent,
} from '#src/utils/llmUtils.js';

import { readMultipleFilesFromProjectDir } from '#src/utils/fileUtils.js';

interface AskCommandOptions {
  file?: string[];
}

/**
 * Adds the ask command to the program
 * @param program - The commander program
 * @param commandLineConfigOverrides - command line config overrides
 */
export function askCommand(
  program: Command,
  commandLineConfigOverrides: CommandLineConfigOverrides
): void {
  program
    .command('ask')
    .description('Ask a question')
    .argument('[message]', 'A message')
    .option(
      '-f, --file [files...]',
      'Input files. Content of these files will be added BEFORE the message'
    )
    .action(async (message: string, options: AskCommandOptions) => {
      const config = await initConfig(commandLineConfigOverrides);
      const systemPrompt = readSystemPrompt(config);
      const preamble = [readBackstory(config), readGuidelines(config)];
      if (systemPrompt) {
        preamble.push(systemPrompt);
      }
      const content = [];
      if (options.file) {
        content.push(readMultipleFilesFromProjectDir(options.file));
      }
      const stringFromStdin = getStringFromStdin();
      if (stringFromStdin) {
        content.push(wrapContent(stringFromStdin, 'stdin-content'));
      }
      if (message) {
        content.push(wrapContent(message, 'message', 'user message'));
      }

      // Validate that at least one input source is provided
      if (content.length === 0) {
        throw new Error('At least one of the following is required: file, stdin, or message');
      }

      const { askQuestion } = await import('#src/modules/questionAnsweringModule.js');
      await askQuestion('ASK', preamble.join('\n'), content.join('\n'), config);
    });
}
