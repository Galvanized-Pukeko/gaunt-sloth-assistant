import { debugLog } from '#src/utils/debugUtils.js';
import { getInstallDir, stdout } from '#src/utils/systemUtils.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function getSlothVersion(): string {
  // TODO figure out if this can be injected with TS
  const installDir = getInstallDir();
  const jsonPath = resolve(installDir, 'package.json');
  const projectJson = readFileSync(jsonPath, { encoding: 'utf8' });
  return JSON.parse(projectJson).version;
}

export class ProgressIndicator {
  private interval: number | undefined = undefined;

  constructor(initialMessage: string, manual?: boolean) {
    stdout.write(initialMessage);
    if (!manual) {
      this.interval = setInterval(this.indicateInner, 1000) as unknown as number;
    }
  }

  private indicateInner(): void {
    stdout.write('.');
  }

  indicate(): void {
    if (this.interval) {
      throw new Error('ProgressIndicator.indicate only to be called in manual mode');
    }
    this.indicateInner();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
    }
    stdout.write('\n');
  }
}

// Tool formatting utilities

/**
 * Truncate a string to a maximum length with ellipsis
 */
export function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.slice(0, maxLength - 3) + '...';
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

export async function execAsync(command: string): Promise<string> {
  const { exec } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      if (stderr) {
        reject(new Error(stderr));
        return;
      }
      resolve(stdout.trim());
    });
  });
}
