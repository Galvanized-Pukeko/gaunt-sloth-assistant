import { Command } from 'commander';
import { CommandLineConfigOverrides, initConfig } from '#src/config.js';
import {
  getCommandProviderInput,
  getCommandSystemPrompt,
  type PromptCommandType,
  type ProviderCommandType,
  type ProviderInputType,
} from '#src/commands/commandIntrospection.js';
import { display, displayError } from '#src/utils/consoleUtils.js';
import { setExitCode } from '#src/utils/systemUtils.js';

const PROMPT_COMMANDS = ['ask', 'review', 'pr', 'chat', 'code'] as const;
const PROVIDER_COMMANDS = ['review', 'pr'] as const;
const INPUT_TYPES = ['content', 'requirements'] as const;

export function getCommand(
  program: Command,
  commandLineConfigOverrides: CommandLineConfigOverrides
): void {
  program
    .command('get')
    .description('Print the effective prompt or provider-backed command input')
    .argument('<command>', 'Command to introspect')
    .argument('<subject>', 'Either prompt, content, or requirements')
    .argument('[id]', 'Provider-backed content identifier')
    .action(async (command: string, subject: string, id: string | undefined) => {
      try {
        const config = await initConfig(commandLineConfigOverrides);

        if (subject === 'prompt') {
          if (id) {
            throw new Error('Prompt subject does not accept an ID.');
          }
          if (!PROMPT_COMMANDS.includes(command as PromptCommandType)) {
            throw new Error(`Unsupported prompt command: ${command}.`);
          }

          display(getCommandSystemPrompt(command as PromptCommandType, config));
          return;
        }

        if (!INPUT_TYPES.includes(subject as ProviderInputType)) {
          throw new Error(`Unsupported subject: ${subject}.`);
        }
        if (!PROVIDER_COMMANDS.includes(command as ProviderCommandType)) {
          throw new Error(`Unsupported provider-backed command: ${command}.`);
        }
        if (!id) {
          throw new Error(`Subject "${subject}" requires an ID.`);
        }

        display(
          await getCommandProviderInput(
            command as ProviderCommandType,
            subject as ProviderInputType,
            id,
            config
          )
        );
      } catch (error) {
        displayError(error instanceof Error ? error.message : String(error));
        setExitCode(1);
      }
    });
}
