import { Command, Option } from 'commander';
import { displayError } from '@gaunt-sloth/core/utils/consoleUtils.js';
import { setExitCode } from '@gaunt-sloth/core/utils/systemUtils.js';
import {
  getCommandProviderInput,
  getEffectiveContentProvider,
  getEffectiveRequirementsProvider,
  getReviewSystemPrompt,
} from '#src/commands/commandIntrospection.js';
import { REQUIREMENTS_PROVIDERS, type RequirementsProviderType } from './commandUtils.js';
import jiraLogWork from '#src/helpers/jira/jiraLogWork.js';
import { JiraConfig } from '@gaunt-sloth/review/sources/types.js';
import { CommandLineConfigOverrides } from '@gaunt-sloth/core/config.js';
import { wrapContent } from '@gaunt-sloth/core/utils/llmUtils.js';

import { readMultipleFilesFromProjectDir } from '@gaunt-sloth/review/utils/fileUtils.js';

interface PrCommandOptions {
  file?: string[];
  requirementsProvider?: RequirementsProviderType;
  message?: string;
}

export function prCommand(
  program: Command,
  commandLineConfigOverrides: CommandLineConfigOverrides
): void {
  program
    .command('pr')
    .description(
      'Review provided Pull Request in current directory. ' +
        'This command is similar to `review`, but default content provider is `github`. ' +
        '(assuming that GitHub CLI is installed and authenticated for current project'
    )
    .argument('<prId>', 'Pull request ID to review.')
    .argument(
      '[requirementsId]',
      'Optional requirements ID argument to retrieve requirements with requirements provider'
    )
    .addOption(
      new Option(
        '-p, --requirements-provider <requirementsProvider>',
        'Requirements provider for this review.'
      ).choices(Object.keys(REQUIREMENTS_PROVIDERS))
    )
    .option(
      '-f, --file [files...]',
      'Input files. Content of these files will be added BEFORE the diff, but after requirements'
    )
    .option('-m, --message <message>', 'Extra message to provide just before the content')
    .action(async (prId: string, requirementsId: string | undefined, options: PrCommandOptions) => {
      const { initConfig } = await import('@gaunt-sloth/core/config.js');
      const config = await initConfig(commandLineConfigOverrides); // Initialize and get config
      const content: string[] = [];
      const requirementsProvider = getEffectiveRequirementsProvider(
        'pr',
        config,
        options.requirementsProvider
      );
      const contentProvider = getEffectiveContentProvider('pr', config);

      if (options.file) {
        content.push(readMultipleFilesFromProjectDir(options.file));
      }

      // Handle requirements
      const requirements = await getCommandProviderInput(
        'pr',
        'requirements',
        requirementsId,
        config,
        requirementsProvider
      );

      if (requirements) {
        content.push(requirements);
      }

      // Get PR diff using the provider
      try {
        content.push(await getCommandProviderInput('pr', 'content', prId, config, contentProvider));
      } catch (error) {
        displayError(error instanceof Error ? error.message : String(error));
        setExitCode(1);
        return;
      }

      if (options.message) {
        content.push(wrapContent(options.message, 'message', 'user message'));
      }

      const { review } = await import('@gaunt-sloth/review/modules/reviewModule.js');
      // TODO consider including requirements id
      // TODO sanitize prId
      await review(`PR-${prId}`, getReviewSystemPrompt(config), content.join('\n'), config, 'pr');

      if (
        requirementsId &&
        (config.commands?.pr?.requirementsProvider ?? config.requirementsProvider) === 'jira' &&
        config.commands?.pr?.logWorkForReviewInSeconds
      ) {
        // TODO we need to figure out some sort of post-processors
        let jiraConfig =
          config.builtInToolsConfig?.jira ||
          (config.requirementsProviderConfig?.jira as JiraConfig);
        await jiraLogWork(
          jiraConfig,
          requirementsId,
          config.commands?.pr?.logWorkForReviewInSeconds,
          'code review'
        );
      }
    });
}
