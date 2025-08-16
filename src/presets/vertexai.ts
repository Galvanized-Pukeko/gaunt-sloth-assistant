import { displayWarning } from '#src/utils/consoleUtils.js';
import { writeFileIfNotExistsWithMessages } from '#src/utils/utils.js';
import { ChatVertexAIInput } from '@langchain/google-vertexai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

const jsonContent = `{
  "llm": {
    "type": "vertexai",
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
    'For Google VertexAI you likely to need to do `gcloud auth login` and `gcloud auth application-default login`.'
  );
}

// Function to process JSON config and create VertexAI LLM instance
export async function processJsonConfig(llmConfig: ChatVertexAIInput): Promise<BaseChatModel> {
  const vertexAi = await import('@langchain/google-vertexai');
  return new vertexAi.ChatVertexAI({
    ...llmConfig,
    model: llmConfig.model || 'gemini-2.5-pro',
  });
}
