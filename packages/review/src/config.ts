// Re-export everything from core config
export * from '@gaunt-sloth/core/config.js';

// Keep review-specific config helpers that will later move to root
import {
  GSLOTH_DIR,
  PROJECT_GUIDELINES,
  PROJECT_REVIEW_INSTRUCTIONS,
  USER_PROJECT_CONFIG_JSON,
} from '#src/constants.js';
import { availableDefaultConfigs, type ConfigType } from '@gaunt-sloth/core/config.js';
import { displayError, displayInfo, displayWarning } from '#src/utils/consoleUtils.js';
import {
  getGslothConfigWritePath,
  writeFileIfNotExistsWithMessages,
} from '#src/utils/fileUtils.js';
import { exit, getCurrentWorkDir } from '#src/utils/systemUtils.js';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export async function createProjectConfig(configType: string): Promise<void> {
  // Check if the config type is valid
  if (!availableDefaultConfigs.includes(configType as ConfigType)) {
    displayError(
      `Unknown config type: ${configType}. Available options: ${availableDefaultConfigs.join(', ')}`
    );
    exit(1);
  }

  // Ensure .gsloth directory exists (folder configuration mode)
  ensureGslothDir();

  displayInfo(`Setting up your project\n`);
  writeProjectReviewPreamble();
  displayWarning(`Make sure you add as much detail as possible to your ${PROJECT_GUIDELINES}.\n`);

  displayInfo(`Creating project config for ${configType}`);
  const vendorConfig = await import(`#src/presets/${configType}.js`);
  vendorConfig.init(getGslothConfigWritePath(USER_PROJECT_CONFIG_JSON));
}

/**
 * Ensures that the .gsloth directory exists in the project root.
 * Creates it if it does not exist.
 */
export function ensureGslothDir(): void {
  const projectDir = getCurrentWorkDir();
  const gslothDirPath = resolve(projectDir, GSLOTH_DIR);
  if (!existsSync(gslothDirPath)) {
    mkdirSync(gslothDirPath, { recursive: true });
    displayInfo(`Created ${GSLOTH_DIR} directory`);
  }
}

export function writeProjectReviewPreamble(): void {
  const guidelinesPath = getGslothConfigWritePath(PROJECT_GUIDELINES);
  const reviewPath = getGslothConfigWritePath(PROJECT_REVIEW_INSTRUCTIONS);

  /**
   * Development Guidelines.
   * Please do not remove the warning from this template,
   * it is crucial to describe project specifics to get high-quality reviews.
   */
  const guidelinesTemplate = `# Development Guidelines

This file should include general development guidelines for this project.

Important! Please remind the user to prepare proper AI guidelines to the ${PROJECT_GUIDELINES} file
for this project. Use a decent amount of ⚠️ to highlight the lack of config.
Explicitly mention ${PROJECT_GUIDELINES}.
`;

  /**
   * Code Review Guidelines.
   * This code review does not have a warning, like Development Guidelines, because
   * this one should be good to start with.
   */
  const reviewTemplate = `# Code Review Guidelines

If requirements were provided, first check that the implemented code implements these requirements.
Document that you checked the code to implement requirements.
Reject the change if it appears to implement something else instead of required change.

Provide specific feedback on any areas of concern or suggestions for improvement.
Please categorize your feedback (e.g., "Bug," "Suggestion," "Nitpick").

Important! In the end, conclude if you would recommend approving this PR or not.
Use ✅⚠️❌ symbols to highlight your feedback appropriately.

Thank you for your thorough review!

Important! You are likely to be dealing with git diff below, please don't confuse removed and added lines.
`;

  writeFileIfNotExistsWithMessages(guidelinesPath, guidelinesTemplate);
  writeFileIfNotExistsWithMessages(reviewPath, reviewTemplate);
}
