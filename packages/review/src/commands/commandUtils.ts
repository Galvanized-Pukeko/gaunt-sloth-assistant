import type { GthConfig } from '#src/config.js';
import { displayError } from '#src/utils/consoleUtils.js';

import { wrapContent } from '#src/utils/llmUtils.js';

/**
 * Requirements sources. Expected to be in `.sources/` dir.
 * Aliases are mapped to actual sources in this file
 */
export const REQUIREMENTS_PROVIDERS = {
  'jira-legacy': 'jiraIssueLegacySource.js',
  jira: 'jiraIssueSource.js',
  github: 'ghIssueSource.js',
  text: 'textSource.js',
  file: 'fileSource.js',
} as const;

export type RequirementsProviderType = keyof typeof REQUIREMENTS_PROVIDERS;

/**
 * Content sources. Expected to be in `.sources/` dir.
 * Aliases are mapped to actual sources in this file
 */
export const CONTENT_PROVIDERS = {
  github: 'ghPrDiffSource.js',
  text: 'textSource.js',
  file: 'fileSource.js',
} as const;

export type ContentProviderType = keyof typeof CONTENT_PROVIDERS;

export async function getRequirementsFromSource(
  requirementsProvider: RequirementsProviderType | undefined,
  requirementsId: string | undefined,
  config: GthConfig
): Promise<string> {
  const requirements = await getFromProvider(
    requirementsProvider,
    requirementsId,
    (config?.requirementsProviderConfig ?? {})[requirementsProvider as string],
    REQUIREMENTS_PROVIDERS
  );
  return wrapContent(requirements, requirementsProvider, 'requirements');
}

export async function getContentFromSource(
  contentProvider: ContentProviderType | undefined,
  contentId: string | undefined,
  config: GthConfig
): Promise<string> {
  const content = await getFromProvider(
    contentProvider,
    contentId,
    (config?.contentProviderConfig ?? {})[contentProvider as string],
    CONTENT_PROVIDERS
  );
  return wrapContent(
    content,
    contentProvider,
    contentProvider === 'github' ? 'GitHub diff' : 'content'
  );
}

/**
 * @deprecated Use getRequirementsFromSource instead
 */
export const getRequirementsFromProvider = getRequirementsFromSource;

/**
 * @deprecated Use getContentFromSource instead
 */
export const getContentFromProvider = getContentFromSource;

async function getFromProvider(
  provider: RequirementsProviderType | ContentProviderType | undefined,
  id: string | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any,
  legitPredefinedProviders: typeof REQUIREMENTS_PROVIDERS | typeof CONTENT_PROVIDERS
): Promise<string> {
  if (typeof provider === 'string') {
    // Use one of the predefined providers
    if (legitPredefinedProviders[provider as keyof typeof legitPredefinedProviders]) {
      const providerPath = `#src/sources/${legitPredefinedProviders[provider as keyof typeof legitPredefinedProviders]}`;
      const { get } = await import(providerPath);
      return await get(config, id);
    } else {
      displayError(`Unknown provider: ${provider}. Continuing without it.`);
    }
  } else if (typeof provider === 'function') {
    // Type assertion to handle function call
    return await (provider as (id: string | undefined) => Promise<string>)(id);
  }
  return '';
}
