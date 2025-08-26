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

/**
 * Creates new runnable config.
 * configurable.thread_id is an important part of that because it helps to distinguish different chat sessions.
 * We normally do not have multiple sessions in the terminal, but I had bad stuff happening in tests
 * and in another prototype project where I was importing Gaunt Sloth.
 */
export function getNewRunnableConfig(): RunnableConfig {
  return {
    recursionLimit: 250,
    configurable: { thread_id: randomUUID() },
  };
}

export function readBackstory(): string {
  return readPromptFile(GSLOTH_BACKSTORY);
}

export function readGuidelines(guidelinesFilename: string): string {
  return readPromptFile(guidelinesFilename);
}

export function readReviewInstructions(reviewInstructions: string): string {
  return readPromptFile(reviewInstructions);
}

export function readSystemPrompt(): string {
  return readPromptFile(GSLOTH_SYSTEM_PROMPT);
}

export function readChatPrompt(): string {
  return readPromptFile(GSLOTH_CHAT_PROMPT);
}

export function readCodePrompt(): string {
  return readPromptFile(GSLOTH_CODE_PROMPT);
}

function readPromptFile(filename: string): string {
  const path = getGslothConfigReadPath(filename);
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
