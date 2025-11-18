import { GthConfig } from '#src/config.js';
import { createA2AAgentTool } from '#src/tools/A2AAgentTool.js';
import { StructuredToolInterface } from '@langchain/core/tools';

export function get(config: GthConfig): StructuredToolInterface {
    const a2aConfig = config.builtInToolsConfig?.a2a;
    if (!a2aConfig) {
        throw new Error('A2A agent configuration is missing in builtInToolsConfig');
    }
    return createA2AAgentTool(a2aConfig);
}
