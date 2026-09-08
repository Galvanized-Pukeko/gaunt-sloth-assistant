/**
 * CFG-62, taken in passing — `gth api ag-ui --port` goes through the strict integer parser.
 *
 * Before this, the option was a bare string run through `parseInt(value, 10)` inside the action, so
 * `--port abc` handed the server `NaN` and `--port 10abc` silently became port 10. The two garbage
 * cells below cannot pass on that code: `parseInt` never throws, so the server mock would be called.
 *
 * The command is driven through commander exactly as the CLI does, with the server module and the
 * config loader mocked, so nothing here binds a port.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const initConfigMock = vi.hoisted(() => vi.fn());
vi.mock('@gaunt-sloth/core/config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gaunt-sloth/core/config.js')>()),
  initConfig: initConfigMock,
}));

const startAgUiServerMock = vi.hoisted(() => vi.fn());
vi.mock('@gaunt-sloth/agent/modules/apiAgUiModule.js', () => ({
  startAgUiServer: startAgUiServerMock,
}));

const displayErrorMock = vi.hoisted(() => vi.fn());
vi.mock('@gaunt-sloth/core/utils/consoleUtils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gaunt-sloth/core/utils/consoleUtils.js')>()),
  displayError: displayErrorMock,
}));

const setExitCodeMock = vi.hoisted(() => vi.fn());
vi.mock('@gaunt-sloth/core/utils/systemUtils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gaunt-sloth/core/utils/systemUtils.js')>()),
  setExitCode: setExitCodeMock,
}));

import { apiCommand } from '#src/commands/apiCommand.js';

describe('gth api ag-ui --port (CFG-62)', () => {
  const config = { commands: { api: { port: 4100 } } };

  beforeEach(() => {
    vi.resetAllMocks();
    initConfigMock.mockResolvedValue(config);
    startAgUiServerMock.mockResolvedValue(undefined);
  });

  const run = async (...args: string[]): Promise<void> => {
    const program = new Command();
    program.exitOverride();
    apiCommand(program, {});
    await program.parseAsync(['node', 'gth', 'api', 'ag-ui', ...args]);
  };

  it('passes a numeric --port to the server as a number', async () => {
    await run('--port', '4000');
    expect(startAgUiServerMock).toHaveBeenCalledWith(config, 4000, undefined, undefined);
  });

  it('with no --port, uses the configured port, and 3000 when nothing is configured', async () => {
    await run();
    expect(startAgUiServerMock).toHaveBeenCalledWith(config, 4100, undefined, undefined);

    startAgUiServerMock.mockClear();
    const bare = {};
    initConfigMock.mockResolvedValue(bare);
    await run();
    expect(startAgUiServerMock).toHaveBeenCalledWith(bare, 3000, undefined, undefined);
  });

  it('--port 0 is port 0 (let the OS pick), not the configured port', async () => {
    await run('--port', '0');
    expect(startAgUiServerMock).toHaveBeenCalledWith(config, 0, undefined, undefined);
  });

  it('CFG-67: --host reaches the server, and its absence is an absence', async () => {
    // The host's precedence lives in the server, so what this door owes is that the flag arrives
    // and that not typing it arrives as nothing — the value the server reads `commands.api.host`
    // for. A door that substituted its own default here would silently outrank the config file.
    await run('--host', '0.0.0.0');
    expect(startAgUiServerMock).toHaveBeenCalledWith(config, 4100, '0.0.0.0', undefined);

    startAgUiServerMock.mockClear();
    await run();
    expect(startAgUiServerMock).toHaveBeenCalledWith(config, 4100, undefined, undefined);
  });

  it('OPS-16: --cors-origin reaches the server, and its absence is an absence', async () => {
    // Same division of labour as --host above: the precedence is the server's, so this door owes
    // only that the typed origin arrives verbatim and that an untyped one arrives as nothing. A
    // door that substituted a default of its own would outrank commands.api.cors.allowOrigin for
    // every user who never passed the flag.
    await run('--cors-origin', 'http://localhost:5556');
    expect(startAgUiServerMock).toHaveBeenCalledWith(
      config,
      4100,
      undefined,
      'http://localhost:5556'
    );

    startAgUiServerMock.mockClear();
    await run();
    expect(startAgUiServerMock).toHaveBeenCalledWith(config, 4100, undefined, undefined);
  });

  it('refuses --port abc at parse time, before the config is read or the server is started', async () => {
    await expect(run('--port', 'abc')).rejects.toThrow('Expected an integer, got "abc"');
    expect(initConfigMock).not.toHaveBeenCalled();
    expect(startAgUiServerMock).not.toHaveBeenCalled();
  });

  it('refuses trailing garbage rather than truncating it: --port 10abc is not port 10', async () => {
    await expect(run('--port', '10abc')).rejects.toThrow('Expected an integer, got "10abc"');
    expect(startAgUiServerMock).not.toHaveBeenCalled();
  });

  it('a server that could not start reaches the exit status, and says why', async () => {
    // `gth api ag-ui` is the second door onto the same server. A bind that fails has to be as
    // loud here as it is on the bin, so the failure is reported and the run is not a success.
    startAgUiServerMock.mockRejectedValue(
      new Error('AG-UI server failed to listen on port 4000: listen EADDRINUSE')
    );

    await run('--port', '4000');

    expect(displayErrorMock).toHaveBeenCalledWith(
      expect.stringContaining('failed to listen on port 4000')
    );
    expect(setExitCodeMock).toHaveBeenCalledWith(1);
  });
});
