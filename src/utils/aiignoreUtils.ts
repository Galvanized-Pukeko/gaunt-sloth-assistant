/**
 * @packageDocumentation
 * AI Ignore utility functions for handling .aiignore files.
 * Provides functionality similar to .gitignore for filtering files.
 */

import { AIIGNORE_FILE } from '#src/constants.js';
import { existsSync, readFileSync } from 'node:fs';
import { minimatch } from 'minimatch';
import path from 'node:path';
import { debugLog } from '#src/utils/debugUtils.js';

/**
 * Load .aiignore patterns from file
 * @param rootDir - The root directory to look for .aiignore file
 * @returns Array of ignore patterns
 */
export function loadAiignorePatterns(rootDir: string): string[] {
  const aiignorePath = path.join(rootDir, AIIGNORE_FILE);

  if (!existsSync(aiignorePath)) {
    debugLog(`No ${AIIGNORE_FILE} file found at ${aiignorePath}`);
    return [];
  }

  try {
    const content = readFileSync(aiignorePath, 'utf-8');
    const patterns = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));

    debugLog(`Loaded ${patterns.length} patterns from ${AIIGNORE_FILE}`);
    return patterns;
  } catch (error) {
    debugLog(
      `Error reading ${AIIGNORE_FILE}: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

/**
 * Check if a file path should be ignored based on aiignore patterns
 * @param filePath - The file path to check
 * @param rootDir - The root directory for relative pattern matching
 * @param customPatterns - Optional custom patterns to use instead of loading from file
 * @param enabled - Whether aiignore is enabled
 * @returns True if the file should be ignored, false otherwise
 */
export function shouldIgnoreFile(
  filePath: string,
  rootDir: string,
  customPatterns: string[] | undefined = undefined,
  enabled: boolean = true
): boolean {
  if (!enabled) {
    return false;
  }

  // Get patterns from custom config or load from file
  const patterns = customPatterns ?? loadAiignorePatterns(rootDir);

  if (patterns.length === 0) {
    return false;
  }

  // Convert file path to relative path for pattern matching
  const relativePath = path.relative(rootDir, filePath);

  // Check if any pattern matches
  for (const pattern of patterns) {
    try {
      if (minimatch(relativePath, pattern, { dot: true })) {
        debugLog(`File ignored by pattern '${pattern}': ${relativePath}`);
        return true;
      }
    } catch (error) {
      debugLog(
        `Error matching pattern '${pattern}': ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return false;
}

/**
 * Filter an array of file paths based on aiignore patterns
 * @param filePaths - Array of file paths to filter
 * @param rootDir - The root directory for relative pattern matching
 * @param customPatterns - Optional custom patterns to use instead of loading from file
 * @param enabled - Whether aiignore is enabled
 * @returns Filtered array of file paths that should not be ignored
 */
export function filterIgnoredFiles(
  filePaths: string[],
  rootDir: string,
  customPatterns: string[] | undefined = undefined,
  enabled: boolean = true
): string[] {
  if (!enabled) {
    return filePaths;
  }

  return filePaths.filter(
    (filePath) => !shouldIgnoreFile(filePath, rootDir, customPatterns, enabled)
  );
}
