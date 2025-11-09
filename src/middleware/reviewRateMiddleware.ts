/**
 * @packageDocumentation
 * Middleware responsible for generating review ratings after the agent finishes.
 *
 * The middleware runs an additional model call that summarizes the review outcome
 * and stores the structured result inside the global artifact store.
 */

import { HumanMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { createAgent, createMiddleware, type AgentMiddleware } from 'langchain';
import * as z from 'zod';

import type { GthConfig, RatingConfig } from '#src/config.js';
import { setArtifact, deleteArtifact } from '#src/state/artifactStore.js';
import { debugLog, debugLogError } from '#src/utils/debugUtils.js';
import { getNewRunnableConfig } from '#src/utils/llmUtils.js';

/**
 * Schema describing the result of the review rating step.
 */
export const RateSchema = z.object({
  rate: z.number().min(0).max(10).describe('Review rating from 0 to 10'),
  comment: z.string().describe('Comment explaining the rating'),
});

/**
 * Type representing a review rating response.
 */
export type RateResponse = z.infer<typeof RateSchema>;

export interface ReviewRatingArtifact extends RateResponse {
  passThreshold: number;
  minRating: number;
  maxRating: number;
}

export const REVIEW_RATE_ARTIFACT_KEY = 'gsloth.review.rate';

const DEFAULT_MIN_RATING = 0;
const DEFAULT_MAX_RATING = 10;
const DEFAULT_PASS_THRESHOLD = 6;

interface NormalizedRatingConfig {
  minRating: number;
  maxRating: number;
  passThreshold: number;
}

export type ReviewRateMiddlewareSettings = RatingConfig & {
  name?: 'review-rate';
};

export function normalizeRatingConfig(config: RatingConfig | undefined): NormalizedRatingConfig {
  const min = config?.minRating ?? DEFAULT_MIN_RATING;
  const max = config?.maxRating ?? DEFAULT_MAX_RATING;
  const [minRating, maxRating] = min <= max ? [min, max] : [max, min];
  const threshold = config?.passThreshold ?? DEFAULT_PASS_THRESHOLD;

  return {
    minRating,
    maxRating,
    passThreshold: clamp(threshold, minRating, maxRating),
  };
}

const REVIEW_RATE_TOOL_NAME = 'gth_review_rate';

export function createReviewRateMiddleware(
  settings: ReviewRateMiddlewareSettings,
  gthConfig: GthConfig
): Promise<AgentMiddleware> {
  const normalizedConfig = normalizeRatingConfig(settings);

  const rateTool = tool(
    (input: RateResponse) => {
      const artifact: ReviewRatingArtifact = {
        ...input,
        ...normalizedConfig,
      };
      setArtifact(REVIEW_RATE_ARTIFACT_KEY, artifact);

      return `Stored rating ${input.rate}/${normalizedConfig.maxRating}`;
    },
    {
      name: REVIEW_RATE_TOOL_NAME,
      description: 'Stores the final review rating and summary comment.',
      schema: RateSchema,
    }
  );

  const ratingAgent = createAgent({
    model: gthConfig.llm,
    tools: [rateTool],
  });

  return Promise.resolve(
    createMiddleware({
      name: 'review-rate',
      afterAgent: async (state) => {
        if (!Array.isArray(state.messages) || state.messages.length === 0) {
          return state;
        }

        deleteArtifact(REVIEW_RATE_ARTIFACT_KEY);

        const ratingPrompt = buildRatingInstructions(normalizedConfig);

        debugLog('ReviewRateMiddleware: requesting rating evaluation');

        try {
          const ratingMessages = [...state.messages, new HumanMessage(ratingPrompt)];

          await ratingAgent.invoke(
            {
              messages: ratingMessages,
            },
            getNewRunnableConfig()
          );
        } catch (error) {
          debugLogError('ReviewRateMiddleware.invoke', error);
        }

        return state;
      },
    })
  );
}

function buildRatingInstructions(config: NormalizedRatingConfig): string {
  const formattedThreshold = formatScore(config.passThreshold);
  const formattedMax = formatScore(config.maxRating);
  const formattedMin = formatScore(config.minRating);
  const middle = formatScore((config.passThreshold + config.maxRating) / 2);

  return [
    'A reviewer just finished assessing a code change.',
    'Your job is to inspect the entire conversation above, focus on the code being discussed (not the review quality),',
    'and call the ' + REVIEW_RATE_TOOL_NAME + ' tool exactly once.',
    `Assign a score between ${formattedMin}-${formattedMax} that reflects the code quality only.`,
    `Pass threshold is ${formattedThreshold}, everything below will be considered a fail.`,
    '',
    'Additional guidelines:',
    `- Never give ${formattedThreshold}/${formattedMax} or more to code which would explode with syntax error.`,
    `- Rate excellent code as ${formattedMax}/${formattedMax}`,
    `- Rate code needing improvements as ${middle}/${formattedMax}`,
    '- Use the comment field of the tool call for a concise summary referencing the code state.',
  ].join('\n');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
