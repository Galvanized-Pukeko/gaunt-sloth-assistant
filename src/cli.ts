import { Command, Option } from 'commander';
import { askCommand } from '#src/commands/askCommand.js';
import { initCommand } from '#src/commands/initCommand.js';
import { reviewCommand } from '#src/commands/reviewCommand.js';
import { prCommand } from '#src/commands/prCommand.js';
import { chatCommand } from '#src/commands/chatCommand.js';
import { codeCommand } from '#src/commands/codeCommand.js';
import { argv, getSlothVersion, readStdin } from '#src/utils/systemUtils.js';
import type { CommandLineConfigOverrides } from '#src/config.js';
import { coerceBooleanOrString } from '#src/utils/cliUtils.js';

const program = new Command();

program
  .name('gsloth')
  .description('Gaunt Sloth Assistant reviewing your PRs')
  .version(getSlothVersion())
  .option(
    '--verbose',
    'Set LangChain/LangGraph to verbose mode, ' +
      'causing LangChain/LangGraph to log many details to the console. ' +
      'Consider using debugLog from config.ts for less intrusive debug logging.'
  )
  .option('-c, --config <path>', 'Path to custom configuration file')
  .option(
    '-w, --write-output-to-file <value>',
    'Write output to file. Accepts true/false or a filename. Shortcuts: -wn or -w0 for false.'
  )
  .addOption(new Option('--nopipe').hideHelp(true));

const cliConfigOverrides: CommandLineConfigOverrides = {};

// Parse global options before binding any commands
program.parseOptions(argv);
if (program.getOptionValue('verbose')) {
  /**
   * Set LangChain/LangGraph to verbose mode,
   * causing LangChain/LangGraph to log many details to the console.
   * debugLog from config.ts may be a less intrusive option.
   */
  cliConfigOverrides.verbose = true;
}
if (program.getOptionValue('config')) {
  // Set a custom config path
  cliConfigOverrides.customConfigPath = program.getOptionValue('config');
}

const writeToFile = program.getOptionValue('writeOutputToFile');

// Commander does an interesting thing: if a shortcut like -w exists,
// everything after this shortcut without a space becomes the value.
// Examples: -wn comes with value 'n', -w0 => '0', -wreview.md => 'review.md'
const coerced = coerceBooleanOrString(writeToFile);
if (coerced !== undefined) {
  cliConfigOverrides.writeOutputToFile = coerced;
}

// Initialize all commands - they will handle their own config loading
initCommand(program);
reviewCommand(program, cliConfigOverrides);
prCommand(program, cliConfigOverrides);
askCommand(program, cliConfigOverrides);
chatCommand(program, cliConfigOverrides);
codeCommand(program, cliConfigOverrides);

await readStdin(program);
