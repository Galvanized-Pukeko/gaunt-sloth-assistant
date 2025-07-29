import GthFileSystemToolkit from '#src/tools/GthFileSystemToolkit.js';
import { StructuredToolInterface } from '@langchain/core/tools';
import { GthDevToolsConfig, GthConfig } from '#src/config.js';
import { displayWarning } from '#src/consoleUtils.js';
import { getCurrentDir } from '#src/systemUtils.js';
import { GthCommand } from '#src/core/types.js';
import GthDevToolkit from '#src/tools/GthDevToolkit.js';

const AVAILABLE_BUILT_IN_TOOLS = {
  gth_status_update: '#src/tools/gthStatusUpdateTool.js',
  gth_jira_log_work: '#src/tools/gthJiraLogWorkTool.js',
  gth_sequential_thinking: '#src/tools/gthSequentialThinkingTool.js',
  gth_web_fetch: '#src/tools/gthWebFetchTool.js',
};

/**
 * Get default tools based on filesystem and built-in tools configuration
 */
export async function getDefaultTools(
  config: GthConfig,
  command?: GthCommand
): Promise<StructuredToolInterface[]> {
  const filesystemTools = filterFilesystemTools(config.filesystem);
  const builtInTools = await getBuiltInTools(config);
  const devTools = await filterDevTools(command, config.commands?.code?.devTools);
  return [...filesystemTools, ...devTools, ...builtInTools];
}

async function filterDevTools(
  command: GthCommand | undefined,
  devToolConfig: GthDevToolsConfig | undefined
): Promise<StructuredToolInterface[]> {
  if (command != 'code' || !devToolConfig) {
    return [];
  }
  const thinking = await import(AVAILABLE_BUILT_IN_TOOLS.gth_sequential_thinking);
  const toolkit = new GthDevToolkit(devToolConfig);
  return [thinking.get(), ...toolkit.getTools()];
}

/**
 * Filter filesystem tools based on configuration
 */

function filterFilesystemTools(
  filesystemConfig: string[] | 'all' | 'read' | 'none'
): StructuredToolInterface[] {
  const toolkit = new GthFileSystemToolkit([getCurrentDir()]);
  if (filesystemConfig === 'all') {
    return toolkit.getTools();
  }

  if (filesystemConfig === 'none') {
    return [];
  }

  if (filesystemConfig === 'read') {
    // Read-only: only allow read operations
    return toolkit.getFilteredTools(['read']);
  }

  if (!Array.isArray(filesystemConfig)) {
    return toolkit.getTools();
  }

  if (filesystemConfig.includes('all')) {
    return toolkit.getTools();
  }

  // Handle an array of specific tool names or 'read'/'all'
  const allowedTools: StructuredToolInterface[] = filesystemConfig.includes('read')
    ? toolkit.getFilteredTools(['read'])
    : [];

  // Also allow specific tool names
  const allowedToolNames = new Set(
    filesystemConfig.filter((name) => name !== 'read' && name !== 'all')
  );
  const specificNamedTools = toolkit.getTools().filter((tool) => {
    return tool.name && allowedToolNames.has(tool.name);
  });

  // Combine and deduplicate
  const allAllowedTools = [...allowedTools, ...specificNamedTools];
  return allAllowedTools.filter(
    (tool, index, arr) => arr.findIndex((t) => t.name === tool.name) === index
  );
}

/**
 * Get built-in tools based on configuration
 */
async function getBuiltInTools(config: GthConfig): Promise<StructuredToolInterface[]> {
  const tools: StructuredToolInterface[] = [];

  if (!config.builtInTools) {
    return tools;
  }

  for (const toolName of config.builtInTools) {
    if (toolName in AVAILABLE_BUILT_IN_TOOLS) {
      try {
        const tool = await import(
          AVAILABLE_BUILT_IN_TOOLS[toolName as keyof typeof AVAILABLE_BUILT_IN_TOOLS]
        );
        tools.push(tool.get(config));
      } catch (error) {
        displayWarning(`Failed to load built-in tool '${toolName}': ${error}`);
      }
    } else {
      displayWarning(`Unknown built-in tool: ${toolName}`);
    }
  }

  return tools;
}
