import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

// Mock child_process
const childProcessMock = {
  spawn: vi.fn(),
};
vi.mock('child_process', () => childProcessMock);

// Mock consoleUtils
const consoleUtilsMock = {
  displayInfo: vi.fn(),
  displayError: vi.fn(),
};
vi.mock('#src/utils/consoleUtils.js', () => consoleUtilsMock);

// Mock systemUtils
const systemUtilsMock = {
  stdout: {
    write: vi.fn(),
  },
};
vi.mock('#src/utils/systemUtils.js', () => systemUtilsMock);

describe('GthDevToolkit - Basic Tests', () => {
  let GthDevToolkit: typeof import('#src/tools/GthDevToolkit.js').default;
  let toolkit: InstanceType<typeof import('#src/tools/GthDevToolkit.js').default>;

  beforeEach(async () => {
    vi.resetAllMocks();

    // Mock spawn to simulate successful command
    const mockChild = {
      on: vi.fn((event, callback) => {
        if (event === 'close') {
          callback(0); // Success
        }
        if (event === 'error') {
          callback(new Error('Test error'));
        }
      }),
      stdout: {
        on: vi.fn((event, callback) => {
          if (event === 'data') callback(Buffer.from('Test output\n'));
        }),
      },
      stderr: {
        on: vi.fn((event, callback) => {
          if (event === 'data') callback(Buffer.from('Test error\n'));
        }),
      },
    };
    childProcessMock.spawn.mockReturnValue(mockChild as any);

    ({ default: GthDevToolkit } = await import('#src/tools/GthDevToolkit.js'));
  });

  describe('constructor', () => {
    it('should initialize with provided commands', () => {
      const commands = {
        run_tests: 'npm test',
        run_single_test: 'npm test -- ${testPath}',
        run_lint: 'npm run lint',
        run_build: 'npm run build',
      };
      toolkit = new GthDevToolkit(commands);
      expect(toolkit).toBeDefined();
      expect(toolkit.tools).toBeDefined();
      expect(toolkit.tools.length).toBe(4); // All four tools
    });

    it('should initialize only available tools', () => {
      const commands = {
        run_tests: 'npm test',
      };
      toolkit = new GthDevToolkit(commands);
      expect(toolkit.tools.length).toBe(1);
      expect(toolkit.tools[0].name).toBe('run_tests');
    });

    it('should have all expected tools when all commands provided', () => {
      const commands = {
        run_tests: 'npm test',
        run_single_test: 'npm test -- ${testPath}',
        run_lint: 'npm run lint',
        run_build: 'npm run build',
      };
      toolkit = new GthDevToolkit(commands);
      const toolNames = toolkit.tools.map((t) => t.name);

      expect(toolNames).toContain('run_tests');
      expect(toolNames).toContain('run_single_test');
      expect(toolNames).toContain('run_lint');
      expect(toolNames).toContain('run_build');
    });
  });

  describe('getFilteredTools', () => {
    it('should return tools filtered by type', () => {
      const commands = {
        run_tests: 'npm test',
        run_single_test: 'npm test -- ${testPath}',
      };
      toolkit = new GthDevToolkit(commands);
      const filtered = toolkit.getFilteredTools(['execute']);
      expect(filtered.length).toBe(2);
      expect(filtered.every((tool) => (tool as any).gthDevType === 'execute')).toBe(true);
    });
  });

  describe('buildSingleTestCommand', () => {
    it('should build command with placeholder', () => {
      toolkit = new GthDevToolkit({ run_single_test: 'npm test -- ${testPath}' });
      expect(toolkit['buildSingleTestCommand']('spec/test.ts')).toBe('npm test -- spec/test.ts');
    });

    it('should build command without placeholder', () => {
      toolkit = new GthDevToolkit({ run_single_test: 'npm test' });
      expect(toolkit['buildSingleTestCommand']('spec/test.ts')).toBe('npm test spec/test.ts');
    });

    it('should throw if no command configured', () => {
      toolkit = new GthDevToolkit({});
      expect(() => toolkit['buildSingleTestCommand']('test.ts')).toThrow(
        'No test command configured'
      );
    });
  });

  describe('executeCommand', () => {
    beforeEach(() => {
      toolkit = new GthDevToolkit({});
    });

    it('should execute command successfully', async () => {
      const result = await toolkit['executeCommand']('echo test', 'test_tool');
      expect(result).toContain("Executing 'echo test'...");
      expect(result).toContain('<COMMAND_OUTPUT>');
      expect(result).toContain("Command 'echo test' completed successfully");
      expect(consoleUtilsMock.displayInfo).toHaveBeenCalledWith(
        '\n🔧 Executing test_tool: echo test'
      );
      expect(childProcessMock.spawn).toHaveBeenCalledWith('echo test', { shell: true });
    });

    it('should handle command failure', async () => {
      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === 'close') callback(1); // Failure
        }),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
      };
      childProcessMock.spawn.mockReturnValueOnce(mockChild as any);

      const result = await toolkit['executeCommand']('failing cmd', 'test_tool');
      expect(result).toContain('exited with code 1');
    });

    it('should handle execution error', async () => {
      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === 'error') callback(new Error('Spawn error'));
        }),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
      };
      childProcessMock.spawn.mockReturnValueOnce(mockChild as any);

      await expect(toolkit['executeCommand']('error cmd', 'test_tool')).rejects.toThrow(
        'Failed to execute command'
      );
      expect(consoleUtilsMock.displayError).toHaveBeenCalled();
    });
  });

  describe('tool invocation', () => {
    beforeEach(() => {
      const commands = {
        run_tests: 'npm test',
        run_single_test: 'npm test -- ${testPath}',
      };
      toolkit = new GthDevToolkit(commands);
    });

    it('should invoke run_tests tool', async () => {
      const tool = toolkit.tools.find((t) => t.name === 'run_tests')!;
      const result = await tool.invoke({});
      expect(result).toContain("Command 'npm test' completed successfully");
    });

    it('should invoke run_single_test with valid path', async () => {
      const tool = toolkit.tools.find((t) => t.name === 'run_single_test')!;
      const inputPath = 'spec/test.spec.ts';
      const normalizedPath = path.normalize(inputPath);
      const result = await tool.invoke({ testPath: inputPath });
      expect(result).toContain(`Command 'npm test -- ${normalizedPath}' completed successfully`);
    });

    it('should reject directory traversal in run_single_test', async () => {
      const tool = toolkit.tools.find((t) => t.name === 'run_single_test')!;
      await expect(tool.invoke({ testPath: '../invalid' })).rejects.toThrow(
        "Directory traversal attempts are not allowed in parameter 'testPath'"
      );
      await expect(tool.invoke({ testPath: 'dir/../../secret' })).rejects.toThrow(
        "Directory traversal attempts are not allowed in parameter 'testPath'"
      );
    });

    it('should reject absolute paths in run_single_test', async () => {
      const tool = toolkit.tools.find((t) => t.name === 'run_single_test')!;
      await expect(tool.invoke({ testPath: '/absolute/path/test.ts' })).rejects.toThrow(
        "Absolute paths are not allowed for parameter 'testPath'"
      );
    });

    it('should reject shell injection in run_single_test', async () => {
      const tool = toolkit.tools.find((t) => t.name === 'run_single_test')!;
      await expect(tool.invoke({ testPath: 'test|rm -rf' })).rejects.toThrow(
        "Shell injection attempts are not allowed in parameter 'testPath'"
      );
      await expect(tool.invoke({ testPath: 'test; evil' })).rejects.toThrow(
        "Shell injection attempts are not allowed in parameter 'testPath'"
      );
      await expect(tool.invoke({ testPath: 'test`evil`' })).rejects.toThrow(
        "Shell injection attempts are not allowed in parameter 'testPath'"
      );
    });
  });

  describe('custom commands', () => {
    describe('constructor with custom commands', () => {
      it('should create tools for custom commands without parameters', () => {
        toolkit = new GthDevToolkit({
          custom_commands: {
            deploy_staging: {
              command: 'npm run deploy:staging',
              description: 'Deploy to staging environment',
            },
          },
        });

        expect(toolkit.tools.length).toBe(1);
        expect(toolkit.tools[0].name).toBe('deploy_staging');
      });

      it('should create tools for custom commands with parameters', () => {
        toolkit = new GthDevToolkit({
          custom_commands: {
            run_migration: {
              command: 'npm run migrate -- ${migrationName}',
              description: 'Run a specific database migration',
              parameters: {
                migrationName: {
                  description: 'Name of the migration to run',
                },
              },
            },
          },
        });

        expect(toolkit.tools.length).toBe(1);
        expect(toolkit.tools[0].name).toBe('run_migration');
      });

      it('should create multiple custom command tools', () => {
        toolkit = new GthDevToolkit({
          custom_commands: {
            deploy_staging: {
              command: 'npm run deploy:staging',
              description: 'Deploy to staging',
            },
            deploy_prod: {
              command: 'npm run deploy:prod',
              description: 'Deploy to production',
            },
            run_e2e: {
              command: 'npm run e2e',
              description: 'Run E2E tests',
            },
          },
        });

        expect(toolkit.tools.length).toBe(3);
        const toolNames = toolkit.tools.map((t) => t.name);
        expect(toolNames).toContain('deploy_staging');
        expect(toolNames).toContain('deploy_prod');
        expect(toolNames).toContain('run_e2e');
      });

      it('should include custom commands along with built-in commands', () => {
        toolkit = new GthDevToolkit({
          run_tests: 'npm test',
          run_lint: 'npm run lint',
          custom_commands: {
            deploy: {
              command: 'npm run deploy',
              description: 'Deploy the application',
            },
          },
        });

        expect(toolkit.tools.length).toBe(3);
        const toolNames = toolkit.tools.map((t) => t.name);
        expect(toolNames).toContain('run_tests');
        expect(toolNames).toContain('run_lint');
        expect(toolNames).toContain('deploy');
      });
    });

    describe('validateParameterValue', () => {
      beforeEach(() => {
        toolkit = new GthDevToolkit({});
      });

      it('should allow valid parameter values', () => {
        expect(toolkit.validateParameterValue('valid_value', 'param')).toBe('valid_value');
        expect(toolkit.validateParameterValue('some/path/file.txt', 'param')).toBe(
          path.normalize('some/path/file.txt')
        );
      });

      it('should throw on absolute paths', () => {
        expect(() => toolkit.validateParameterValue('/absolute/path', 'myParam')).toThrow(
          "Absolute paths are not allowed for parameter 'myParam'"
        );
      });

      it('should throw on directory traversal attempts', () => {
        expect(() => toolkit.validateParameterValue('../secret', 'myParam')).toThrow(
          "Directory traversal attempts are not allowed in parameter 'myParam'"
        );
        expect(() => toolkit.validateParameterValue('dir/../../secret', 'myParam')).toThrow(
          "Directory traversal attempts are not allowed in parameter 'myParam'"
        );
      });

      it('should throw on shell injection attempts', () => {
        expect(() => toolkit.validateParameterValue('value|evil', 'param')).toThrow(
          "Shell injection attempts are not allowed in parameter 'param'"
        );
        expect(() => toolkit.validateParameterValue('value;evil', 'param')).toThrow(
          "Shell injection attempts are not allowed in parameter 'param'"
        );
        expect(() => toolkit.validateParameterValue('value&evil', 'param')).toThrow(
          "Shell injection attempts are not allowed in parameter 'param'"
        );
        expect(() => toolkit.validateParameterValue('value`evil`', 'param')).toThrow(
          "Shell injection attempts are not allowed in parameter 'param'"
        );
        expect(() => toolkit.validateParameterValue('value$VAR', 'param')).toThrow(
          "Shell injection attempts are not allowed in parameter 'param'"
        );
        expect(() => toolkit.validateParameterValue('value$(cmd)', 'param')).toThrow(
          "Shell injection attempts are not allowed in parameter 'param'"
        );
      });

      it('should throw on null bytes', () => {
        expect(() => toolkit.validateParameterValue('value\0evil', 'param')).toThrow(
          "Null bytes are not allowed in parameter 'param'"
        );
      });

      it('should throw on newlines', () => {
        expect(() => toolkit.validateParameterValue('value\nevil', 'param')).toThrow(
          "Shell injection attempts are not allowed in parameter 'param'"
        );
        expect(() => toolkit.validateParameterValue('value\revil', 'param')).toThrow(
          "Shell injection attempts are not allowed in parameter 'param'"
        );
      });
    });

    describe('buildCustomCommand', () => {
      beforeEach(() => {
        toolkit = new GthDevToolkit({});
      });

      it('should build command without parameters', () => {
        const result = toolkit.buildCustomCommand('npm run deploy', {}, undefined);
        expect(result).toBe('npm run deploy');
      });

      it('should build command with placeholder interpolation', () => {
        const result = toolkit.buildCustomCommand(
          'npm run migrate -- ${migrationName}',
          { migrationName: 'add_users_table' },
          { migrationName: { description: 'Migration name' } }
        );
        expect(result).toBe('npm run migrate -- add_users_table');
      });

      it('should build command with multiple placeholder interpolations', () => {
        const result = toolkit.buildCustomCommand(
          'docker run ${imageName}:${tag}',
          { imageName: 'myapp', tag: 'latest' },
          { imageName: { description: 'Image name' }, tag: { description: 'Image tag' } }
        );
        expect(result).toBe('docker run myapp:latest');
      });

      it('should append parameters when no placeholders present', () => {
        const result = toolkit.buildCustomCommand(
          'npm run script',
          { arg1: 'value1', arg2: 'value2' },
          { arg1: { description: 'First arg' }, arg2: { description: 'Second arg' } }
        );
        expect(result).toBe('npm run script value1 value2');
      });

      it('should validate parameters before interpolation', () => {
        expect(() =>
          toolkit.buildCustomCommand(
            'npm run migrate -- ${name}',
            { name: '../evil' },
            { name: { description: 'Name' } }
          )
        ).toThrow("Directory traversal attempts are not allowed in parameter 'name'");
      });

      it('should handle repeated placeholders', () => {
        const result = toolkit.buildCustomCommand(
          'echo ${value} and ${value} again',
          { value: 'test' },
          { value: { description: 'Value' } }
        );
        expect(result).toBe('echo test and test again');
      });
    });

    describe('custom command tool invocation', () => {
      it('should invoke custom command without parameters', async () => {
        toolkit = new GthDevToolkit({
          custom_commands: {
            deploy: {
              command: 'npm run deploy',
              description: 'Deploy the application',
            },
          },
        });

        const tool = toolkit.tools.find((t) => t.name === 'deploy')!;
        const result = await tool.invoke({});
        expect(result).toContain("Command 'npm run deploy' completed successfully");
        expect(childProcessMock.spawn).toHaveBeenCalledWith('npm run deploy', { shell: true });
      });

      it('should invoke custom command with parameters using placeholders', async () => {
        toolkit = new GthDevToolkit({
          custom_commands: {
            run_migration: {
              command: 'npm run migrate -- ${migrationName}',
              description: 'Run migration',
              parameters: {
                migrationName: { description: 'Migration name' },
              },
            },
          },
        });

        const tool = toolkit.tools.find((t) => t.name === 'run_migration')!;
        const result = await tool.invoke({ migrationName: 'add_users' });
        expect(result).toContain("Command 'npm run migrate -- add_users' completed successfully");
      });

      it('should invoke custom command with multiple parameters', async () => {
        toolkit = new GthDevToolkit({
          custom_commands: {
            docker_build: {
              command: 'docker build -t ${imageName}:${tag} .',
              description: 'Build Docker image',
              parameters: {
                imageName: { description: 'Image name' },
                tag: { description: 'Image tag' },
              },
            },
          },
        });

        const tool = toolkit.tools.find((t) => t.name === 'docker_build')!;
        const result = await tool.invoke({ imageName: 'myapp', tag: 'v1.0.0' });
        expect(result).toContain("Command 'docker build -t myapp:v1.0.0 .' completed successfully");
      });

      it('should reject custom command with invalid parameter values', async () => {
        toolkit = new GthDevToolkit({
          custom_commands: {
            run_script: {
              command: 'npm run ${scriptName}',
              description: 'Run a script',
              parameters: {
                scriptName: { description: 'Script name' },
              },
            },
          },
        });

        const tool = toolkit.tools.find((t) => t.name === 'run_script')!;
        await expect(tool.invoke({ scriptName: 'evil;rm -rf /' })).rejects.toThrow(
          "Shell injection attempts are not allowed in parameter 'scriptName'"
        );
      });

      it('should include command in tool description', () => {
        toolkit = new GthDevToolkit({
          custom_commands: {
            my_command: {
              command: 'echo hello',
              description: 'Say hello',
            },
          },
        });

        const tool = toolkit.tools.find((t) => t.name === 'my_command')!;
        expect(tool.description).toContain('Say hello');
        expect(tool.description).toContain('[echo hello]');
      });
    });

    describe('getFilteredTools with custom commands', () => {
      it('should filter custom commands by execute type', () => {
        toolkit = new GthDevToolkit({
          run_tests: 'npm test',
          custom_commands: {
            deploy: {
              command: 'npm run deploy',
              description: 'Deploy',
            },
          },
        });

        const filtered = toolkit.getFilteredTools(['execute']);
        expect(filtered.length).toBe(2);
        expect(filtered.every((tool) => (tool as any).gthDevType === 'execute')).toBe(true);
      });
    });
  });
});
