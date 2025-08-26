import { displayWarning } from '#src/utils/consoleUtils.js';
import { env } from '#src/utils/systemUtils.js';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import type {
  BaseChatModel,
  BaseChatModelParams,
} from '@langchain/core/language_models/chat_models';

import { writeFileIfNotExistsWithMessages } from '#src/utils/fileUtils.js';

// Function to process JSON config and create Google GenAI LLM instance
export async function processJsonConfig(
  llmConfig: ChatGoogleGenerativeAI & BaseChatModelParams
): Promise<BaseChatModel> {
  const gemini = await import('@langchain/google-genai');
  // Use config value if available, otherwise use the environment variable
  const googleApiKey = llmConfig.apiKey || env.GOOGLE_API_KEY;
  return new gemini.ChatGoogleGenerativeAI({
    ...llmConfig,
    apiKey: googleApiKey,
    model: llmConfig.model || 'gemini-2.5-pro',
  });
}

const jsonContent = `{
  "llm": {
    "type": "google-genai",
    "model": "gemini-2.5-pro"
  }
}`;

export function init(configFileName: string): void {
  // Determine which content to use based on file extension
  if (!configFileName.endsWith('.json')) {
    throw new Error('Only JSON config is supported.');
  }

  writeFileIfNotExistsWithMessages(configFileName, jsonContent);
  displayWarning(
    `You need to update your ${configFileName} to add your Google GenAI API key, ` +
      'or define GOOGLE_API_KEY environment variable.'
  );
}
