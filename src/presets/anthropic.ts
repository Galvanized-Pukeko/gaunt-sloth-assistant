import { GthConfig } from '#src/config.js';
import { displayInfo, displayWarning } from '#src/utils/consoleUtils.js';
import { debugLog, debugLogError } from '#src/utils/debugUtils.js';
import { env } from '#src/utils/systemUtils.js';
import type { AnthropicInput } from '@langchain/anthropic';
import type {
  BaseChatModel,
  BaseChatModelParams,
} from '@langchain/core/language_models/chat_models';
import { AIMessage, isAIMessage } from '@langchain/core/messages';
import { BinaryOperatorAggregate, Messages, StateType } from '@langchain/langgraph';

import { writeFileIfNotExistsWithMessages } from '#src/utils/fileUtils.js';

/**
 * Function to process JSON config and create Anthropic LLM instance
 */
// noinspection JSUnusedGlobalSymbols
export async function processJsonConfig(
  llmConfig: AnthropicInput & BaseChatModelParams
): Promise<BaseChatModel> {
  const anthropic = await import('@langchain/anthropic');
  // Use config value if available, otherwise use the environment variable
  const anthropicApiKey = llmConfig.apiKey || env.ANTHROPIC_API_KEY;
  return new anthropic.ChatAnthropic({
    ...llmConfig,
    apiKey: anthropicApiKey,
    model: llmConfig.model || 'claude-sonnet-4-20250514',
  });
}

const jsonContent = `{
  "llm": {
    "type": "anthropic",
    "model": "claude-sonnet-4-20250514"
  }
}`;

// noinspection JSUnusedGlobalSymbols
export function init(configFileName: string): void {
  // Determine which content to use based on file extension
  if (!configFileName.endsWith('.json')) {
    throw new Error('Only JSON config is supported.');
  }

  writeFileIfNotExistsWithMessages(configFileName, jsonContent);
  displayWarning(
    `You need to update your ${configFileName} to add your Anthropic API key, ` +
      'or define ANTHROPIC_API_KEY environment variable.'
  );
}

// noinspection JSUnusedGlobalSymbols
// TODO V1
// export function postProcessJsonConfig(config: GthConfig): GthConfig {
//   // eslint-disable-next-line
//   if ((config.hooks?.postModelHook as any as string) === 'skip') {
//     return {
//       ...config,
//       hooks: { ...config.hooks, postModelHook: undefined },
//     };
//   }
//   displayInfo('Applying Anthropic post-processing to config.');
//   return {
//     ...config,
//     hooks: { ...config.hooks, postModelHook: config.hooks?.postModelHook || postModelHook },
//   };
// }

/**
 * There's something off with calling server tools with ReAct agent,
 * the tool is not added in react_agent_executor because it is not Runnable,
 * but the tool_node explodes because LLM reports calling non-existing tool.
 * This method removes tool calls from messages, leaving the resulting content.
 * This method seems unnecessary with OpenAI, but is needed for Anthropic,
 * OpenAI does not need a name on the tool and does not seem to return server_tool_use.
 */
// TODO V1
// export function postModelHook(
//   state: StateType<{
//     messages: BinaryOperatorAggregate<AIMessage[], Messages>;
//   }>
// ): StateType<{
//   messages: BinaryOperatorAggregate<AIMessage[], Messages>;
// }> {
//   try {
//     const lastMessage = state.messages[state.messages.length - 1];
//     if (isAIMessage(lastMessage) && lastMessage.tool_calls && Array.isArray(lastMessage.content)) {
//       const serverToolsCalled = lastMessage.content
//         .filter(
//           (
//             content
//           ): content is {
//             type: string;
//             name: string;
//           } => content.type == 'server_tool_use' && content.name
//         )
//         .map((content) => content.name);
//       debugLog('found server tool calls ' + serverToolsCalled.join(','));
//       lastMessage.tool_calls = lastMessage.tool_calls.filter(
//         (tc) => !serverToolsCalled.includes(tc.name)
//       );
//     }
//     return state;
//   } catch (e) {
//     debugLogError('removeServerToolCalls error', e);
//     return state;
//   }
// }
