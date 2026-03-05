import { Command } from 'commander';
import { CommandLineConfigOverrides, initConfig } from '#src/config.js';
import { displayError } from '#src/utils/consoleUtils.js';
import { setExitCode } from '#src/utils/systemUtils.js';

export function apiCommand(
  program: Command,
  commandLineConfigOverrides: CommandLineConfigOverrides
): void {
  const api = program.command('api').description('Start an API server for Gaunt Sloth');

  api
    .command('ag-ui')
    .description('Start an AG-UI protocol HTTP server')
    .option('--port <port>', 'Port to listen on')
    .action(async (options: { port?: string }) => {
      try {
        const config = await initConfig(commandLineConfigOverrides);
        const port = options.port
          ? parseInt(options.port, 10)
          : (config.commands?.api?.port ?? 3000);

        const { startAgUiServer } = await import('#src/modules/apiAgUiModule.js');
        await startAgUiServer(config, port);
      } catch (error) {
        displayError(error instanceof Error ? error.message : String(error));
        setExitCode(1);
      }
    });
}
