/**
 * @packageDocumentation
 * Rating Schema for Review Commands
 *
 * Defines the structured response format for review rating functionality.
 */

import * as z from 'zod';
import type { RatingConfig } from '#src/config.js';
import type { GthCommand } from '#src/core/types.js';

/**
 * Schema for review rating response.
 * Used when rating is enabled for review/pr commands.
 */
export const RateSchema = z.object({
  rate: z.number().min(0).max(10).describe('Review rating from 0 to 10'),
  comment: z.string().describe('Comment explaining the rating'),
});

/**
 * Type representing a review rating response.
 */
export type RateResponse = z.infer<typeof RateSchema>;

/**
 * Checks if rating is enabled for the given command and configuration.
 *
 * @param command - The command being executed
 * @param ratingConfig - The rating configuration for the command
 * @returns true if rating should be enabled, false otherwise
 */
export function isRatingEnabled(
  command: GthCommand | undefined,
  ratingConfig: RatingConfig | undefined
): boolean {
  // Rating only applies to review and pr commands
  if (!command || (command !== 'review' && command !== 'pr')) {
    return false;
  }

  // Rating is enabled if config exists and enabled is not explicitly false (default: true)
  return ratingConfig !== undefined && (ratingConfig.enabled ?? true);
}
