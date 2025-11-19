import { Command, Option } from 'commander';
import { displayError } from '#src/utils/consoleUtils.js';
import { setExitCode } from '#src/utils/systemUtils.js';
import {
  type ContentProviderType,
  getContentFromProvider,
  getRequirementsFromProvider,
  REQUIREMENTS_PROVIDERS,
  type RequirementsProviderType,
} from './commandUtils.js';
import jiraLogWork from '#src/helpers/jira/jiraLogWork.js';
import { JiraConfig } from '#src/providers/types.js';
import { CommandLineConfigOverrides } from '#src/config.js';
import {
  readBackstory,
  readGuidelines,
  readReviewInstructions,
  readSystemPrompt,
  wrapContent,
} from '#src/utils/llmUtils.js';

import { readMultipleFilesFromProjectDir } from '#src/utils/fileUtils.js';

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
      const { initConfig } = await import('#src/config.js');
      const config = await initConfig(commandLineConfigOverrides); // Initialize and get config

      const systemPrompt = readSystemPrompt(config);
      const systemMessage = [
        readBackstory(config),
        readGuidelines(config),
        readReviewInstructions(config),
      ];
      if (systemPrompt) {
        systemMessage.push(systemPrompt);
      }
      const content: string[] = [];
      const requirementsProvider =
        options.requirementsProvider ??
        (config?.commands?.pr?.requirementsProvider as RequirementsProviderType | undefined) ??
        (config?.requirementsProvider as RequirementsProviderType | undefined);

      const contentProvider =
        (config?.commands?.pr?.contentProvider as ContentProviderType | undefined) ??
        (config?.contentProvider as ContentProviderType | undefined) ??
        'github';

      if (options.file) {
        content.push(readMultipleFilesFromProjectDir(options.file));
      }

      // Handle requirements
      const requirements = await getRequirementsFromProvider(
        requirementsProvider,
        requirementsId,
        config
      );

      if (requirements) {
        content.push(requirements);
      }

      // Get PR diff using the provider
      try {
        content.push(await getContentFromProvider(contentProvider, prId, config));
      } catch (error) {
        displayError(error instanceof Error ? error.message : String(error));
        setExitCode(1);
        return;
      }

      if (options.message) {
        content.push(wrapContent(options.message, 'message', 'user message'));
      }

      const { review } = await import('#src/modules/reviewModule.js');
      // TODO consider including requirements id
      // TODO sanitize prId
      await review(`PR-${prId}`, systemMessage.join('\n'), content.join('\n'), config, 'pr');

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
