import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { displayWarning } from '#src/utils/consoleUtils.js';
import type { FakeChatInput } from '@langchain/core/utils/testing';

// Function to process JSON config and create Fake LLM instance for testing
export async function processJsonConfig(llmConfig: FakeChatInput): Promise<BaseChatModel | null> {
  if (llmConfig.responses) {
    const test = await import('@langchain/core/utils/testing');
    return new test.FakeListChatModel(llmConfig);
  }
  displayWarning("Fake LLM requires 'responses' array in config");
  return null;
}

// No init function needed for fake LLM as it's only used for testing
