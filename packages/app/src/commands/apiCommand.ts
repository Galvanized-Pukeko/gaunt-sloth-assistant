import { Command } from 'commander';
import { CommandLineConfigOverrides, initConfig } from '@gaunt-sloth/core/config.js';
import { displayError } from '@gaunt-sloth/core/utils/consoleUtils.js';
import { setExitCode } from '@gaunt-sloth/core/utils/systemUtils.js';
import { parseIntOption } from '#src/commands/cliOptionParsers.js';

export function apiCommand(
  program: Command,
  commandLineConfigOverrides: CommandLineConfigOverrides
): void {
  const api = program.command('api').description('Start an API server for Gaunt Sloth');

  api
    .command('ag-ui')
    .description('Start an AG-UI protocol HTTP server')
    // CFG-62: the strict parser, as on `batch -j`, so `--port abc` is refused at parse time instead
    // of `parseInt` handing the server `NaN`, and `--port 10abc` is refused instead of becoming 10.
    .option('--port <port>', 'Port to listen on', parseIntOption)
    // CFG-67: the server binds loopback unless this says otherwise, so exposing an unauthenticated
    // agent endpoint to the network is something someone typed rather than something they inherited.
    .option(
      '--host <host>',
      'Interface to bind. Default 127.0.0.1 (this machine only); 0.0.0.0 — or :: for IPv6 as well — accepts connections from the network'
    )
    // OPS-16: the browser origin is the other half of the port. A launcher that moves the web
    // client knows its new origin and cannot rewrite the config file pinning the old one, so
    // without this flag the client relocates and every request it makes is refused by a preflight
    // naming an origin it no longer has.
    .option(
      '--cors-origin <origin>',
      'Browser origin allowed to call this server, over commands.api.cors.allowOrigin. One origin, not a list'
    )
    .addHelpText(
      'after',
      '\n' +
        'Examples:\n' +
        '  $ gth api ag-ui\n' +
        '  $ gth api ag-ui --port 4000\n' +
        '  $ gth api ag-ui --host 0.0.0.0 --port 4000\n' +
        '  $ gth api ag-ui --port 4000 --cors-origin http://localhost:5556\n'
    )
    .action(async (options: { port?: number; host?: string; corsOrigin?: string }) => {
      try {
        const config = await initConfig(commandLineConfigOverrides);
        // `??`, not a truthiness check: the option is a number now, and `--port 0` (let the OS pick)
        // must stay port 0 rather than falling through to the configured port.
        const port = options.port ?? config.commands?.api?.port ?? 3000;

        const { startAgUiServer } = await import('@gaunt-sloth/agent/modules/apiAgUiModule.js');
        // The host's precedence — flag, then `commands.api.host`, then loopback — is resolved by
        // the server rather than here, so a programmatic caller gets the same safe default and
        // the two doors onto this server cannot drift. The CORS origin travels the same way.
        await startAgUiServer(config, port, options.host, options.corsOrigin);
      } catch (error) {
        displayError(error instanceof Error ? error.message : String(error));
        setExitCode(1);
      }
    });
}
