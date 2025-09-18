import { spawn } from 'child_process';
import path from 'path';
import { platform } from 'node:os';
import type { ChildProcess } from 'node:child_process';

/**
 * Runs a command in the integration-tests directory using spawn
 * This prevents stdin from being treated as a pipe
 * @param command - The main command to run
 * @param args - The command arguments
 * @param endOutput - Output which will terminate the execution
 * @param workDir - The working directory for the command
 * @returns The command output as a string
 */
export async function runCommandWithArgs(
  command: string,
  args: string[],
  endOutput?: string,
  workDir?: string
): Promise<string> {
  const testDir = path.resolve(workDir ? workDir : './integration-tests');
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const childProcess = spawn(command, args, {
      cwd: testDir,
      env: {
        ...process.env,
      },
      shell: platform().includes('win'),
      // Explicitly ignore stdin, otherwise the app switches to pipe mode
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    childProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      if (endOutput && data.toString().includes(endOutput)) {
        childProcess.kill();
        resolve(stdout.trim());
        return;
      }
    });

    childProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    childProcess.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Command failed with code ${code}\n${stderr}\n${stdout}`));
      }
    });
  });
}

export function startChildProcess(command: string, args: string[], stdin: 'ignore' | 'pipe') {
  const testDir = path.resolve('./integration-tests');
  const childProcess = spawn(command, args, {
    cwd: testDir,
    env: {
      ...process.env,
    },
    shell: platform().includes('win'),
    // Explicitly ignore stdin, otherwise the app switches to pipe mode
    stdio: [stdin, 'pipe', 'pipe'],
  });
  return childProcess;
}

export function waitForCursor(child: ChildProcess): Promise<string> {
  return new Promise((resolve, _reject) => {
    let inputPromptListener = getInputPromptListener(child, resolve);
    child.stdout.on('data', inputPromptListener);
  });
}

export function getInputPromptListener(child, resolve) {
  let acc = '';
  const inputPromptListener = (data) => {
    acc += data.toString();
    if (data.toString().includes('>')) {
      resolve(acc);
      child.stdout.removeListener('data', inputPromptListener);
      return;
    }
  };
  return inputPromptListener;
}
