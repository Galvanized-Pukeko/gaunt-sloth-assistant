import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import type { SessionConfig } from '@gaunt-sloth/agent/modules/interactiveSessionModule.js';
import type { CommandLineConfigOverrides } from '@gaunt-sloth/core/config.js';

// ── ink render ────────────────────────────────────────────────────────────────
// The render instance must expose clear() + waitUntilExit() (createTuiSession awaits the
// latter). waitUntilExit resolves immediately so the session call returns.
const renderMock = vi.fn();
vi.mock('ink', () => ({ render: renderMock }));

// ── core/config ─────────────────────────────────────────────────────────────--
const initConfigMock = vi.fn();
vi.mock('@gaunt-sloth/core/config.js', () => ({ initConfig: initConfigMock }));

// ── core/GthAgentRunner ───────────────────────────────────────────────────────
const runnerInitMock = vi.fn();
const runnerGetAgentMock = vi.fn();
const runnerCleanupMock = vi.fn();
vi.mock('@gaunt-sloth/core/core/GthAgentRunner.js', () => {
  const GthAgentRunner = vi.fn();
  GthAgentRunner.prototype.init = runnerInitMock;
  GthAgentRunner.prototype.getAgent = runnerGetAgentMock;
  GthAgentRunner.prototype.cleanup = runnerCleanupMock;
  GthAgentRunner.prototype.processMessagesWithEvents = vi.fn();
  GthAgentRunner.prototype.resetThread = vi.fn();
  GthAgentRunner.prototype.setToolApprovalCallback = vi.fn();
  // [[EXT-150]] — the return leg of the approval conversation, wired beside the callback above.
  GthAgentRunner.prototype.setApprovalOutcomeCallback = vi.fn();
  GthAgentRunner.prototype.setAttackHaltCallback = vi.fn();
  GthAgentRunner.prototype.setNegotiationDisplay = vi.fn();
  // CFG-26 — the session module seeds the status bar from the resolved posture and wires the
  // `/approvals` family through the runner.
  // CFG-26 — the session module seeds the status bar from the RESOLVED posture and wires the
  // `/approvals` family through these.
  GthAgentRunner.prototype.getSessionApprovals = vi.fn().mockReturnValue({
    mode: 'ask',
    rater: { enabled: false, strictness: 'standard', escalate: 'danger' },
    allowlist: true,
    persistAllowlist: true,
  });
  GthAgentRunner.prototype.setSessionApprovalMode = vi.fn();
  GthAgentRunner.prototype.getAllowlistCounts = vi
    .fn()
    .mockReturnValue({ session: 0, always: undefined });
  return { GthAgentRunner };
});

vi.mock('@gaunt-sloth/core/core/types.js', () => ({ StatusLevel: {} }));

// ── core/consoleUtils + fileUtils ─────────────────────────────────────────────
vi.mock('@gaunt-sloth/core/utils/consoleUtils.js', () => ({
  flushSessionLog: vi.fn(),
  initSessionLogging: vi.fn(),
  stopSessionLogging: vi.fn(),
  // TUI-C19 — the load-time warning-capture window wrapped around initConfig.
  beginWarningCapture: vi.fn(),
  endWarningCapture: vi.fn(() => []),
}));
vi.mock('@gaunt-sloth/core/utils/fileUtils.js', () => ({
  appendToFile: vi.fn(),
  getCommandOutputFilePath: vi.fn(() => undefined),
}));

// ── systemUtils (stdout is the launch-bump target) ─────────────────────────────
// Stable object so the named binding tuiSessionModule imported keeps pointing at it; tests
// mutate properties rather than reassigning.
const systemUtilsMock = {
  env: {} as Record<string, string | undefined>,
  getProjectDir: vi.fn(() => '/proj'),
  stdout: { isTTY: true, rows: 24, write: vi.fn() } as {
    isTTY?: boolean;
    rows?: number;
    write: ReturnType<typeof vi.fn>;
  },
  // TUI-C37 — mouse reports arrive on stdin, so the module reads it to build the filtered proxy.
  stdin: Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: vi.fn(),
    ref: vi.fn(),
    unref: vi.fn(),
  }),
};
vi.mock('@gaunt-sloth/core/utils/systemUtils.js', () => systemUtilsMock);

// ── langchain + agent deps (kept inert) ────────────────────────────────────────
vi.mock('@langchain/core/messages', () => ({ HumanMessage: vi.fn() }));
vi.mock('@langchain/langgraph', () => ({ MemorySaver: vi.fn() }));
// GS2-20 — the session's checkpointer comes from this seam. Stubbed here so the spec does not
// load the real SQLite saver (which needs more of @langchain/langgraph than the stub above
// provides, and would open a database this spec has no interest in). A plain function, not a
// vi.fn, so a `vi.resetAllMocks()` in beforeEach cannot strip its return value; the returned
// object is shared so a test can assert that THIS saver and THIS thread id reached the runner.
const checkpointerStub = vi.hoisted(() => ({
  saver: { marker: 'session-checkpointer-saver' },
  durable: true,
  threadId: 'session-thread-id',
  close: () => {},
}));
vi.mock('@gaunt-sloth/core/history/sessionCheckpointer.js', () => ({
  openSessionCheckpointerSafe: () => checkpointerStub,
}));
// GS2-20 — the history recorder is stubbed for the same reason: this spec does not test history,
// and with recording on by default a config naming no `dbPath` resolves the user's real
// `~/.gsloth/history.db` and writes to it. Plain functions, not vi.fn, so a `vi.resetAllMocks()`
// in beforeEach cannot strip their return values.
vi.mock('@gaunt-sloth/core/history/recordSession.js', () => ({
  openConversationSafe: () => null,
  recordSessionSafe: () => null,
  lookupConversationThreadSafe: () => null,
}));
// GS2-107 — and the READ side of the same file, which the two stubs above do not cover. Every
// session builds its `/history` `/insights` `/search` props at start from
// `openHistoryStore(resolveHistoryDbPath(config.history?.dbPath))`, and a config naming no
// `dbPath` — which is what these cells pass — resolves the developer's real `~/.gsloth/history.db`.
// Opening it is not read-only: the store migrates on every open, so a real store predating a schema
// addition is rewritten by a spec that only meant to look at it. `null` is the module's own
// fail-soft path (the slash commands then carry their "history unavailable" notices), and no cell
// in this file asserts on history content.
vi.mock('@gaunt-sloth/core/history/historyStore.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gaunt-sloth/core/history/historyStore.js')>()),
  resolveHistoryDbPath: () => '/gsloth-spec-never-a-real-store/history.db',
  openHistoryStore: () => null,
}));
vi.mock('@gaunt-sloth/agent/resolvers.js', () => ({ createResolvers: vi.fn() }));
const resolvedFactory = vi.hoisted(() => vi.fn());
const resolveAgentFactoryMock = vi.hoisted(() => vi.fn());
vi.mock('@gaunt-sloth/agent/core/resolveAgentFactory.js', () => ({
  resolveAgentFactory: resolveAgentFactoryMock,
}));

// ── tui-local deps ─────────────────────────────────────────────────────────────
vi.mock('#src/tui/components/App.js', () => ({ App: vi.fn(() => null) }));
// The hermetic e2e seam (GTH_TUI_E2E_FIXTURE) — mocked so the fixture branch's own copy of the
// TTY gate is reachable from a unit test.
const createFixtureTuiAgentMock = vi.fn();
vi.mock('#src/tui/fixtureAgent.js', () => ({
  createFixtureTuiAgent: createFixtureTuiAgentMock,
}));
vi.mock('#src/tui/debugRender.js', () => ({
  renderHistory: vi.fn(),
  renderSystemDetails: vi.fn(),
  renderToolDetails: vi.fn(),
  renderResponse: vi.fn(),
  // TUI-C20 — the MCP overview tab's collector + renderer, threaded through the debug bridge.
  collectMcpOverview: vi.fn(() => ({ servers: [], instructions: [], failures: [] })),
  renderMcpDetails: vi.fn(),
}));

const sessionConfig = {
  mode: 'chat',
  readyMessage: 'ready',
  exitMessage: 'exit hint',
} as SessionConfig;
const overrides = {} as CommandLineConfigOverrides;

describe('createTuiSession — the full-screen surface (TUI-C48)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    systemUtilsMock.env = {}; // no fixture -> production path
    systemUtilsMock.stdout.isTTY = true;
    systemUtilsMock.stdout.rows = 24;
    initConfigMock.mockResolvedValue({});
    resolveAgentFactoryMock.mockReturnValue(resolvedFactory);
    runnerInitMock.mockResolvedValue(undefined);
    runnerGetAgentMock.mockReturnValue({});
    runnerCleanupMock.mockResolvedValue(undefined);
    renderMock.mockReturnValue({
      clear: vi.fn(),
      waitUntilExit: vi.fn().mockResolvedValue(undefined),
    });
  });

  // TUI-C48 — the one seam that makes the session full-screen. Ink owns entering and leaving the
  // alternate buffer AND restoring the user's original screen on every exit path including signals
  // (measured), so what this repo has to get right is exactly this option being set — and it is
  // the sort of thing a refactor drops silently, because nothing else observably changes.
  it('renders into the alternate screen', async () => {
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await createTuiSession(sessionConfig, overrides);

    expect(renderMock).toHaveBeenCalledTimes(1);
    const options = renderMock.mock.calls[0][1] as { alternateScreen?: boolean };
    expect(options.alternateScreen).toBe(true);
  });

  // TUI-C79 — the option that hands Ctrl+C to <App> at all, on the render a real session uses.
  // Without it Ink swallows the byte before any subscriber sees it and unmounts, which reverts the
  // whole ladder (scrap the draft / stop the turn / leave) to an unconditional exit AND skips the
  // `onExit` teardown the fail-closed bridges hang on. It is asserted here because the PTY suites
  // cannot reach it: the ones that drive this render only assert that the session ended, which an
  // Ink unmount satisfies just as well, and the rest set `GTH_TUI_E2E_FIXTURE` and drive the fixture
  // render instead. Same shape as <SelectList>'s own assertion for its nested render.
  it('hands Ctrl+C to <App> instead of letting Ink exit on it', async () => {
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await createTuiSession(sessionConfig, overrides);

    expect(renderMock).toHaveBeenCalledTimes(1);
    const options = renderMock.mock.calls[0][1] as { exitOnCtrlC?: boolean };
    expect(options.exitOnCtrlC).toBe(false);
  });

  it('writes no viewport bump of its own — the alternate screen replaced it', async () => {
    // The TUI-C13 launch bump pushed a screenful of newlines into the user's scrollback and then
    // homed the cursor. In the alternate screen that is both pointless and destructive: the buffer
    // Ink switches to is already blank, and the newlines would scroll the user's real screen away
    // for nothing. Assert on the BYTES rather than on the absence of a call, because the session
    // legitimately writes other escapes (see the alternate-scroll block below).
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await createTuiSession(sessionConfig, overrides);

    const written = systemUtilsMock.stdout.write.mock.calls.map((c: unknown[]) => c[0]).join('');
    expect(written).not.toContain('\n');
    expect(written).not.toContain('\x1b[H');
    expect(written).not.toContain('\x1b[J');
  });

  // TUI-C48 constraint 7 — in the alternate screen a terminal with NO mouse mode set converts wheel
  // notches into bare Up/Down arrows, which the slash-command menu claims. Exactly one of the two
  // terminal modes is installed at a time, and this is the pair that proves it: neither "always
  // suppress" nor "never suppress" passes both halves.
  describe('alternate-scroll suppression', () => {
    it('suppresses alternate-scroll when mouse tracking is OFF', async () => {
      initConfigMock.mockResolvedValue({ useMouse: false });
      const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

      await createTuiSession(sessionConfig, overrides);

      const written = systemUtilsMock.stdout.write.mock.calls.map((c: unknown[]) => c[0]).join('');
      expect(written).toContain('\x1b[?1007l');
      expect(written).not.toContain('\x1b[?1000h');
    });

    it('leaves alternate-scroll alone when mouse tracking is ON', async () => {
      // With tracking on the terminal reports the wheel as an SGR event and alternate-scroll never
      // applies, so touching it would change a user's terminal setting for no reason.
      initConfigMock.mockResolvedValue({ useMouse: true });
      const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

      await createTuiSession(sessionConfig, overrides);

      const written = systemUtilsMock.stdout.write.mock.calls.map((c: unknown[]) => c[0]).join('');
      expect(written).toContain('\x1b[?1000h');
      expect(written).not.toContain('\x1b[?1007l');
    });
  });

  it('selects the agent backend via resolveAgentFactory(config, "lean") — B5 (regression: TUI path)', async () => {
    const backendConfig = { agent: { backend: 'deep' } };
    initConfigMock.mockResolvedValue(backendConfig);
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');
    const { GthAgentRunner } = await import('@gaunt-sloth/core/core/GthAgentRunner.js');

    await createTuiSession(sessionConfig, overrides);

    // The TUI is the default interactive surface, so it must ask for LEAN like the readline /
    // ask / exec paths. It routes through resolveAgentFactory rather than a hardcoded factory, so
    // the config seam stays the one place a backend is chosen.
    expect(resolveAgentFactoryMock).toHaveBeenCalledWith(backendConfig, 'lean');
    // …and the resolved factory is the one handed to the runner as the 3rd ctor arg.
    const runnerCall = (GthAgentRunner as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0];
    expect(runnerCall[2]).toBe(resolvedFactory);
  });

  it('GS2-20: drives the session checkpointer and its thread id', async () => {
    initConfigMock.mockResolvedValue({});
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await createTuiSession(sessionConfig, overrides);

    // The Ink TUI is the DEFAULT interactive surface, so it is the one that has to be resumable.
    // Both halves are asserted because either alone is useless: the saver is where the state goes,
    // and the thread id is the name the stored conversation is found under.
    const [, , saver, options] = runnerInitMock.mock.calls[0];
    expect(saver).toBe(checkpointerStub.saver);
    expect(options?.threadId).toBe(checkpointerStub.threadId);
  });

  // Both quieter rungs, because the override has to beat the whole ladder and not just the one
  // value someone happened to write a cell for.
  it.each(['none', 'compact'] as const)(
    'GS2-93: forces the debug run-header rung for the TUI even when config sets %s',
    async (rung) => {
      // The `output.header` rungs grade non-TUI text modes only; the interactive TUI must ALWAYS
      // show the full run-header preamble, so createTuiSession overrides the setting.
      initConfigMock.mockResolvedValue({ output: { header: rung } });
      const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

      await createTuiSession(sessionConfig, overrides);

      expect(runnerInitMock).toHaveBeenCalledTimes(1);
      const initConfigArg = runnerInitMock.mock.calls[0][1] as { output?: { header?: string } };
      expect(initConfigArg.output?.header).toBe('debug');
    }
  );

  // GS2-101: the rung an unset key resolves to is `compact`, so "no output block at all" is now the
  // case that would silently strip the TUI's preamble if the override were ever dropped — and it is
  // the case almost every real session runs in. The rows above cannot see it: they both set a rung.
  it('GS2-101: forces the debug run-header rung for the TUI when config sets no output block', async () => {
    initConfigMock.mockResolvedValue({});
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await createTuiSession(sessionConfig, overrides);

    expect(runnerInitMock).toHaveBeenCalledTimes(1);
    const initConfigArg = runnerInitMock.mock.calls[0][1] as { output?: { header?: string } };
    expect(initConfigArg.output?.header).toBe('debug');
  });

  // CFG-25 — call-site wiring: createTuiSession must pass sessionConfig.mode into the (real,
  // unmocked) formatConfigSummary so the /config panel prop carries the EFFECTIVE per-command
  // filesystem. If a refactor drops the second argument, the prop reads `Filesystem: none` and
  // this fails — the original live bug.
  it('passes the session mode through to the configSummary prop (CFG-25 wiring)', async () => {
    initConfigMock.mockResolvedValue({
      filesystem: 'none',
      commands: { chat: { filesystem: 'read' } },
    });
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await createTuiSession(sessionConfig, overrides);

    const appElement = renderMock.mock.calls[0][0] as { props: { configSummary: string[] } };
    expect(appElement.props.configSummary).toContain('Filesystem: read (chat; top-level: none)');
    expect(appElement.props.configSummary).not.toContain('Filesystem: none');
  });

  it('still asks for the alternate screen on a non-TTY, because Ink is what no-ops it', async () => {
    // Ink resolves `alternateScreen` against its own interactive/TTY detection and writes nothing
    // on a pipe. Gating it here as well would be a second copy of that policy, free to drift — and
    // the surface that would break is the one nobody watches.
    systemUtilsMock.stdout.isTTY = false;
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await createTuiSession(sessionConfig, overrides);

    expect(renderMock).toHaveBeenCalledTimes(1);
    expect((renderMock.mock.calls[0][1] as { alternateScreen?: boolean }).alternateScreen).toBe(
      true
    );
  });

  // TUI-C33 — the banner is terminal chrome, so it must be gated on stdout being a real TTY on
  // BOTH interactive surfaces. The plain surface's half of this is proved in
  // interactiveSessionModule.banner.spec.ts; this is the TUI's half.
  it('TUI-C33: gates showLaunchBanner on stdout being a TTY', async () => {
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');
    const bannerProp = async (isTTY: boolean): Promise<boolean> => {
      renderMock.mockClear();
      systemUtilsMock.stdout.isTTY = isTTY;
      await createTuiSession(sessionConfig, overrides);
      return (renderMock.mock.calls[0][0] as { props: { showLaunchBanner: boolean } }).props
        .showLaunchBanner;
    };

    expect(await bannerProp(true)).toBe(true);
    // Piped/redirected stdout gets no banner — and the prop is a strict boolean, never `undefined`.
    expect(await bannerProp(false)).toBe(false);
  });

  it('TUI-C33: gates showLaunchBanner on a TTY in the hermetic e2e branch too', async () => {
    // The fixture seam mounts its own <App> with its own copy of the gate, so it needs its own
    // assertion — otherwise a regression there is invisible until the PTY suite runs.
    systemUtilsMock.env = { GTH_TUI_E2E_FIXTURE: '/fixtures/session.json' };
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    systemUtilsMock.stdout.isTTY = false;
    await createTuiSession(sessionConfig, overrides);
    expect(
      (renderMock.mock.calls[0][0] as { props: { showLaunchBanner: boolean } }).props
        .showLaunchBanner
    ).toBe(false);
    // The fixture branch never reaches initConfig — it is the pre-config seam.
    expect(initConfigMock).not.toHaveBeenCalled();

    renderMock.mockClear();
    systemUtilsMock.stdout.isTTY = true;
    await createTuiSession(sessionConfig, overrides);
    expect(
      (renderMock.mock.calls[0][0] as { props: { showLaunchBanner: boolean } }).props
        .showLaunchBanner
    ).toBe(true);
  });

  it('TUI-C33: threads modelProviderType from the resolved config into <App>', async () => {
    // The banner names the provider, which the status bar does not — so this is the only path by
    // which the provider reaches the screen.
    initConfigMock.mockResolvedValue({ modelDisplayName: 'gpt-5', modelProviderType: 'openai' });
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await createTuiSession(sessionConfig, overrides);

    const { props } = renderMock.mock.calls[0][0] as {
      props: { modelDisplayName?: string; modelProviderType?: string };
    };
    expect(props.modelProviderType).toBe('openai');
    expect(props.modelDisplayName).toBe('gpt-5');
  });

  it('TUI-C17: runTurn merges live tool output emitted mid-run into the event stream', async () => {
    // The real toolOutputChannel is deliberately NOT mocked here: this proves the session wires
    // runTurn through mergeToolOutputIntoEvents, so a toolkit's emitToolOutput during a run
    // surfaces as a typed `tool_output` event in the stream the <App> folds — instead of hitting
    // the raw stdout default sink and corrupting Ink's frame.
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');
    const { GthAgentRunner } = await import('@gaunt-sloth/core/core/GthAgentRunner.js');
    const { emitToolOutput } = await import('@gaunt-sloth/core/core/toolOutputChannel.js');

    (
      GthAgentRunner.prototype.processMessagesWithEvents as ReturnType<typeof vi.fn>
    ).mockImplementation(async function* () {
      yield { type: 'text', delta: 'running the tool' };
      // A toolkit streaming child output while the graph run is in flight.
      emitToolOutput({
        toolCallId: 'c1',
        toolName: 'run_tests',
        kind: 'output',
        text: 'suite green\n',
      });
      yield { type: 'tool_result', id: 'c1', content: 'done' };
    });

    await createTuiSession(sessionConfig, overrides);

    const appElement = renderMock.mock.calls[0][0] as {
      props: {
        agent: {
          runTurn: (input: string, signal: AbortSignal) => AsyncGenerator<unknown>;
        };
      };
    };
    const events: unknown[] = [];
    for await (const event of appElement.props.agent.runTurn('go', new AbortController().signal)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'text', delta: 'running the tool' },
      { type: 'tool_output', id: 'c1', name: 'run_tests', chunk: 'suite green\n' },
      { type: 'tool_result', id: 'c1', content: 'done' },
    ]);
    // Nothing leaked to raw stdout while the turn's subscription was live.
    expect(systemUtilsMock.stdout.write).not.toHaveBeenCalledWith('suite green\n');
  });
});

/**
 * TUI-C37 — the session module's mouse wiring. The point of these is the negative case: a run with
 * mouse off must be byte-identical to one built before mouse existed, which is what keeps piped and
 * captured output clean.
 */
describe('createTuiSession — mouse wiring (TUI-C37)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    systemUtilsMock.env = {};
    systemUtilsMock.stdout.isTTY = true;
    systemUtilsMock.stdout.rows = 24;
    resolveAgentFactoryMock.mockReturnValue(resolvedFactory);
    runnerInitMock.mockResolvedValue(undefined);
    runnerGetAgentMock.mockReturnValue({});
    runnerCleanupMock.mockResolvedValue(undefined);
    renderMock.mockReturnValue({
      clear: vi.fn(),
      waitUntilExit: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('writes no mouse escape bytes at all when the resolved config says mouse is off', async () => {
    initConfigMock.mockResolvedValue({ useMouse: false });
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await createTuiSession(sessionConfig, overrides);

    const written = systemUtilsMock.stdout.write.mock.calls.map((c) => c[0] as string).join('');
    expect(written).not.toContain('1006');
    expect(written).not.toContain('1000h');
  });

  it('still installs the stdin filter when mouse is off, so /mouse on can work later', async () => {
    // The filter has to be in front of Ink before render, and Ink can never be handed a different
    // stdin afterwards. Making it conditional is what silently broke `/mouse on` in a session that
    // started with mouse off: the state flipped, the notice printed, and nothing happened.
    initConfigMock.mockResolvedValue({ useMouse: false });
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await createTuiSession(sessionConfig, overrides);

    const options = renderMock.mock.calls[0][1] as { stdin: unknown };
    expect(options.stdin).toBeDefined();
    expect(options.stdin).not.toBe(systemUtilsMock.stdin);
  });

  it('lets a session that started with mouse off turn reporting on', async () => {
    initConfigMock.mockResolvedValue({ useMouse: false });
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await createTuiSession(sessionConfig, overrides);
    const before = systemUtilsMock.stdout.write.mock.calls.map((c) => c[0] as string).join('');
    expect(before).not.toContain('\x1b[?1006h');

    // The App asks the session module to apply the toggle; this is that call.
    const appElement = renderMock.mock.calls[0][0] as {
      props: { onSetMouse?: (enabled: boolean) => void };
    };
    appElement.props.onSetMouse?.(true);

    const after = systemUtilsMock.stdout.write.mock.calls.map((c) => c[0] as string).join('');
    expect(after).toContain('\x1b[?1006h');
  });

  it('enables reporting and hands Ink the FILTERED stdin when mouse is on', async () => {
    initConfigMock.mockResolvedValue({ useMouse: true });
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await createTuiSession(sessionConfig, overrides);

    const written = systemUtilsMock.stdout.write.mock.calls.map((c) => c[0] as string).join('');
    expect(written).toContain('\x1b[?1006h');
    // Not the real stdin: mouse reports must be stripped before Ink ever sees them.
    const options = renderMock.mock.calls[0][1] as { stdin: unknown };
    expect(options.stdin).toBeDefined();
    expect(options.stdin).not.toBe(systemUtilsMock.stdin);
  });

  it('restores the terminal after the session ends', async () => {
    initConfigMock.mockResolvedValue({ useMouse: true });
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await createTuiSession(sessionConfig, overrides);

    const written = systemUtilsMock.stdout.write.mock.calls.map((c) => c[0] as string).join('');
    expect(written).toContain('\x1b[?1006l');
  });

  it('restores the terminal even when the session throws', async () => {
    // The path that leaves a shell spewing escape gibberish if it is missed.
    initConfigMock.mockResolvedValue({ useMouse: true });
    renderMock.mockReturnValue({
      clear: vi.fn(),
      waitUntilExit: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await expect(createTuiSession(sessionConfig, overrides)).rejects.toThrow('boom');

    const written = systemUtilsMock.stdout.write.mock.calls.map((c) => c[0] as string).join('');
    expect(written).toContain('\x1b[?1006l');
  });

  it('seeds the App with the resolved mouse state', async () => {
    initConfigMock.mockResolvedValue({ useMouse: true });
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await createTuiSession(sessionConfig, overrides);

    const appElement = renderMock.mock.calls[0][0] as { props: { mouseEnabled?: boolean } };
    expect(appElement.props.mouseEnabled).toBe(true);
  });
});

const renderPhaseBeforeEach = (): void => {
  vi.resetAllMocks();
  systemUtilsMock.env = {};
  systemUtilsMock.stdout.isTTY = true;
  systemUtilsMock.stdout.rows = 24;
  initConfigMock.mockResolvedValue({});
  resolveAgentFactoryMock.mockReturnValue(resolvedFactory);
  runnerInitMock.mockResolvedValue(undefined);
  runnerGetAgentMock.mockReturnValue({});
  runnerCleanupMock.mockResolvedValue(undefined);
  renderMock.mockReturnValue({
    clear: vi.fn(),
    waitUntilExit: vi.fn().mockResolvedValue(undefined),
  });
};

/**
 * CFG-47 — where the render phase begins.
 *
 * `startSession` falls back to readline only for a failure this function reports as being in the
 * render phase, so the VALUE of that narrowing is entirely in where the announcement sits.
 * `startSession.configError.spec.ts` proves the dispatcher obeys the signal; these cells prove the
 * signal is raised in the right place — the two halves are worthless apart, because a correct
 * dispatcher fed a boundary that moved to the top of the function would fall back for everything
 * again, and every cell over there would stay green.
 *
 * The two failures pinned as pre-render are the two the node named: the config load, and
 * `runner.init` (which is where the `subagents[].profile` configs resolve). Both are things the
 * readline path does identically.
 */
describe('createTuiSession — the render-phase boundary (CFG-47)', () => {
  beforeEach(renderPhaseBeforeEach);

  it('announces the render phase exactly once, and not before the render', async () => {
    const order: string[] = [];
    renderMock.mockImplementation(() => {
      order.push('render');
      return { clear: vi.fn(), waitUntilExit: vi.fn().mockResolvedValue(undefined) };
    });
    const onRenderStart = vi.fn(() => {
      order.push('onRenderStart');
    });
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await createTuiSession(sessionConfig, overrides, undefined, onRenderStart);

    expect(onRenderStart).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['onRenderStart', 'render']);
  });

  it('does NOT announce it when the config load fails', async () => {
    const configFailure = new Error('identity profile "typo" not found');
    initConfigMock.mockRejectedValue(configFailure);
    const onRenderStart = vi.fn();
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await expect(createTuiSession(sessionConfig, overrides, undefined, onRenderStart)).rejects.toBe(
      configFailure
    );

    // Never announced ⇒ `startSession` propagates instead of printing "TUI unavailable".
    expect(onRenderStart).not.toHaveBeenCalled();
    expect(renderMock).not.toHaveBeenCalled();
  });

  it('does NOT announce it when runner.init fails', async () => {
    // The subagent-profile resolution point, and the one furthest down the setup — if the
    // boundary ever drifts upward, this is the cell that catches it.
    const initFailure = new Error('subagent profile "reviewer" could not be prepared');
    runnerInitMock.mockRejectedValue(initFailure);
    const onRenderStart = vi.fn();
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await expect(createTuiSession(sessionConfig, overrides, undefined, onRenderStart)).rejects.toBe(
      initFailure
    );

    expect(onRenderStart).not.toHaveBeenCalled();
    expect(renderMock).not.toHaveBeenCalled();
  });

  it('announces it on the hermetic e2e branch, which is render from its first line', async () => {
    // That branch deliberately loads no config, so it shares nothing with the readline path and
    // must keep the fallback it has always had — otherwise a fixture problem stops degrading and
    // starts crashing the PTY harness.
    systemUtilsMock.env = { GTH_TUI_E2E_FIXTURE: '/fixtures/session.json' };
    const onRenderStart = vi.fn();
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await createTuiSession(sessionConfig, overrides, undefined, onRenderStart);

    expect(onRenderStart).toHaveBeenCalledTimes(1);
  });
});

/**
 * TUI-C56 — the deferred exit-output channel, at the only point where its timing is decidable.
 *
 * The channel itself is a queue (`packages/core/spec/exitOutputChannel.spec.ts` has its
 * contract). What cannot be tested there is the property the node exists for: the text is written
 * AFTER Ink has unmounted and given the primary screen back, and never while the frame is live,
 * because Ink discards alternate-screen teardown output by design. So these cells drive the real
 * session and pin the ordering against the real `waitUntilExit()` boundary.
 *
 * Both sides of the boundary are asserted, and they fail in opposite directions: `writtenAtUnmount`
 * is the whole stdout log as it stood at the moment the unmount completed, so a drain moved even
 * one line earlier shows up there, while the second assertion catches a drain that never happens.
 * A cell asserting only that the line was eventually written would pass for a session that printed
 * it into the alternate screen — which is the bug.
 */
describe('createTuiSession — deferred exit output (TUI-C56, TUI-C104)', () => {
  const DEFERRED = 'Debug dump written (secrets redacted, review before sharing): /tmp/h/dump';

  beforeEach(renderPhaseBeforeEach);

  /** Everything stdout has been asked to write so far, joined — escapes and text alike. */
  const written = (): string =>
    systemUtilsMock.stdout.write.mock.calls.map((c: unknown[]) => c[0]).join('');

  /**
   * Render mock that defers a block WHILE THE FRAME IS LIVE — where a slash command actually runs,
   * after the session's own `clearExitOutput()` — and snapshots the stdout log at the instant the
   * unmount completes.
   */
  const deferDuringSession = (defer: (text: string) => void): { atUnmount: () => string } => {
    let atUnmount = '';
    renderMock.mockImplementation(() => {
      defer(DEFERRED);
      return {
        clear: vi.fn(),
        waitUntilExit: vi.fn(async () => {
          atUnmount = written();
        }),
      };
    });
    return { atUnmount: () => atUnmount };
  };

  it('writes deferred output after the unmount, and nothing of it into the live frame', async () => {
    const { deferExitOutput } = await import('@gaunt-sloth/core/core/exitOutputChannel.js');
    const snapshot = deferDuringSession(deferExitOutput);
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await createTuiSession(sessionConfig, overrides);

    // While Ink owned the screen, not a byte of it was written — anything written then would have
    // gone into the alternate buffer and been thrown away with it.
    expect(snapshot.atUnmount()).not.toContain(DEFERRED);
    // And once the screen was handed back, it was written in full, on a line of its own.
    expect(written()).toContain(`${DEFERRED}\n`);
  });

  it('writes it on the hermetic e2e branch too, on the same side of the unmount', async () => {
    // The branch the PTY suite drives: it mounts the real <App> with the real `/debug-dump`
    // writer, so a drain missing here would leave the e2e assertion proving nothing about the
    // surface a user gets.
    systemUtilsMock.env = { GTH_TUI_E2E_FIXTURE: '/fixtures/session.json' };
    const { deferExitOutput } = await import('@gaunt-sloth/core/core/exitOutputChannel.js');
    const snapshot = deferDuringSession(deferExitOutput);
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await createTuiSession(sessionConfig, overrides);

    expect(snapshot.atUnmount()).not.toContain(DEFERRED);
    expect(written()).toContain(`${DEFERRED}\n`);
  });

  it('writes nothing to a piped stdout, and drops what was deferred rather than queuing it', async () => {
    // A caller parsing this session's stdout must not be handed a trailing line it never asked
    // for. The second half matters as much as the first: a gate that skipped the drain would
    // leave the block queued for whatever ran next in the same process.
    systemUtilsMock.stdout.isTTY = false;
    const { deferExitOutput, drainExitOutput } =
      await import('@gaunt-sloth/core/core/exitOutputChannel.js');
    deferDuringSession(deferExitOutput);
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await createTuiSession(sessionConfig, overrides);

    expect(written()).not.toContain(DEFERRED);
    expect(drainExitOutput()).toEqual([]);
  });

  it('starts each session with an empty channel, so nothing earlier leaks into its exit', async () => {
    // Deferred before the session begins — by anything at all — is not this session's to print.
    const { deferExitOutput } = await import('@gaunt-sloth/core/core/exitOutputChannel.js');
    deferExitOutput('left over from something else');
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await createTuiSession(sessionConfig, overrides);

    expect(written()).not.toContain('left over from something else');
  });

  /**
   * TUI-C104 — the crash path. A throw raised once the frame is live leaves through the session's
   * `catch`; `startSession` then warns "TUI unavailable" and starts a readline session in the SAME
   * process. Before this node neither the throw nor that readline session drained, so the block the
   * user was told to go and open was discarded in silence — with a crash as the only symptom they
   * could see, and a missing line as the one they could not.
   *
   * The two cells are the two halves of the answer and fail in opposite directions: the first
   * catches a drain that never happens, the second catches a drain that leaves the block queued for
   * whatever runs next and so prints it twice.
   */
  const deferThenFail = (
    defer: (text: string) => void,
    failure: Error
  ): { atUnmount: () => string } => {
    let atUnmount = '';
    renderMock.mockImplementation(() => {
      defer(DEFERRED);
      return {
        clear: vi.fn(),
        waitUntilExit: vi.fn(async () => {
          atUnmount = written();
          throw failure;
        }),
      };
    });
    return { atUnmount: () => atUnmount };
  };

  /** How many times the block appears in everything stdout was asked to write. */
  const timesWritten = (): number => written().split(DEFERRED).length - 1;

  it('drains on a render-phase throw, after the unmount and exactly once (TUI-C104)', async () => {
    const failure = new Error('no raw mode');
    const { deferExitOutput } = await import('@gaunt-sloth/core/core/exitOutputChannel.js');
    const snapshot = deferThenFail(deferExitOutput, failure);
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await expect(createTuiSession(sessionConfig, overrides)).rejects.toBe(failure);

    // Same boundary the normal exit is held to: nothing of it while Ink still owned the screen —
    // Ink leaves the alternate screen inside its own unmount before it rejects the exit promise.
    expect(snapshot.atUnmount()).not.toContain(DEFERRED);
    // Written after it, on a line of its own, and written once BY THIS SURFACE — what this count
    // catches is a drain that ran on the throw path as well as on the normal exit path. Nothing
    // downstream can repeat it either, but that is the cell below, not this one.
    expect(written()).toContain(`${DEFERRED}\n`);
    expect(timesWritten()).toBe(1);
  });

  it('leaves the channel empty after that throw, so the session started next has nothing to print', async () => {
    // This is what makes the no-double-print property structural rather than a flag: the drain is
    // destructive and this `finally` completes before `startSession`'s `catch` runs, so the
    // readline session that follows finds an empty queue. (It would not drain one anyway — its
    // output already survives its own exit — and that half is pinned on the readline surface.)
    const failure = new Error('no raw mode');
    const { deferExitOutput, drainExitOutput } =
      await import('@gaunt-sloth/core/core/exitOutputChannel.js');
    deferThenFail(deferExitOutput, failure);
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await expect(createTuiSession(sessionConfig, overrides)).rejects.toBe(failure);

    expect(drainExitOutput()).toEqual([]);
  });

  it('drains a render-phase throw on the hermetic branch too, which has its own render path', async () => {
    // The drain lives on the one seam every branch unwinds through, so a branch is covered without
    // anyone remembering to add a call to it. This cell is what would go red if it were moved back
    // beside the render paths and a branch were missed.
    systemUtilsMock.env = { GTH_TUI_E2E_FIXTURE: '/fixtures/session.json' };
    const failure = new Error('fixture replay failed');
    const { deferExitOutput } = await import('@gaunt-sloth/core/core/exitOutputChannel.js');
    const snapshot = deferThenFail(deferExitOutput, failure);
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await expect(createTuiSession(sessionConfig, overrides)).rejects.toBe(failure);

    expect(snapshot.atUnmount()).not.toContain(DEFERRED);
    expect(timesWritten()).toBe(1);
  });

  it('writes nothing on a throw raised BEFORE anything could be deferred', async () => {
    // The pre-mount failures — the mouse plumbing, `render` itself — reach the drain with an empty
    // queue, because the only producer is a slash command and a slash command needs a mounted App.
    // So the drain is a no-op there by construction, not because the terminal state was guessed at.
    const failure = new Error('render exploded');
    renderMock.mockImplementation(() => {
      throw failure;
    });
    const { createTuiSession } = await import('#src/tui/tuiSessionModule.js');

    await expect(createTuiSession(sessionConfig, overrides)).rejects.toBe(failure);

    expect(written()).not.toContain(DEFERRED);
  });
});
