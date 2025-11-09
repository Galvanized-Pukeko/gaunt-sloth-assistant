import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import { createInterface, type Interface as ReadLineInterface } from 'node:readline/promises';
import { displayInfo, displayWarning } from './consoleUtils.js';
import { createWriteStream, readFileSync, type WriteStream } from 'node:fs';
import { ProgressIndicator } from '#src/utils/ProgressIndicator.js';

/**
 * This file contains all system functions and objects that are globally available
 * but not imported directly, such as process.stdin, process.stdout, process.argv,
 * process.env, process.cwd(), process.exit(), etc.
 *
 * By centralizing these in one file, we improve testability and make it easier
 * to mock these dependencies in tests.
 */

interface InnerState {
  installDir: string | null | undefined;
  stringFromStdin: string;
  useColour: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  waitForEscapeCallback?: (_: any, key: any) => void;
  logWriteStream?: WriteStream;
}

const innerState: InnerState = {
  installDir: undefined,
  stringFromStdin: '',
  useColour: false,
  waitForEscapeCallback: undefined,
  logWriteStream: undefined,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const keypressHandler = (callback: () => void) => (_: any, key: any) => {
  if (key?.name === 'escape' || key?.name === 'q') {
    displayWarning('\nInterrupting...');
    callback();
    return;
  }
};

export const waitForEscape = (callback: () => void, enabled: boolean) => {
  if (!enabled) {
    return;
  }
  process.stdin.setRawMode(true);
  innerState.waitForEscapeCallback = keypressHandler(callback);
  process.stdin.on('keypress', innerState.waitForEscapeCallback);
  displayInfo(`
  ┌--------------------------------------┐
  │ Press Escape or Q to interrupt Agent │
  └--------------------------------------┘
  `);
};

export const stopWaitingForEscape = () => {
  if (innerState.waitForEscapeCallback) {
    process.stdin.setRawMode(false);
    process.stdin.off('keypress', innerState.waitForEscapeCallback);
    innerState.waitForEscapeCallback = undefined;
  }
};

export const setRawMode = (rawMode: boolean) => {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(rawMode);
  }
};

export const initLogStream = (logFileName: string): void => {
  try {
    // Close existing stream if present
    if (innerState.logWriteStream) {
      innerState.logWriteStream.end();
    }

    // Create new write stream with append mode
    innerState.logWriteStream = createWriteStream(logFileName, {
      flags: 'a',
      autoClose: true,
    });

    // Handle stream errors
    innerState.logWriteStream.on('error', (err) => {
      displayWarning(`Log stream error: ${err.message}`);
      innerState.logWriteStream = undefined;
    });

    // Handle stream close
    innerState.logWriteStream.on('close', () => {
      innerState.logWriteStream = undefined;
    });
  } catch (err) {
    displayWarning(
      `Failed to create log stream: ${err instanceof Error ? err.message : String(err)}`
    );
    innerState.logWriteStream = undefined;
  }
};

export const writeToLogStream = (message: string): void => {
  if (innerState.logWriteStream && !innerState.logWriteStream.destroyed) {
    innerState.logWriteStream.write(message);
  }
};

export const closeLogStream = (): void => {
  if (innerState.logWriteStream && !innerState.logWriteStream.destroyed) {
    innerState.logWriteStream.end();
    innerState.logWriteStream = undefined;
  }
};

// Ensure log stream is closed on process exit
process.on('exit', () => {
  closeLogStream();
});

process.on('SIGINT', () => {
  closeLogStream();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeLogStream();
  process.exit(0);
});

// Process-related functions and objects
export const getProjectDir = (): string => process.cwd();
export const getInstallDir = (): string => {
  if (innerState.installDir) {
    return innerState.installDir;
  }
  throw new Error('Install directory not set');
};
/**
 * Cached string from stdin. Should only be called after readStdin completes execution.
 */
export const getStringFromStdin = (): string => {
  return innerState.stringFromStdin;
};
/**
 * Get the current useColour setting.
 */
export const getUseColour = (): boolean => {
  return innerState.useColour;
};
/**
 * Set the useColour setting.
 */
export const setUseColour = (useColour: boolean): void => {
  innerState.useColour = useColour;
};

export const isTTY = (): boolean => !!stdin.isTTY;

export const exit = (code?: number): never => process.exit(code || 0);
export const stdin = process.stdin;
export const stdout = process.stdout;
export const argv = process.argv;
export const env = process.env;
export const setExitCode = (code: number): void => {
  process.exitCode = code;
};
export { createInterface };
export type { ReadLineInterface };

// noinspection JSUnusedGlobalSymbols
/**
 * Provide the path to the entry point of the application.
 * This is used to set the install directory.
 * This is called from cli.js root entry point.
 */
export const setEntryPoint = (indexJs: string): void => {
  const filePath = fileURLToPath(indexJs);
  const dirPath = dirname(filePath);
  innerState.installDir = resolve(dirPath);
};

/**
 * Asynchronously reads the stdin and stores it as a string,
 * it can later be retrieved with getStringFromStdin.
 */
export function readStdin(program: Command): Promise<void> {
  return new Promise((resolvePromise) => {
    if (stdin.isTTY || program.getOptionValue('nopipe')) {
      program.parseAsync().then(() => resolvePromise());
    } else {
      // Support piping diff into gsloth
      const progressIndicator = new ProgressIndicator('reading STDIN', true);

      stdin.on('readable', function (this: NodeJS.ReadStream) {
        const chunk = this.read();
        progressIndicator.indicate();
        if (chunk !== null) {
          const chunkStr = chunk.toString('utf8');
          innerState.stringFromStdin = innerState.stringFromStdin + chunkStr;
        }
      });

      stdin.on('end', function () {
        program.parseAsync(argv).then(() => resolvePromise());
      });
    }
  });
}

// Console-related functions
export const log = (message: string): void => console.log(message);
export const error = (message: string): void => console.error(message);
export const warn = (message: string): void => console.warn(message);
export const info = (message: string): void => console.info(message);
export const debug = (message: string): void => console.debug(message);
export const stream = (chunk: string): boolean => process.stdout.write(chunk);
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

export function getSlothVersion(): string {
  const installDir = getInstallDir();
  const jsonPath = resolve(installDir, 'package.json');
  const projectJson = readFileSync(jsonPath, { encoding: 'utf8' });
  return JSON.parse(projectJson).version;
}
