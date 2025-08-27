import { StatusUpdateCallback } from '#src/core/GthLangChainAgent.js';
import { StatusLevel } from '#src/core/types.js';
import * as su from '#src/utils/systemUtils.js';
import { closeLogStream, initLogStream, stream, writeToLogStream } from '#src/utils/systemUtils.js';

// Internal state for session logging
interface LoggingState {
  sessionLogFile?: string;
  enableSessionLogging: boolean;
}

const loggingState: LoggingState = {
  sessionLogFile: undefined,
  enableSessionLogging: false,
};

// ANSI color codes
const ANSI_COLORS = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

// Helper functions for ANSI coloring
function colorText(text: string, color: keyof typeof ANSI_COLORS): string {
  if (!su.getUseColour()) {
    return text;
  }
  return `${ANSI_COLORS[color]}${text}${ANSI_COLORS.reset}`;
}

// Stream-based logging function
const writeToSessionLog = (message: string): void => {
  if (loggingState.enableSessionLogging) {
    // Strip ANSI color codes before logging to file
    const cleanMessage = message.replace(/\x1b\[[0-9;]*m/g, '');
    writeToLogStream(cleanMessage);
  }
};

// Public functions for session logging management
export const initSessionLogging = (logFileName: string, enableLogging: boolean): void => {
  loggingState.sessionLogFile = enableLogging ? logFileName : undefined;
  loggingState.enableSessionLogging = enableLogging;

  if (enableLogging && logFileName) {
    initLogStream(logFileName);
  }
};

export const flushSessionLog = (): void => {
  // Streams auto-flush, so this is now a no-op for API compatibility
  // Could potentially force flush if needed in the future
};

export const stopSessionLogging = (): void => {
  closeLogStream();
  loggingState.sessionLogFile = undefined;
  loggingState.enableSessionLogging = false;
};

export function displayError(message: string): void {
  const coloredMessage = colorText(message, 'red');
  writeToSessionLog(message + '\n');
  su.log(coloredMessage);
}

export function displayWarning(message: string): void {
  const coloredMessage = colorText(message, 'yellow');
  writeToSessionLog(message + '\n');
  su.warn(coloredMessage);
}

export function displaySuccess(message: string): void {
  const coloredMessage = colorText(message, 'green');
  writeToSessionLog(message + '\n');
  su.log(coloredMessage);
}

export function displayInfo(message: string): void {
  const coloredMessage = colorText(message, 'dim');
  writeToSessionLog(message + '\n');
  su.info(coloredMessage);
}

export function display(message: string): void {
  writeToSessionLog(message + '\n');
  su.log(message);
}

export function formatInputPrompt(message: string): string {
  return colorText(message, 'magenta');
}

export function displayDebug(message: string | Error | undefined): void {
  // TODO make it controlled by config
  if (message instanceof Error) {
    const stackTrace = message.stack || '';
    writeToSessionLog(stackTrace + '\n');
    su.debug(stackTrace);
  } else if (message !== undefined) {
    writeToSessionLog(message + '\n');
    su.debug(message);
  }
}

// Create status update callback
export const defaultStatusCallback: StatusUpdateCallback = (
  level: StatusLevel,
  message: string
) => {
  switch (level) {
    case 'info':
      displayInfo(message);
      break;
    case 'warning':
      displayWarning(message);
      break;
    case 'error':
      displayError(message);
      break;
    case 'success':
      displaySuccess(message);
      break;
    case 'debug':
      displayDebug(message);
      break;
    case 'display':
      display(message);
      break;
    case 'stream':
      writeToSessionLog(message);
      stream(message);
      break;
  }
};
/**
 * Result of attempting to parse a CLI value as boolean-or-string.
 * When kind === 'boolean', value is a boolean.
 * When kind === 'string', value is a non-empty string.
 * When kind === 'none', no usable value was provided (undefined/null/empty).
 */
export type BooleanOrStringParseResult =
  | { kind: 'boolean'; value: boolean }
  | { kind: 'string'; value: string }
  | { kind: 'none' };

/**
 * Parse a CLI option value into either:
 * - a boolean (when value looks like a true/false token),
 * - a non-empty string (otherwise),
 * - or none (when value is nullish or only whitespace).
 *
 * Recognized false-like tokens (case-insensitive): 'false', '0', 'n', 'no'
 * Recognized true-like tokens (case-insensitive):  'true', '1', 'y', 'yes'
 *
 * Examples:
 *  parseBooleanOrString('n')         => { kind: 'boolean', value: false }
 *  parseBooleanOrString('0')         => { kind: 'boolean', value: false }
 *  parseBooleanOrString('true')      => { kind: 'boolean', value: true }
 *  parseBooleanOrString('1')         => { kind: 'boolean', value: true }
 *  parseBooleanOrString('review.md') => { kind: 'string',  value: 'review.md' }
 *  parseBooleanOrString('  ')        => { kind: 'none' }
 *  parseBooleanOrString(undefined)   => { kind: 'none' }
 */
export function parseBooleanOrString(value: unknown): BooleanOrStringParseResult {
  if (value === undefined || value === null) {
    return { kind: 'none' };
  }

  const str = String(value);
  const trimmed = str.trim();
  if (trimmed.length === 0) {
    return { kind: 'none' };
  }

  const lower = trimmed.toLowerCase();

  // False-like tokens
  if (lower === 'false' || lower === '0' || lower === 'n' || lower === 'no') {
    return { kind: 'boolean', value: false };
  }

  // True-like tokens
  if (lower === 'true' || lower === '1' || lower === 'y' || lower === 'yes') {
    return { kind: 'boolean', value: true };
  }

  // Otherwise, treat as a string (e.g., filename/path)
  return { kind: 'string', value: trimmed };
}

/**
 * Convenience wrapper that returns a union directly instead of the tagged result.
 *
 * Returns:
 * - boolean when the input is a boolean-like token
 * - string when the input is non-empty and not a boolean-like token
 * - undefined when the input is nullish or empty/whitespace
 */
export function coerceBooleanOrString(value: unknown): boolean | string | undefined {
  const parsed = parseBooleanOrString(value);
  switch (parsed.kind) {
    case 'boolean':
      return parsed.value;
    case 'string':
      return parsed.value;
    default:
      return undefined;
  }
}
