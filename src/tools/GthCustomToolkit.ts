/**
 * @module GthCustomToolkit
 * Toolkit for user-defined custom shell commands.
 * Provides secure execution of shell commands with parameter validation.
 */
import { BaseToolkit, StructuredToolInterface, tool } from '@langchain/core/tools';
import { z } from 'zod';
import { spawn } from 'child_process';
import path from 'node:path';
import { displayInfo, displayError } from '#src/utils/consoleUtils.js';
import { CustomToolsConfig, CustomCommandConfig } from '#src/config.js';
import { stdout } from '#src/utils/systemUtils.js';

// Helper function to create a tool with execute type
function createCustomTool<T extends z.ZodSchema>(
  fn: (args: z.infer<T>) => Promise<string>,
  config: {
    name: string;
    description: string;
    schema: T;
  }
): StructuredToolInterface {
  const toolInstance = tool(fn, config);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (toolInstance as any).gthCustomType = 'execute';
  return toolInstance;
}

export default class GthCustomToolkit extends BaseToolkit {
  tools: StructuredToolInterface[];
  private customTools: CustomToolsConfig;

  constructor(customTools: CustomToolsConfig = {}) {
    super();
    this.customTools = customTools;
    this.tools = this.createTools();
  }

  /**
   * Validate parameter value to prevent security issues
   */
  validateParameterValue(paramValue: string, paramName: string): string {
    // Check for absolute paths
    if (path.isAbsolute(paramValue)) {
      throw new Error(`Absolute paths are not allowed for parameter '${paramName}'`);
    }

    // Check for directory traversal attempts
    if (paramValue.includes('..') || paramValue.includes('\\..\\') || paramValue.includes('/../')) {
      throw new Error(`Directory traversal attempts are not allowed in parameter '${paramName}'`);
    }

    // Check for pipe attempts and other shell injection
    if (
      paramValue.includes('|') ||
      paramValue.includes('&') ||
      paramValue.includes(';') ||
      paramValue.includes('`') ||
      paramValue.includes('$') ||
      paramValue.includes('$(') ||
      paramValue.includes('\n') ||
      paramValue.includes('\r')
    ) {
      throw new Error(`Shell injection attempts are not allowed in parameter '${paramName}'`);
    }

    // Check for null bytes
    if (paramValue.includes('\0')) {
      throw new Error(`Null bytes are not allowed in parameter '${paramName}'`);
    }

    // Normalize the path to remove any redundant separators
    const normalizedValue = path.normalize(paramValue);

    // Double-check after normalization
    if (normalizedValue.includes('..')) {
      throw new Error(`Directory traversal attempts are not allowed in parameter '${paramName}'`);
    }

    return normalizedValue;
  }

  /**
   * Build a custom command with parameter interpolation
   */
  buildCustomCommand(
    commandTemplate: string,
    parameters: Record<string, string>,
    parameterConfig?: Record<string, { description: string }>
  ): string {
    let command = commandTemplate;
    const paramNames = Object.keys(parameters);

    // Check if all provided parameters have placeholders or should be appended
    const hasPlaceholders = paramNames.some((name) => command.includes(`\${${name}}`));

    if (hasPlaceholders) {
      // Replace all placeholders with validated parameter values
      for (const [name, value] of Object.entries(parameters)) {
        const validatedValue = this.validateParameterValue(value, name);
        const placeholder = `\${${name}}`;
        command = command.replace(
          new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
          validatedValue
        );
      }
    } else if (paramNames.length > 0 && parameterConfig) {
      // Append parameters in the order defined in the config
      const orderedParams = Object.keys(parameterConfig);
      const appendValues: string[] = [];
      for (const name of orderedParams) {
        if (parameters[name] !== undefined) {
          const validatedValue = this.validateParameterValue(parameters[name], name);
          appendValues.push(validatedValue);
        }
      }
      if (appendValues.length > 0) {
        command = `${command} ${appendValues.join(' ')}`;
      }
    }

    return command;
  }

  private async executeCommand(command: string, toolName: string): Promise<string> {
    displayInfo(`\n🔧 Executing ${toolName}: ${command}`);

    return new Promise((resolve, reject) => {
      const child = spawn(command, {
        shell: true,
      });

      let output = '';

      // Capture output if available (when stdio is not 'inherit')
      if (child.stdout) {
        child.stdout.on('data', (data) => {
          const chunk = data.toString();
          stdout.write(chunk);
          output += chunk;
        });
      }

      if (child.stderr) {
        child.stderr.on('data', (data) => {
          const chunk = data.toString();
          stdout.write(chunk);
          output += chunk;
        });
      }

      child.on('close', (code) => {
        if (code === 0) {
          resolve(
            `Executing '${command}'...\n\n` +
              `<COMMAND_OUTPUT>\n` +
              output +
              `</COMMAND_OUTPUT>\n` +
              `\n\nCommand '${command}' completed successfully`
          );
        } else {
          resolve(
            `Executing '${command}'...\n\n` +
              `<COMMAND_OUTPUT>\n` +
              output +
              `</COMMAND_OUTPUT>\n` +
              `\n\nCommand '${command}' exited with code ${code}`
          );
        }
      });

      child.on('error', (error) => {
        const errorMsg = `Failed to execute command '${command}': ${error.message}`;
        displayError(errorMsg);
        reject(new Error(errorMsg));
      });
    });
  }

  /**
   * Create a Zod schema for a custom command's parameters
   */
  private createCustomCommandSchema(
    config: CustomCommandConfig
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): z.ZodObject<any> {
    if (!config.parameters || Object.keys(config.parameters).length === 0) {
      return z.object({});
    }

    const shape: Record<string, z.ZodString> = {};
    for (const [paramName, paramConfig] of Object.entries(config.parameters)) {
      shape[paramName] = z.string().describe(paramConfig.description);
    }

    return z.object(shape);
  }

  /**
   * Create a tool for a custom command
   */
  private createCustomCommandTool(
    name: string,
    config: CustomCommandConfig
  ): StructuredToolInterface {
    const schema = this.createCustomCommandSchema(config);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolFn = async (args: any): Promise<string> => {
      // All parameters are strings, safe to cast
      const stringArgs = args as Record<string, string>;
      const command = this.buildCustomCommand(config.command, stringArgs, config.parameters);
      return await this.executeCommand(command, name);
    };

    return createCustomTool(toolFn, {
      name,
      description: config.description + `\nThe configured command is [${config.command}].`,
      schema,
    });
  }

  private createTools(): StructuredToolInterface[] {
    const tools: StructuredToolInterface[] = [];

    // Create tools for custom commands
    for (const [name, config] of Object.entries(this.customTools)) {
      tools.push(this.createCustomCommandTool(name, config));
    }

    return tools;
  }
}
