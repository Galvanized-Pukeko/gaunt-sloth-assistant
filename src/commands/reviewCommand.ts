import { Command, Option } from 'commander';
import { getStringFromStdin } from '#src/utils/systemUtils.js';
import {
  REQUIREMENTS_PROVIDERS,
  CONTENT_PROVIDERS,
  type RequirementsProviderType,
  type ContentProviderType,
  getRequirementsFromProvider,
  getContentFromProvider,
} from '#src/commands/commandUtils.js';
import { CommandLineConfigOverrides } from '#src/config.js';
import {
  readBackstory,
  readGuidelines,
  readReviewInstructions,
  readSystemPrompt,
  wrapContent,
} from '#src/utils/llmUtils.js';

import { readMultipleFilesFromProjectDir } from '#src/utils/fileUtils.js';

interface ReviewCommandOptions {
  file?: string[];
  requirements?: string;
  requirementsProvider?: RequirementsProviderType;
  contentProvider?: ContentProviderType;
  message?: string;
}

export function reviewCommand(
  program: Command,
  cliConfigOverrides: CommandLineConfigOverrides
): void {
  program
    .command('review')
    .description('Review provided diff or other content')
    .argument(
      '[contentId]',
      'Optional content ID argument to retrieve content with content provider'
    )
    .alias('r')
    // TODO add provider to get results of git --no-pager diff
    .option(
      '-f, --file [files...]',
      'Input files. Content of these files will be added BEFORE the diff, but after requirements'
    )
    // TODO figure out what to do with this (we probably want to merge it with requirementsId)?
    .option('-r, --requirements <requirements>', 'Requirements for this review.')
    .addOption(
      new Option(
        '-p, --requirements-provider <requirementsProvider>',
        'Requirements provider for this review.'
      ).choices(Object.keys(REQUIREMENTS_PROVIDERS))
    )
    .addOption(
      new Option('--content-provider <contentProvider>', 'Content  provider').choices(
        Object.keys(CONTENT_PROVIDERS)
      )
    )
    .option('-m, --message <message>', 'Extra message to provide just before the content')
    .action(async (contentId: string | undefined, options: ReviewCommandOptions) => {
      const { initConfig } = await import('#src/config.js');
      const config = await initConfig(cliConfigOverrides); // Initialize and get config
      const systemPrompt = readSystemPrompt();
      const systemMessage = [
        readBackstory(),
        readGuidelines(config),
        readReviewInstructions(config),
      ];
      if (systemPrompt) {
        systemMessage.push(systemPrompt);
      }
      const content: string[] = [];
      const requirementsId = options.requirements;
      const requirementsProvider =
        options.requirementsProvider ??
        (config?.commands?.review?.requirementsProvider as RequirementsProviderType | undefined) ??
        (config?.requirementsProvider as RequirementsProviderType | undefined);
      const contentProvider =
        options.contentProvider ??
        (config?.commands?.review?.contentProvider as ContentProviderType | undefined) ??
        (config?.contentProvider as ContentProviderType | undefined);

      // TODO consider calling these in parallel
      const requirements = await getRequirementsFromProvider(
        requirementsProvider,
        requirementsId,
        config
      );
      if (requirements) {
        content.push(requirements);
      }

      const providedContent = await getContentFromProvider(contentProvider, contentId, config);
      if (providedContent) {
        content.push(providedContent);
      }

      if (options.file) {
        content.push(readMultipleFilesFromProjectDir(options.file));
      }
      const stringFromStdin = getStringFromStdin();
      if (stringFromStdin) {
        content.push(wrapContent(stringFromStdin, 'stdin-content'));
      }
      if (options.message) {
        content.push(wrapContent(options.message, 'message', 'user message'));
      }
      const { review } = await import('#src/modules/reviewModule.js');
      await review('REVIEW', systemMessage.join('\n'), content.join('\n'), config);
    });
}
