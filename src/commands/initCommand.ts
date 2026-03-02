import type { ConfigType } from '#src/config.js';
import { availableDefaultConfigs, createProjectConfig } from '#src/config.js';
import { displayInfo, displayWarning } from '#src/utils/consoleUtils.js';
import { createInterface, env, stdin, stdout } from '#src/utils/systemUtils.js';
import { Argument, Command } from 'commander';

/**
 * Map of provider names to their expected API key environment variable names.
 * vertexai uses gcloud auth and does not require an API key env var.
 */
export const providerApiKeyMap: Record<string, string | null> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  'google-genai': 'GOOGLE_API_KEY',
  groq: 'GROQ_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  xai: 'XAI_API_KEY',
  openrouter: 'OPEN_ROUTER_API_KEY',
  vertexai: null,
};

/**
 * Detects which providers have API keys set in the environment.
 * Returns list of provider names with available keys.
 */
export function detectAvailableProviders(): string[] {
  const available: string[] = [];
  for (const provider of availableDefaultConfigs) {
    const keyName = providerApiKeyMap[provider];
    if (keyName === null) {
      // Provider like vertexai that doesn't need an API key
      available.push(provider);
    } else if (keyName && env[keyName]) {
      available.push(provider);
    }
  }
  return available;
}

/**
 * Prompts the user to select a provider from a numbered list.
 */
async function promptProviderSelection(providers: string[]): Promise<string> {
  displayInfo('Available providers:');
  providers.forEach((provider, index) => {
    const keyName = providerApiKeyMap[provider];
    const keyInfo = keyName ? ` (${keyName})` : ' (gcloud auth)';
    displayInfo(`  ${index + 1}. ${provider}${keyInfo}`);
  });

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question('\nSelect a provider by number: ');
    const selection = parseInt(answer.trim(), 10);
    if (isNaN(selection) || selection < 1 || selection > providers.length) {
      displayWarning(`Invalid selection. Please enter a number between 1 and ${providers.length}.`);
      rl.close();
      return promptProviderSelection(providers);
    }
    return providers[selection - 1];
  } finally {
    rl.close();
  }
}

/**
 * Adds the init command to the program
 * @param program - The commander program
 */
export function initCommand(program: Command): void {
  program
    .command('init')
    .description(
      'Initialize the Gaunt Sloth Assistant in your project. This will write necessary config files.'
    )
    .addArgument(
      new Argument('[type]', 'Config type (optional, will auto-detect if omitted)').choices(
        availableDefaultConfigs
      )
    )
    .action(async (config?: ConfigType) => {
      if (config) {
        await createProjectConfig(config);
      } else {
        const available = detectAvailableProviders();
        if (available.length === 0) {
          displayWarning(
            'No API keys detected in environment. Available providers: ' +
              availableDefaultConfigs.join(', ')
          );
          displayInfo('Please set an API key environment variable and try again, or run:');
          displayInfo('  gsloth init <type>');
          return;
        }

        const selected = await promptProviderSelection(available);
        await createProjectConfig(selected);
      }
    });
}
