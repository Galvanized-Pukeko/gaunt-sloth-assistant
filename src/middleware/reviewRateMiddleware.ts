/**
 * @packageDocumentation
 * Middleware responsible for generating review ratings after the agent finishes.
 *
 * The middleware runs an additional model call that summarizes the review outcome
 * and stores the structured result inside the global artifact store.
 */

import type { BaseMessage } from '@langchain/core/messages';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
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
      name: 'gth_review_rate',
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

        const conversation = renderConversation(state.messages);
        const instructions = buildRatingInstructions(normalizedConfig);

        debugLog('ReviewRateMiddleware: requesting rating evaluation');

        try {
          await ratingAgent.invoke(
            {
              messages: [
                new SystemMessage(instructions),
                new HumanMessage(
                  [
                    'Below is the full conversation that produced the final review.',
                    'Read it carefully and determine the correct rating.',
                    conversation,
                    'Call the gth_review_rate tool exactly once with your numeric rating and short summary.',
                  ].join('\n\n')
                ),
              ],
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
    `At the end of the review you need to provide your rating (${formattedMin}-${formattedMax}) for the code and give a final short summary.`,
    `Pass threshold is ${formattedThreshold}, everything below will be considered a fail.`,
    '',
    'Additional guidelines:',
    `- Never give ${formattedThreshold}/${formattedMax} or more to code which would explode with syntax error.`,
    `- Rate excellent code as ${formattedMax}/${formattedMax}`,
    `- Rate code needing improvements as ${middle}/${formattedMax}`,
    '- Use the comment field of the tool call for the short summary.',
  ].join('\n');
}

function renderConversation(messages: BaseMessage[]): string {
  return messages
    .map((message) => {
      const role = message._getType().toUpperCase();
      const content = formatMessageContent(message);
      return `${role}:\n${content}`;
    })
    .join('\n\n---\n\n');
}

function formatMessageContent(message: BaseMessage): string {
  const { content } = message;
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if ('text' in part && part.text) {
          return part.text;
        }
        if ('type' in part) {
          return `${part.type}: ${JSON.stringify(part, null, 2)}`;
        }
        return JSON.stringify(part);
      })
      .join('\n');
  }

  return JSON.stringify(content);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
