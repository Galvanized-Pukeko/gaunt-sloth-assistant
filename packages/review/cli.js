#!/usr/bin/env node

/**
 * Simple CLI for gaunt-sloth-review
 * Usage: gaunt-sloth-review [pr-number] [requirements]
 *
 * When called with a PR number, reviews the specified PR.
 * When called without arguments, reads diff from stdin.
 */

import { initConfig } from '#src/config.js';
import { review } from '#src/modules/reviewModule.js';
import { displayError, displayInfo } from '#src/utils/consoleUtils.js';
import { getCommandProviderInput } from '#src/commands/commandIntrospection.js';

const args = process.argv.slice(2);

async function main() {
  try {
    const config = await initConfig({});

    if (args.length > 0 && !args[0].startsWith('-')) {
      // PR review mode
      const prNumber = args[0];
      const requirements = args.slice(1).join(' ') || undefined;

      displayInfo(`Reviewing PR #${prNumber}...`);

      const providerInput = await getCommandProviderInput(
        config,
        'pr',
        { contentProvider: 'github-pr', requirementsProvider: requirements ? 'text' : undefined },
        { contentProviderArg: prNumber, requirementsProviderArg: requirements }
      );

      await review(config, providerInput.content, providerInput.requirements, 'pr');
    } else {
      // Stdin/file review mode
      const providerInput = await getCommandProviderInput(config, 'review', {}, {});
      await review(config, providerInput.content, providerInput.requirements, 'review');
    }
  } catch (err) {
    displayError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
