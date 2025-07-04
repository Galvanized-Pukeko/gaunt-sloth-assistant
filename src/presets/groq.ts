import path from 'node:path';
import { displayWarning } from '#src/consoleUtils.js';
import { env, getCurrentDir } from '#src/systemUtils.js';
import { writeFileIfNotExistsWithMessages } from '#src/utils.js';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatGroqInput } from '@langchain/groq';

// Function to process JSON config and create Groq LLM instance
export async function processJsonConfig(llmConfig: ChatGroqInput): Promise<BaseChatModel> {
  const groq = await import('@langchain/groq');
  // Use config value if available, otherwise use the environment variable
  const groqApiKey = llmConfig.apiKey || env.GROQ_API_KEY;
  return new groq.ChatGroq({
    ...llmConfig,
    apiKey: groqApiKey,
    model: llmConfig.model || 'deepseek-r1-distill-llama-70b',
  });
}

const jsonContent = `{
  "llm": {
    "type": "groq",
    "model": "deepseek-r1-distill-llama-70b"
  }
}`;

export function init(configFileName: string): void {
  const currentDir = getCurrentDir();
  path.join(currentDir, configFileName);

  // Determine which content to use based on file extension
  if (!configFileName.endsWith('.json')) {
    throw new Error('Only JSON config is supported.');
  }

  writeFileIfNotExistsWithMessages(configFileName, jsonContent);
  displayWarning(
    `You need to edit your ${configFileName} to configure model, ` +
      'or define GROQ_API_KEY environment variable.'
  );
}
