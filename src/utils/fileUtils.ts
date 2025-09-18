import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getInstallDir, getProjectDir } from '#src/utils/systemUtils.js';
import { GSLOTH_DIR, GSLOTH_SETTINGS_DIR } from '#src/constants.js';
import { GthConfig } from '#src/config.js';
import {
  displayError,
  displayInfo,
  displaySuccess,
  displayWarning,
} from '#src/utils/consoleUtils.js';
import url from 'node:url';
import { wrapContent } from '#src/utils/llmUtils.js';

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
 * @param identityProfileRaw The identity profile dir within GSLOTH_SETTINGS_DIR to look for the configuration file in.
 * @returns The resolved path where the configuration file should be found
 */
export function getGslothConfigReadPath(
  filename: string,
  identityProfileRaw: string | undefined
): string {
  const projectDir = getProjectDir();
  const identityProfile = identityProfileRaw?.trim();
  if (gslothDirExists()) {
    const gslothDirPath = resolve(projectDir, GSLOTH_DIR);
    const gslothSettingsPath = resolve(gslothDirPath, GSLOTH_SETTINGS_DIR);
    const configPath = identityProfile
      ? resolve(gslothSettingsPath, identityProfile, filename)
      : resolve(gslothSettingsPath, filename);

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

export function toFileSafeString(string: string): string {
  return string.replace(/[^A-Za-z0-9]/g, '-');
}

/**
 * Returns a formatted date string in the format YYYY-MM-DD_HH-MM-SS using local time
 * @returns A formatted date string
 */
export function fileSafeLocalDate(): string {
  const date = new Date();

  // Format: YYYY-MM-DD_HH-MM-SS using local time directly
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

/**
 * Generates a standardized filename with the format: gth_YYYY-MM-DD_HH-MM-SS_COMMAND.md
 * @param command - The command that created the file (ASK, REVIEW, PR, etc.)
 * @returns A standardized filename string
 */
export function generateStandardFileName(command: string): string {
  const dateTimeStr = fileSafeLocalDate();
  const commandStr = toFileSafeString(command.toUpperCase());

  return `gth_${dateTimeStr}_${commandStr}.md`;
}

export function readFileFromProjectDir(fileName: string): string {
  const currentDir = getProjectDir();
  const filePath = resolve(currentDir, fileName);
  displayInfo(`Reading file ${filePath}...`);
  return readFileSyncWithMessages(filePath);
}

export function readFileFromInstallDir(filePath: string): string {
  const installDir = getInstallDir();
  const installFilePath = resolve(installDir, filePath);
  try {
    return readFileSync(installFilePath, { encoding: 'utf8' });
  } catch (readFromInstallDirError) {
    displayError(`The ${installFilePath} not found or can\'t be read.`);
    throw readFromInstallDirError;
  }
}

export function writeFileIfNotExistsWithMessages(filePath: string, content: string): void {
  displayInfo(`checking ${filePath} existence`);
  if (!existsSync(filePath)) {
    // Create parent directories if they don't exist
    const parentDir = dirname(filePath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
    writeFileSync(filePath, content);
    displaySuccess(`Created ${filePath}`);
  } else {
    displayWarning(`${filePath} already exists`);
  }
}

export function appendToFile(filePath: string, content: string): void {
  try {
    const parentDir = dirname(filePath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
    appendFileSync(filePath, content);
  } catch (e) {
    displayError(`Failed to append to file ${filePath}: ${(e as Error).message}`);
  }
}

export function readFileSyncWithMessages(
  filePath: string,
  errorMessageIn?: string,
  noFileMessage?: string
): string {
  const errorMessage = errorMessageIn ?? 'Error reading file at: ';
  try {
    return readFileSync(filePath, { encoding: 'utf8' });
  } catch (error) {
    displayError(errorMessage + filePath);
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      displayWarning(noFileMessage ?? 'Please ensure the file exists.');
    } else {
      displayError((error as Error).message);
    }
    throw error;
  }
}

/**
 * Dynamically imports a module from a file path from the outside of the installation dir
 * @returns A promise that resolves to the imported module
 */
export function importExternalFile(
  filePath: string
): Promise<{ configure: () => Promise<Partial<GthConfig>> }> {
  const configFileUrl = url.pathToFileURL(filePath).toString();
  return import(configFileUrl);
}

/**
 * Reads multiple files from the current directory and returns their contents
 * @param fileNames - Array of file names to read
 * @returns Combined content of all files with proper formatting, each file is wrapped in random block like <file-abvesde>
 */
export function readMultipleFilesFromProjectDir(fileNames: string | string[]): string {
  if (!Array.isArray(fileNames)) {
    return wrapContent(readFileFromProjectDir(fileNames), 'file', `file ${fileNames}`, true);
  }

  return fileNames
    .map((fileName) => {
      const content = readFileFromProjectDir(fileName);
      return `${wrapContent(content, 'file', `file ${fileName}`, true)}`;
    })
    .join('\n\n');
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
