import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { getProjectDir } from '#src/utils/systemUtils.js';
import { GSLOTH_DIR, GSLOTH_SETTINGS_DIR } from '#src/constants.js';
import type { GthConfig } from '#src/config.js';
import { generateStandardFileName } from '#src/utils/utils.js';

/**
 * Checks if .gsloth directory exists in the project root
 * @returns Boolean indicating whether .gsloth directory exists
 */
export function gslothDirExists(): boolean {
  const currentDir = getProjectDir();
  const gslothDirPath = resolve(currentDir, GSLOTH_DIR);
  return existsSync(gslothDirPath);
}

/**
 * Gets the path where gsloth should write files based on .gsloth directory existence
 * @param filename The filename to append to the path
 * @returns The resolved path where the file should be written
 */
export function getGslothFilePath(filename: string): string {
  const currentDir = getProjectDir();

  if (gslothDirExists()) {
    const gslothDirPath = resolve(currentDir, GSLOTH_DIR);
    return resolve(gslothDirPath, filename);
  }

  return resolve(currentDir, filename);
}

/**
 * Gets the path where gsloth should write configuration files based on .gsloth directory existence.
 * The main difference from {@link #getGslothConfigReadPath} is that this getGslothConfigWritePath
 * method creates internal settings directory if it does not exist.
 *
 * If .gsloth dir exists returns `projectdir/.gsloth/.gsloth-settings`
 * If .gsloth dir does not exist returns `projectdir`
 *
 * @param filename The configuration filename
 * @returns The resolved path where the configuration file should be written
 */
export function getGslothConfigWritePath(filename: string): string {
  const currentDir = getProjectDir();

  if (gslothDirExists()) {
    const gslothDirPath = resolve(currentDir, GSLOTH_DIR);
    const gslothSettingsPath = resolve(gslothDirPath, GSLOTH_SETTINGS_DIR);

    // Create .gsloth-settings directory if it doesn't exist
    if (!existsSync(gslothSettingsPath)) {
      mkdirSync(gslothSettingsPath, { recursive: true });
    }

    return resolve(gslothSettingsPath, filename);
  }

  return resolve(currentDir, filename);
}

/**
 * Gets the path where gsloth should look for configuration files based on .gsloth directory existence
 * @param filename The configuration filename to look for
 * @returns The resolved path where the configuration file should be found
 */
export function getGslothConfigReadPath(filename: string): string {
  const projectDir = getProjectDir();
  if (gslothDirExists()) {
    const gslothDirPath = resolve(projectDir, GSLOTH_DIR);
    const gslothSettingsPath = resolve(gslothDirPath, GSLOTH_SETTINGS_DIR);
    const configPath = resolve(gslothSettingsPath, filename);

    if (existsSync(configPath)) {
      return configPath;
    }
  }

  return resolve(projectDir, filename);
}

/**
 * Resolve an explicit output path string to an absolute file path.
 * Concerned only with string values:
 * - If the string includes a path separator, resolve relative to project root and ensure parent directories exist.
 * - If it's a bare filename, place it under .gsloth/ when present, otherwise project root.
 */
export function resolveOutputPath(writeOutputToFile: string): string {
  const currentDir = getProjectDir();
  const provided = String(writeOutputToFile).trim();

  // Detect if provided path contains path separators (cross-platform)
  const hasSeparator = provided.includes('/') || provided.includes('\\');

  // If no separators, treat as bare filename: prefer .gsloth/ when present
  if (!hasSeparator) {
    return getGslothFilePath(provided);
  }

  // If path contains directories, respect as-is and ensure parent dirs
  const absolutePath = resolve(currentDir, provided);
  const parentDir = dirname(absolutePath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }
  return absolutePath;
}

/**
 * Returns the output file path for a given command execution based on configuration.
 * - If writeOutputToFile is false, returns null.
 * - If writeOutputToFile is a string, resolves it without generating a default filename.
 * - If writeOutputToFile is true, generates a standard filename from source and resolves it under .gsloth/ (when present) or project root.
 */
export function getCommandOutputFilePath(config: GthConfig, source: string): string | null {
  const setting = config.writeOutputToFile;

  if (setting === false) {
    return null;
  }

  if (typeof setting === 'string') {
    const trimmed = setting.trim();
    if (trimmed.length === 0) return null;
    return resolveOutputPath(trimmed);
  }

  // setting === true -> generate filename and place it using getGslothFilePath
  const filename = generateStandardFileName(source.toUpperCase());
  return getGslothFilePath(filename);
}
