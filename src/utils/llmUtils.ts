import { RunnableConfig } from '@langchain/core/runnables';
import { randomUUID } from 'node:crypto';
import {
  GSLOTH_BACKSTORY,
  GSLOTH_CHAT_PROMPT,
  GSLOTH_CODE_PROMPT,
  GSLOTH_SYSTEM_PROMPT,
} from '#src/constants.js';
import { getGslothConfigReadPath, readFileFromInstallDir } from '#src/utils/fileUtils.js';
import { existsSync, readFileSync } from 'node:fs';
import { debugLog } from '#src/utils/debugUtils.js';
import { truncateString } from '#src/utils/stringUtils.js';
import { GthConfig } from '#src/config.js';

/**
 * Creates new runnable config.
 * configurable.thread_id is an important part of that because it helps to distinguish different chat sessions.
 * We normally do not have multiple sessions in the terminal, but I had bad stuff happening in tests
 * and in another prototype project where I was importing Gaunt Sloth.
 */
export function getNewRunnableConfig(): RunnableConfig {
  return {
    recursionLimit: 1000,
    configurable: { thread_id: randomUUID() },
  };
}

export function readBackstory(config: Pick<GthConfig, 'identityProfile'>): string {
  return readPromptFile(GSLOTH_BACKSTORY, config.identityProfile);
}

export function readGuidelines(
  config:
    | Pick<
        GthConfig,
        | 'projectGuidelines'
        | 'includeCurrentDateAfterGuidelines'
        | 'organization'
        | 'identityProfile'
      >
    | string
): string {
  if (typeof config === 'string') {
    return readPromptFile(config, undefined);
  }
  const guidelines = readPromptFile(config.projectGuidelines, config.identityProfile);
  if (config.includeCurrentDateAfterGuidelines) {
    const currentDate = new Date();

    const orgName = config.organization?.name;
    const locale = config.organization?.locale;
    const timezone = config.organization?.timezone;

    const hasLocaleOrTimezone = Boolean((locale && locale.trim()) || (timezone && timezone.trim()));

    const humanReadableDate = hasLocaleOrTimezone
      ? new Intl.DateTimeFormat(locale?.trim() || undefined, {
          dateStyle: 'full',
          timeStyle: 'long',
          timeZone: timezone?.trim() || undefined,
        }).format(currentDate)
      : '';

    const lines: string[] = [guidelines];
    if (orgName) {
      lines.push(`Organization: ${orgName}`);
    }
    lines.push(
      `Current Date: ${currentDate.toISOString()}${hasLocaleOrTimezone ? ` - ${humanReadableDate}` : ''}`
    );
    return lines.join('\n');
  }
  return guidelines;
}

export function readReviewInstructions(
  config: Pick<GthConfig, 'projectReviewInstructions' | 'identityProfile'> | string
): string {
  if (typeof config === 'string') {
    return readPromptFile(config, undefined);
  }
  return readPromptFile(config.projectReviewInstructions, config.identityProfile);
}

export function readSystemPrompt(config: Pick<GthConfig, 'identityProfile'>): string {
  return readPromptFile(GSLOTH_SYSTEM_PROMPT, config.identityProfile);
}

export function readChatPrompt(config: Pick<GthConfig, 'identityProfile'>): string {
  return readPromptFile(GSLOTH_CHAT_PROMPT, config.identityProfile);
}

export function readCodePrompt(config: Pick<GthConfig, 'identityProfile'>): string {
  return readPromptFile(GSLOTH_CODE_PROMPT, config.identityProfile);
}

function readPromptFile(filename: string, identityProfile: string | undefined): string {
  const path = getGslothConfigReadPath(filename, identityProfile);
  if (existsSync(path)) {
    return readFileSync(path, { encoding: 'utf8' });
  }
  return readFileFromInstallDir(filename);
}

/**
 * Wraps content within randomized block
 */
export function wrapContent(
  content: string,
  wrapBlockPrefix: string = 'block',
  prefix: string = 'content',
  alwaysWrap: boolean = false
): string {
  if (content || alwaysWrap) {
    const contentWrapper = [];
    const block = wrapBlockPrefix + '-' + randomUUID().substring(0, 7);
    contentWrapper.push(`\nProvided ${prefix} follows within ${block} block\n`);
    contentWrapper.push(`<${block}>\n`);
    contentWrapper.push(content);
    contentWrapper.push(`\n</${block}>\n`);
    return contentWrapper.join('');
  }
  return content;
}

/**
 * Utility function to execute hook(s) - either a single hook or an array of hooks
 * Fully type-safe and works with any number of arguments
 * @param hooks - Single hook function or array of hook functions (or undefined)
 * @param args - Arguments to pass to each hook function
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function executeHooks<T extends (...args: any[]) => Promise<void>>(
  hooks: T | T[] | undefined,
  ...args: Parameters<T>
): Promise<void> {
  if (!hooks) return;

  if (Array.isArray(hooks)) {
    for (const hook of hooks) {
      await hook(...args);
    }
  } else {
    await hooks(...args);
  }
}
/**
 * Format tool call arguments in a human-readable way
 */
export function formatToolCallArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([key, value]) => {
      let displayValue: string;
      if (typeof value === 'string') {
        displayValue = value;
      } else if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
        displayValue = JSON.stringify(value);
      } else {
        displayValue = String(value);
      }
      return `${key}: ${truncateString(displayValue, 50)}`;
    })
    .join(', ');
}

/**
 * Format multiple tool calls for display (matches Invocation.ts behavior)
 */
export function formatToolCalls(
  toolCalls: Array<{ name: string; args?: Record<string, unknown> }>,
  maxLength = 255
): string {
  const formatted = toolCalls
    .map((toolCall) => {
      debugLog(JSON.stringify(toolCall));
      const formattedArgs = formatToolCallArgs(toolCall.args || {});
      return `${toolCall.name}(${formattedArgs})`;
    })
    .join(', ');

  // Truncate to maxLength characters if needed
  return formatted.length > maxLength ? formatted.slice(0, maxLength - 3) + '...' : formatted;
}
