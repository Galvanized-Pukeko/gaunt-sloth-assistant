import { initChatModel } from "../../chat_models/universal.js";
import { hasToolCalls } from "../utils.js";
import { countTokensApproximately } from "./utils.js";
import { createMiddleware } from "../middleware.js";
import { RemoveMessage, SystemMessage, ToolMessage, trimMessages } from "@langchain/core/messages";
import { REMOVE_ALL_MESSAGES } from "@langchain/langgraph";
import { z } from "zod/v3";
import { interopParse } from "@langchain/core/utils/types";
import { v4 } from "uuid";

//#region src/agents/middleware/summarization.ts
const DEFAULT_SUMMARY_PROMPT = `<role>
Context Extraction Assistant
</role>

<primary_objective>
Your sole objective in this task is to extract the highest quality/most relevant context from the conversation history below.
</primary_objective>

<objective_information>
You're nearing the total number of input tokens you can accept, so you must extract the highest quality/most relevant pieces of information from your conversation history.
This context will then overwrite the conversation history presented below. Because of this, ensure the context you extract is only the most important information to your overall goal.
</objective_information>

<instructions>
The conversation history below will be replaced with the context you extract in this step. Because of this, you must do your very best to extract and record all of the most important context from the conversation history.
You want to ensure that you don't repeat any actions you've already completed, so the context you extract from the conversation history should be focused on the most important information to your overall goal.
</instructions>

The user will message you with the full message history you'll be extracting context from, to then replace. Carefully read over it all, and think deeply about what information is most important to your overall goal that should be saved:

With all of this in mind, please carefully read over the entire conversation history, and extract the most important and relevant context to replace it so that you can free up space in the conversation history.
Respond ONLY with the extracted context. Do not include any additional information, or text before or after the extracted context.

<messages>
Messages to summarize:
{messages}
</messages>`;
const SUMMARY_PREFIX = "## Previous conversation summary:";
const DEFAULT_MESSAGES_TO_KEEP = 20;
const DEFAULT_TRIM_TOKEN_LIMIT = 4e3;
const DEFAULT_FALLBACK_MESSAGE_COUNT = 15;
const SEARCH_RANGE_FOR_TOOL_PAIRS = 5;
const contextSchema = z.object({
	model: z.custom(),
	maxTokensBeforeSummary: z.number().optional(),
	messagesToKeep: z.number().default(DEFAULT_MESSAGES_TO_KEEP),
	tokenCounter: z.function().args(z.array(z.any())).returns(z.union([z.number(), z.promise(z.number())])).optional(),
	summaryPrompt: z.string().default(DEFAULT_SUMMARY_PROMPT),
	summaryPrefix: z.string().default(SUMMARY_PREFIX)
});
/**
* Summarization middleware that automatically summarizes conversation history when token limits are approached.
*
* This middleware monitors message token counts and automatically summarizes older
* messages when a threshold is reached, preserving recent messages and maintaining
* context continuity by ensuring AI/Tool message pairs remain together.
*
* @param options Configuration options for the summarization middleware
* @returns A middleware instance
*
* @example
* ```ts
* import { summarizationMiddleware } from "langchain";
* import { createAgent } from "langchain";
*
* const agent = createAgent({
*   llm: model,
*   tools: [getWeather],
*   middleware: [
*     summarizationMiddleware({
*       model: new ChatOpenAI({ model: "gpt-4o" }),
*       maxTokensBeforeSummary: 4000,
*       messagesToKeep: 20,
*     })
*   ],
* });
*
* ```
*/
function summarizationMiddleware(options) {
	return createMiddleware({
		name: "SummarizationMiddleware",
		contextSchema: contextSchema.extend({ model: z.custom().optional() }),
		beforeModel: async (state, runtime) => {
			/**
			* Parse user options to get their explicit values
			*/
			const userOptions = interopParse(contextSchema, options);
			/**
			* Merge context with user options, preferring user options when context has default values
			*/
			const config = {
				model: userOptions.model,
				maxTokensBeforeSummary: runtime.context.maxTokensBeforeSummary !== void 0 ? runtime.context.maxTokensBeforeSummary : userOptions.maxTokensBeforeSummary,
				messagesToKeep: runtime.context.messagesToKeep === DEFAULT_MESSAGES_TO_KEEP ? userOptions.messagesToKeep : runtime.context.messagesToKeep ?? userOptions.messagesToKeep,
				tokenCounter: runtime.context.tokenCounter !== void 0 ? runtime.context.tokenCounter : userOptions.tokenCounter,
				summaryPrompt: runtime.context.summaryPrompt === DEFAULT_SUMMARY_PROMPT ? userOptions.summaryPrompt : runtime.context.summaryPrompt ?? userOptions.summaryPrompt,
				summaryPrefix: runtime.context.summaryPrefix === SUMMARY_PREFIX ? userOptions.summaryPrefix : runtime.context.summaryPrefix ?? userOptions.summaryPrefix
			};
			const { messages } = state;
			const model = typeof config.model === "string" ? await initChatModel(config.model) : config.model;
			ensureMessageIds(messages);
			const tokenCounter = config.tokenCounter || countTokensApproximately;
			const totalTokens = await tokenCounter(messages);
			if (config.maxTokensBeforeSummary == null || totalTokens < config.maxTokensBeforeSummary) return;
			const { systemPrompt, conversationMessages } = splitSystemMessage(messages);
			const cutoffIndex = findSafeCutoff(conversationMessages, config.messagesToKeep);
			if (cutoffIndex <= 0) return;
			const { messagesToSummarize, preservedMessages } = partitionMessages(systemPrompt, conversationMessages, cutoffIndex);
			const summary = await createSummary(messagesToSummarize, model, config.summaryPrompt, tokenCounter);
			const updatedSystemMessage = buildUpdatedSystemMessage(systemPrompt, summary, config.summaryPrefix);
			return { messages: [
				new RemoveMessage({ id: REMOVE_ALL_MESSAGES }),
				updatedSystemMessage,
				...preservedMessages
			] };
		}
	});
}
/**
* Ensure all messages have unique IDs
*/
function ensureMessageIds(messages) {
	for (const msg of messages) if (!msg.id) msg.id = v4();
}
/**
* Separate system message from conversation messages
*/
function splitSystemMessage(messages) {
	if (messages.length > 0 && SystemMessage.isInstance(messages[0])) return {
		systemPrompt: messages[0],
		conversationMessages: messages.slice(1)
	};
	return {
		systemPrompt: null,
		conversationMessages: messages
	};
}
/**
* Partition messages into those to summarize and those to preserve
*/
function partitionMessages(systemPrompt, conversationMessages, cutoffIndex) {
	const messagesToSummarize = conversationMessages.slice(0, cutoffIndex);
	const preservedMessages = conversationMessages.slice(cutoffIndex);
	if (systemPrompt) messagesToSummarize.unshift(systemPrompt);
	return {
		messagesToSummarize,
		preservedMessages
	};
}
/**
* Build updated system message incorporating the summary
*/
function buildUpdatedSystemMessage(originalSystemMessage, summary, summaryPrefix) {
	let originalContent = "";
	if (originalSystemMessage) {
		const { content: content$1 } = originalSystemMessage;
		if (typeof content$1 === "string") originalContent = content$1.split(summaryPrefix)[0].trim();
	}
	const content = originalContent ? `${originalContent}\n${summaryPrefix}\n${summary}` : `${summaryPrefix}\n${summary}`;
	return new SystemMessage({
		content,
		id: originalSystemMessage?.id || v4()
	});
}
/**
* Find safe cutoff point that preserves AI/Tool message pairs
*/
function findSafeCutoff(messages, messagesToKeep) {
	if (messages.length <= messagesToKeep) return 0;
	const targetCutoff = messages.length - messagesToKeep;
	for (let i = targetCutoff; i >= 0; i--) if (isSafeCutoffPoint(messages, i)) return i;
	return 0;
}
/**
* Check if cutting at index would separate AI/Tool message pairs
*/
function isSafeCutoffPoint(messages, cutoffIndex) {
	if (cutoffIndex >= messages.length) return true;
	const searchStart = Math.max(0, cutoffIndex - SEARCH_RANGE_FOR_TOOL_PAIRS);
	const searchEnd = Math.min(messages.length, cutoffIndex + SEARCH_RANGE_FOR_TOOL_PAIRS);
	for (let i = searchStart; i < searchEnd; i++) {
		if (!hasToolCalls(messages[i])) continue;
		const toolCallIds = extractToolCallIds(messages[i]);
		if (cutoffSeparatesToolPair(messages, i, cutoffIndex, toolCallIds)) return false;
	}
	return true;
}
/**
* Extract tool call IDs from an AI message
*/
function extractToolCallIds(aiMessage) {
	const toolCallIds = /* @__PURE__ */ new Set();
	if (aiMessage.tool_calls) for (const toolCall of aiMessage.tool_calls) {
		const id = typeof toolCall === "object" && "id" in toolCall ? toolCall.id : null;
		if (id) toolCallIds.add(id);
	}
	return toolCallIds;
}
/**
* Check if cutoff separates an AI message from its corresponding tool messages
*/
function cutoffSeparatesToolPair(messages, aiMessageIndex, cutoffIndex, toolCallIds) {
	for (let j = aiMessageIndex + 1; j < messages.length; j++) {
		const message = messages[j];
		if (ToolMessage.isInstance(message) && toolCallIds.has(message.tool_call_id)) {
			const aiBeforeCutoff = aiMessageIndex < cutoffIndex;
			const toolBeforeCutoff = j < cutoffIndex;
			if (aiBeforeCutoff !== toolBeforeCutoff) return true;
		}
	}
	return false;
}
/**
* Generate summary for the given messages
*/
async function createSummary(messagesToSummarize, model, summaryPrompt, tokenCounter) {
	if (!messagesToSummarize.length) return "No previous conversation history.";
	const trimmedMessages = await trimMessagesForSummary(messagesToSummarize, tokenCounter);
	if (!trimmedMessages.length) return "Previous conversation was too long to summarize.";
	try {
		const formattedPrompt = summaryPrompt.replace("{messages}", JSON.stringify(trimmedMessages, null, 2));
		const response = await model.invoke(formattedPrompt);
		const { content } = response;
		return typeof content === "string" ? content.trim() : "Error generating summary: Invalid response format";
	} catch (e) {
		return `Error generating summary: ${e}`;
	}
}
/**
* Trim messages to fit within summary generation limits
*/
async function trimMessagesForSummary(messages, tokenCounter) {
	try {
		return await trimMessages(messages, {
			maxTokens: DEFAULT_TRIM_TOKEN_LIMIT,
			tokenCounter: async (msgs) => Promise.resolve(tokenCounter(msgs)),
			strategy: "last",
			allowPartial: true,
			includeSystem: true
		});
	} catch {
		return messages.slice(-DEFAULT_FALLBACK_MESSAGE_COUNT);
	}
}

//#endregion
export { summarizationMiddleware };
//# sourceMappingURL=summarization.js.map