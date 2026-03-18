import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { inspect } from 'node:util';

const DEBUG_LOG_FILE = 'gaunt-sloth.log';
let debugEnabled = false;

/**
 * Initialize debug logging based on config
 */
export function initDebugLogging(enabled: boolean): void {
  debugEnabled = enabled;
  if (debugEnabled) {
    // Ensure the log file directory exists
    const logPath = resolve(DEBUG_LOG_FILE);
    const logDir = dirname(logPath);
    try {
      mkdirSync(logDir, { recursive: true });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      // Directory might already exist, ignore error
    }

    // Log initialization
    debugLog('=== Debug logging initialized ===');
    debugLog(`Timestamp: ${new Date().toISOString()}`);
    debugLog(`Log file: ${logPath}`);
    debugLog('================================\n');
  }
}

/**
 * Log a debug message to the log file
 */
export function debugLog(message: string): void {
  if (!debugEnabled) return;

  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;

  try {
    appendFileSync(resolve(DEBUG_LOG_FILE), logEntry, 'utf8');
  } catch (error) {
    // Ignore logging errors to prevent breaking the main flow
    console.error('Failed to write to debug log:', error);
  }
}

/**
 * Log multiple lines with proper formatting
 */
export function debugLogMultiline(title: string, content: string): void {
  if (!debugEnabled) return;

  debugLog(`=== ${title} ===`);
  debugLog(content);
  debugLog(`=== End ${title} ===\n`);
}

/**
 * Log an object using Node.js inspect with reasonable depth
 */
export function debugLogObject(title: string, obj: unknown): void {
  if (!debugEnabled) return;

  try {
    // Use Node.js inspect with reasonable depth and no colors for log files
    const formatted = inspect(obj, { showHidden: false, depth: 3, colors: false });
    debugLogMultiline(title, formatted);
  } catch (error) {
    debugLog(`Failed to inspect ${title}: ${error}`);
  }
}

/**
 * Log error with stack trace
 */
export function debugLogError(context: string, error: unknown): void {
  if (!debugEnabled) return;

  debugLog(`❌ Error in ${context}:`);
  if (error instanceof Error) {
    debugLog(`  Message: ${error.message}`);
    if (error.stack) {
      debugLog('  Stack trace:');
      error.stack.split('\n').forEach((line) => debugLog(`    ${line}`));
    }
  } else {
    debugLog(`  Error: ${String(error)}`);
  }
  debugLog('');
}
