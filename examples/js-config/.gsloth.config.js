/**
 * Example JavaScript configuration with custom middleware and custom tool
 * This demonstrates how to extend Gaunt Sloth with custom logging middleware
 * and custom tools that aren't available in JSON configs.
 */

import { createMiddleware } from 'langchain';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ChatVertexAI } from '@langchain/google-vertexai';

/**
 * Custom middleware that logs all lifecycle events
 * Middleware provides hooks at key points in agent execution
 */
const loggingMiddleware = createMiddleware({
  name: 'custom-logging',

  beforeAgent(state) {
    console.log('🚀 [Middleware] beforeAgent - Agent execution starting');
    console.log(
      `   Input: ${JSON.stringify(state.messages?.slice(-1)[0]?.content || 'N/A').substring(0, 100)}...`
    );
    return state;
  },

  beforeModel(state) {
    console.log('🤖 [Middleware] beforeModel - About to call LLM');
    console.log(`   Messages count: ${state.messages?.length || 0}`);
    return state;
  },

  afterModel(state) {
    console.log('✅ [Middleware] afterModel - LLM responded');
    const lastMessage = state.messages?.slice(-1)[0];
    if (lastMessage?.content) {
      const preview =
        typeof lastMessage.content === 'string'
          ? lastMessage.content.substring(0, 100)
          : JSON.stringify(lastMessage.content).substring(0, 100);
      console.log(`   Response preview: ${preview}...`);
    }
    return state;
  },

  afterAgent(state) {
    console.log('🏁 [Middleware] afterAgent - Agent execution complete');
    console.log(`   Final message count: ${state.messages?.length || 0}`);
    return state;
  },
});

/**
 * Custom tool similar to gthStatusUpdateTool
 * This is a simple logger tool that can be called by the agent
 */
function createCustomLoggerTool() {
  const toolDefinition = {
    name: 'custom_logger',
    description:
      'Custom Logger Tool. Use this tool to log important information during execution. Example: custom_logger("Processing data..."). Be brief and use emojis if appropriate.',
    schema: z.object({
      message: z.string().describe('The message to log'),
      level: z
        .enum(['info', 'warning', 'success'])
        .optional()
        .describe('Log level (default: info)'),
    }),
  };

  const toolImpl = (input) => {
    const { message, level = 'info' } = input;

    const icons = {
      info: 'ℹ️',
      warning: '⚠️',
      success: '✅',
    };

    const icon = icons[level] || icons.info;
    console.log(`${icon} [Custom Tool] ${message}`);

    return `Logged: ${message}`;
  };

  return tool(toolImpl, toolDefinition);
}

/**
 * Main configuration function
 * This is the entry point that Gaunt Sloth calls to load your config
 */
export async function configure() {
  // Create the LLM instance
  const llm = new ChatVertexAI({
    model: 'gemini-2.5-pro',
    temperature: 0,
  });

  // Return the configuration
  return {
    llm,

    // Add custom middleware to the middleware array
    middleware: [
      'anthropic-prompt-caching', // Built-in middleware
      loggingMiddleware, // Custom middleware
    ],

    // Add custom tools
    tools: [createCustomLoggerTool()],

    // Optional: Configure commands
    commands: {
      chat: {
        // Enable file system tools for chat mode
        filesystem: 'read',
        // Include the custom logger tool and status update tool
        builtInTools: ['gth_status_update'],
      },
      code: {
        filesystem: 'all',
        builtInTools: ['gth_status_update'],
      },
    },
  };
}
