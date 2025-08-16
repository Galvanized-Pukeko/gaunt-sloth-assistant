import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { GSLOTH_DIR, GSLOTH_AUTH } from '#src/constants.js';

/**
 * Gets the global .gsloth directory path in the user's home directory
 * @returns The resolved path to the global .gsloth directory
 */
export function getGlobalGslothDir(): string {
  return resolve(homedir(), GSLOTH_DIR);
}

/**
 * Ensures the global .gsloth directory exists in the user's home directory
 * Creates it if it doesn't exist
 * @returns The resolved path to the global .gsloth directory
 */
export function ensureGlobalGslothDir(): string {
  const globalDir = getGlobalGslothDir();

  if (!existsSync(globalDir)) {
    mkdirSync(globalDir, { recursive: true });
  }

  return globalDir;
}

/**
 * Gets the global auth directory path
 * @returns The resolved path to the global auth directory
 */
export function getGlobalAuthDir(): string {
  const globalDir = getGlobalGslothDir();
  return resolve(globalDir, GSLOTH_AUTH);
}

/**
 * Ensures the global auth directory exists
 * Creates it if it doesn't exist
 * @returns The resolved path to the global auth directory
 */
export function ensureGlobalAuthDir(): string {
  // First ensure parent directory exists
  ensureGlobalGslothDir();

  const authDir = getGlobalAuthDir();

  if (!existsSync(authDir)) {
    mkdirSync(authDir, { recursive: true });
  }

  return authDir;
}

/**
 * Gets the path for a specific OAuth provider's storage file
 * @param serverUrl The server URL or identifier for the OAuth provider
 * @returns The resolved path where the OAuth data should be stored
 */
export function getOAuthStoragePath(serverUrl: string): string {
  const authDir = ensureGlobalAuthDir();
  // Create a safe filename from the server URL
  const safeFilename = serverUrl
    .replace(/https?:\/\//, '')
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .replace(/_+/g, '_')
    .toLowerCase();

  return resolve(authDir, `${safeFilename}.json`);
}
