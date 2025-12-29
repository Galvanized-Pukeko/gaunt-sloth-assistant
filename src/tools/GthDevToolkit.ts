/**
 * @module GthDevToolkit
 */
import { BaseToolkit, StructuredToolInterface, tool } from '@langchain/core/tools';
import { z } from 'zod';
import { spawn } from 'child_process';
import path from 'node:path';
import { displayInfo, displayError } from '#src/utils/consoleUtils.js';
import { GthDevToolsConfig, CustomCommandConfig } from '#src/config.js';
import { stdout } from '#src/utils/systemUtils.js';

// Helper function to create a tool with dev type
function createGthTool<T extends z.ZodSchema>(
  fn: (args: z.infer<T>) => Promise<string>,
  config: {
    name: string;
    description: string;
    schema: T;
  },
  gthDevType: 'execute'
): StructuredToolInterface {
  const toolInstance = tool(fn, config);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (toolInstance as any).gthDevType = gthDevType;
  return toolInstance;
}

// Schema definitions for built-in tools
const RunTestsArgsSchema = z.object({});
const RunLintArgsSchema = z.object({});
const RunBuildArgsSchema = z.object({});
const RunSingleTestArgsSchema = z.object({
  testPath: z.string().describe('Relative path to the test file to run'),
});

const TEST_PATH_PLACEHOLDER = '${testPath}';

export default class GthDevToolkit extends BaseToolkit {
  tools: StructuredToolInterface[];
  private commands: GthDevToolsConfig;

  constructor(commands: GthDevToolsConfig = {}) {
    super();
    this.commands = commands;
    this.tools = this.createTools();
  }

  /**
   * Get tools filtered by operation type
   */
  getFilteredTools(allowedOperations: 'execute'[]): StructuredToolInterface[] {
    return this.tools.filter((tool) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolType = (tool as any).gthDevType;
      return allowedOperations.includes(toolType);
    });
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
   * Build the command for running a single test file
   */
  private buildSingleTestCommand(testPath: string): string {
    if (this.commands.run_single_test) {
      if (this.commands.run_single_test.includes(TEST_PATH_PLACEHOLDER)) {
        // Interpolate if placeholder is available
        return this.commands.run_single_test.replace(TEST_PATH_PLACEHOLDER, testPath);
      } else {
        // Concatenate if no placeholder
        return `${this.commands.run_single_test} ${testPath}`;
      }
    } else {
      throw new Error('No test command configured');
    }
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

    return createGthTool(
      toolFn,
      {
        name,
        description: config.description + `\nThe configured command is [${config.command}].`,
        schema,
      },
      'execute'
    );
  }

  private createTools(): StructuredToolInterface[] {
    const tools: StructuredToolInterface[] = [];

    if (this.commands.run_tests) {
      tools.push(
        createGthTool(
          async (_args: z.infer<typeof RunTestsArgsSchema>): Promise<string> => {
            return await this.executeCommand(this.commands.run_tests!, 'run_tests');
          },
          {
            name: 'run_tests',
            description:
              'Execute the test suite for this project. Runs the configured test command and returns the output.' +
              `\nThe configured command is [${this.commands.run_tests!}].`,
            schema: RunTestsArgsSchema,
          },
          'execute'
        )
      );
    }

    if (this.commands.run_single_test) {
      tools.push(
        createGthTool(
          async (args: z.infer<typeof RunSingleTestArgsSchema>): Promise<string> => {
            const validatedPath = this.validateParameterValue(args.testPath, 'testPath');
            const command = this.buildSingleTestCommand(validatedPath);
            return await this.executeCommand(command, 'run_single_test');
          },
          {
            name: 'run_single_test',
            description:
              'Execute a single test file. Runs the configured test command with the specified test file path. ' +
              'The test path must be relative and cannot contain directory traversal attempts or shell injection. ' +
              `\nThe base command is [${this.commands.run_single_test}].`,
            schema: RunSingleTestArgsSchema,
          },
          'execute'
        )
      );
    }

    if (this.commands.run_lint) {
      tools.push(
        createGthTool(
          async (_args: z.infer<typeof RunLintArgsSchema>): Promise<string> => {
            return await this.executeCommand(this.commands.run_lint!, 'run_lint');
          },
          {
            name: 'run_lint',
            description:
              'Run the linter on the project code. Executes the configured lint command and returns any linting errors or warnings.' +
              `\nThe configured command is [${this.commands.run_lint!}].`,
            schema: RunLintArgsSchema,
          },
          'execute'
        )
      );
    }

    if (this.commands.run_build) {
      tools.push(
        createGthTool(
          async (_args: z.infer<typeof RunBuildArgsSchema>): Promise<string> => {
            return await this.executeCommand(this.commands.run_build!, 'run_build');
          },
          {
            name: 'run_build',
            description:
              'Build the project. Executes the configured build command and returns the build output.' +
              `\nThe configured command is [${this.commands.run_build!}].`,
            schema: RunBuildArgsSchema,
          },
          'execute'
        )
      );
    }

    // Create tools for custom commands
    if (this.commands.custom_commands) {
      for (const [name, config] of Object.entries(this.commands.custom_commands)) {
        tools.push(this.createCustomCommandTool(name, config));
      }
    }

    return tools;
  }
}
