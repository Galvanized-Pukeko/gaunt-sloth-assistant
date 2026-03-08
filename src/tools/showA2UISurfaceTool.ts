import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { GthConfig } from '#src/config.js';

const toolDefinition = {
  name: 'show_a2ui_surface',
  description: `A2UI Surface Tool. Use this tool to display interactive UI surfaces to the user. The surfaceJsonl parameter must be a valid A2UI JSONL payload: newline-separated JSON objects containing surfaceUpdate, dataModelUpdate, and beginRendering messages. Each line must be a complete JSON object following the A2UI v0.8 protocol.`,
  schema: z.object({
    surfaceJsonl: z
      .string()
      .describe(
        'A2UI JSONL payload: newline-separated JSON objects (surfaceUpdate, dataModelUpdate, beginRendering)'
      ),
  }),
};

const toolImpl = ({ surfaceJsonl }: { surfaceJsonl: string }): string => {
  return surfaceJsonl;
};

export function get(_: GthConfig) {
  return tool(toolImpl, toolDefinition);
}
