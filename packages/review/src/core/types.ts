export { StatusLevel, GthCommand } from '@gaunt-sloth/core/core/types.js';
export type { StatusUpdateCallback } from '@gaunt-sloth/core/core/types.js';

import type { GthCommand } from '@gaunt-sloth/core/core/types.js';
import type { RunnableConfig } from '@langchain/core/runnables';
import { IterableReadableStream } from '@langchain/core/utils/stream';
import { GthConfig } from '#src/config.js';
import { BaseCheckpointSaver } from '@langchain/langgraph';
import { Message } from '#src/modules/types.js';

export interface GthAgentInterface {
  init(
    command: GthCommand | undefined,
    configIn: GthConfig,
    checkpointSaver?: BaseCheckpointSaver | undefined
  ): Promise<void>;

  invoke(messages: Message[], runConfig: RunnableConfig): Promise<string>;

  stream(messages: Message[], runConfig: RunnableConfig): Promise<IterableReadableStream<string>>;
}
