// TODO v1
// import { GthConfig } from '#src/config.js';
// import { AIMessage, BaseMessage } from '@langchain/core/messages';
// import { beforeEach, describe, expect, it, vi } from 'vitest';
//
// const consoleUtilsMock = {
//   displayInfo: vi.fn(),
//   displayWarning: vi.fn(),
// };
// vi.mock('#src/utils/consoleUtils.js', () => consoleUtilsMock);
//
// const debugUtilsMock = {
//   debugLog: vi.fn(),
//   debugLogError: vi.fn(),
// };
// vi.mock('#src/utils/debugUtils.js', () => debugUtilsMock);
//
// describe('anthropic preset', () => {
//   beforeEach(() => {
//     vi.resetAllMocks();
//   });
//
//   describe('postModelHook', () => {
//     it('should return state as is if last message is not an AI message', async () => {
//       const { postModelHook } = await import('#src/presets/anthropic.js');
//       const state = { messages: [{ content: 'not an AI message' } as BaseMessage] };
//       const result = postModelHook(state);
//       expect(result).toEqual(state);
//     });
//
//     it('should return state as is if tool_calls is missing', async () => {
//       const { postModelHook } = await import('#src/presets/anthropic.js');
//       const state = { messages: [new AIMessage({ content: 'AI message' })] };
//       const result = postModelHook(state);
//       expect(result).toEqual(state);
//     });
//
//     it('should filter out server tool calls', async () => {
//       const { postModelHook } = await import('#src/presets/anthropic.js');
//       const state = {
//         messages: [
//           new AIMessage({
//             content: [],
//             tool_calls: [
//               { name: 'search', args: {}, id: '1' },
//               { name: 'web_search', args: {}, id: '2' },
//             ],
//           }),
//         ],
//       };
//
//       const lastMessage = state.messages[0] as AIMessage;
//
//       lastMessage.content = [
//         { type: 'text', text: 'some text' },
//         { type: 'server_tool_use', name: 'web_search' },
//       ];
//
//       const result = postModelHook(state);
//
//       const postModelMessage = result.messages[0] as AIMessage;
//       expect(postModelMessage.tool_calls).toHaveLength(1);
//       expect(postModelMessage.tool_calls?.[0].name).toBe('search');
//     });
//   });
//
//   describe('postProcessJsonConfig', () => {
//     it('should add postModelHook if it is not defined', async () => {
//       const { postProcessJsonConfig } = await import('#src/presets/anthropic.js');
//       const config = { hooks: {} };
//       const result = postProcessJsonConfig(config as GthConfig);
//       expect(result.hooks?.postModelHook).toBeDefined();
//     });
//
//     it('should not add postModelHook if it is "skip"', async () => {
//       const { postProcessJsonConfig } = await import('#src/presets/anthropic.js');
//       const config = { hooks: { postModelHook: 'skip' } };
//       const result = postProcessJsonConfig(config as any as GthConfig);
//       expect(result.hooks?.postModelHook).toBeUndefined();
//     });
//
//     it('should add postModelHook if hooks are not defined', async () => {
//       const { postProcessJsonConfig } = await import('#src/presets/anthropic.js');
//       const config = {};
//       const result = postProcessJsonConfig(config as GthConfig);
//       expect(result.hooks?.postModelHook).toBeDefined();
//     });
//   });
// });
