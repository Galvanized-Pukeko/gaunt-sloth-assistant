/**
 * **The `gaunt-sloth-api` bin's flags, and its bind, proved at the door.**
 *
 * ## Why this spawns, and why it connects
 *
 * `--port` and `--config` were accepted and dropped: `cli.js` read `argv[0]` and called
 * `initConfig({})`, so the port came only from `commands.api.port` and a `--config` naming a file
 * that does not exist was replaced by whatever discovery found in the working directory. Neither
 * failure is visible from inside the process — an assertion that an options object was built the
 * way the code builds it would have passed against the broken bin — so every cell here runs the
 * real file, through the real `bin` entry an installed user has on PATH.
 *
 * And the port cell **connects to the port**. A banner is a claim about a socket, and only the
 * socket can settle it: `GET /health` answering on the flag's port is the one thing that separates
 * a bound flag from a dropped one. The same holds for `--cors-origin`, whose cells send a real
 * preflight and read the header off the response: an allowed origin is a fact about what crossed
 * the wire, and the browser that refuses a chat request has no other source for it.
 *
 * ## Why a cell holds a port of its own
 *
 * The same reasoning covers the bind itself. Announcing a listen is not establishing one — express
 * runs the listen callback whether the bind succeeded or failed — so the suite starts the server on
 * a port it has taken and is holding, and requires a non-zero exit. It holds its own port rather
 * than reusing the configured or allocated one, because that port may be free, or held by something
 * unrelated, and neither case measures the bind. The complementary control is the free-port cell
 * above it, which must keep passing: banner, `/health`, and a process that is still running.
 *
 * ## Why the ports come from the OS rather than a fixed number
 *
 * A committed spec cannot hardcode a port: it runs on the Windows and macOS CI cells and beside
 * whatever else is live on a developer's box, and takahē's per-worktree allocator (OPS-8) writes a
 * gitignored `.env` that exists on no CI runner. Binding `:0` and reading back the assigned port
 * asks the OS for one that is free right now, which is stronger than any static reservation and
 * needs no coordination. Two distinct ports are drawn per precedence cell so that "the flag won"
 * and "the config file won" cannot be confused with each other or with the 3000 default.
 *
 * ## Hermetic and key-free
 *
 * The `fake` provider replays a canned answer, `allowedTools: []` skips tool resolution entirely
 * (so no MCP server is contacted), and the child's `HOME`/`USERPROFILE` point at an empty temp dir
 * so an ambient `~/.gsloth` global config cannot decide the outcome. `INIT_CWD` is dropped because
 * pnpm sets it to wherever `pnpm test` was invoked and `getCurrentWorkDir()` prefers it, which
 * would aim the run's config discovery at the repository instead of the temp dir under test.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cliEntry = resolve(here, '..', 'cli.js'); // packages/agent/cli.js — the `gaunt-sloth-api` bin

/** How long a spawned server gets to answer /health before a cell gives up. */
const BOOT_TIMEOUT_MS = 25000;
/** Per-cell timeout, above BOOT_TIMEOUT_MS so a slow boot fails on the poll's own message. */
const CELL_TIMEOUT_MS = 40000;
/** How long a killed child gets to actually die before cleanup stops waiting and says so. */
const EXIT_TIMEOUT_MS = 5000;
/**
 * The cleanup hook's own budget. Vitest's default hook timeout is 10s, which sits below the worst
 * case here (waiting out EXIT_TIMEOUT_MS, then the removal's retry backoff for each temp dir) — and
 * an opaque "hook timed out" would replace the message that names what actually went wrong.
 */
const CLEANUP_TIMEOUT_MS = 30000;

/** A port nothing is listening on, straight from the OS. */
function freePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createServer();
    probe.on('error', rejectPort);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => (port ? resolvePort(port) : rejectPort(new Error('no port assigned'))));
    });
  });
}

/**
 * An IPv4 address this machine holds on a real network interface — the LAN address a second box
 * would dial, and the one address that separates a loopback bind from a wildcard one.
 *
 * Enumerated from the machine's own interfaces rather than hardcoded: a runner's private address
 * differs across the Linux, macOS and Windows cells, and any literal would be wrong on two of the
 * three. IPv4 because the opt-in these cells pass is `0.0.0.0`.
 *
 * Returns `undefined` when the machine has nothing but loopback. No cell skips on that — the
 * exposure cell below fails and says so, which is the honest outcome for an environment that
 * cannot express the measurement.
 */
function lanAddress(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return undefined;
}

/**
 * `GET /health` on one address, or the reason nothing came back.
 *
 * Bounded, and reported as "no answer" rather than by errno: a refusal is `ECONNREFUSED` here and
 * a different string on win32, and a host-firewall that drops instead of refusing produces a
 * timeout rather than an error at all. What both cells actually assert is whether an HTTP response
 * exists, which is the same question on every platform.
 */
async function healthFrom(address: string, port: number): Promise<number | 'no answer'> {
  try {
    const response = await fetch(`http://${address}:${port}/health`, {
      signal: AbortSignal.timeout(4000),
    });
    return response.status;
  } catch {
    return 'no answer';
  }
}

/** A port held open for the length of a cell, so a server starting on it must collide. */
interface HeldPort {
  port: number;
  release: () => Promise<void>;
}

/**
 * Take a port and keep it.
 *
 * The holder binds **exactly the address the server under test will bind** — IPv4 loopback, which
 * is what an unconfigured `gaunt-sloth-api` asks for. Identical address and port is the one
 * collision every platform agrees on; a holder on a *different* address that merely overlaps (the
 * wildcard against loopback, say) leaves the outcome to that platform's rules for overlapping
 * binds, which is how a collision cell passes here and flakes on the Windows runner. The OS picks
 * the number, so the cell reserves nothing and assumes nothing about what else is live on the
 * machine — the port it collides on is one it is holding itself.
 */
function holdPort(): Promise<HeldPort> {
  return new Promise((resolveHold, rejectHold) => {
    const holder = createServer();
    holder.on('error', rejectHold);
    holder.listen(0, '127.0.0.1', () => {
      const address = holder.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      if (!port) {
        holder.close(() => rejectHold(new Error('no port assigned')));
        return;
      }
      resolveHold({
        port,
        release: () => new Promise<void>((done) => holder.close(() => done())),
      });
    });
  });
}

/** The child's environment: no ambient home, no inherited cwd, no tracing. */
function childEnv(home: string): NodeJS.ProcessEnv {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.INIT_CWD;
  // LangSmith tracing would turn a hermetic run into a networked one; clearLangSmithEnv() in
  // packages/app/vitest.setup.ts clears it from process.env before any spec runs, so the child
  // inherits none of it.
  return env;
}

/** A config the fake provider can serve with no key and no network. */
function writeFixtureConfig(path: string, port?: number, allowOrigin?: string): void {
  const api = {
    ...(port === undefined ? {} : { port }),
    ...(allowOrigin === undefined ? {} : { cors: { allowOrigin } }),
  };
  writeFileSync(
    path,
    JSON.stringify({
      llm: { type: 'fake', responses: ['CFG-62 fake answer'] },
      // An empty allow-list disables tool resolution outright, so no MCP/A2A server is contacted
      // just to have the result discarded — see GthLangChainAgent.init.
      allowedTools: [],
      ...(Object.keys(api).length === 0 ? {} : { commands: { api } }),
    })
  );
}

/**
 * OPS-16 — the origin the demo's config pins, and the origin a relocated web client actually has.
 *
 * Both are literals here, and they are literals on purpose. A cell that read either one from the
 * fixture config, from a `.env`, or from the port allocator would assert that two derivations of
 * the same value agree, which they do whether or not the flag is honoured. `5556` is the port vite
 * takes when 5555 is held — the port from this node's original repro — and it is only a
 * discriminating expectation while it differs from the pinned one.
 */
const PINNED_ORIGIN = 'http://localhost:5555';
const RELOCATED_ORIGIN = 'http://localhost:5556';

/**
 * Send a CORS preflight from `origin` and return what the server allows.
 *
 * A real `OPTIONS` over the socket, because that is the request a browser actually refuses on: the
 * header this reads is the whole subject, and any assertion made inside the process would pass on a
 * server whose middleware never reached the wire.
 */
async function preflightAllowOrigin(port: number, origin: string): Promise<string | null> {
  const response = await fetch(`http://127.0.0.1:${port}/agents/default/run`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
    signal: AbortSignal.timeout(4000),
  });
  return response.headers.get('access-control-allow-origin');
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** The bound expiring, as a value no child's error message can impersonate. */
const TIMED_OUT = Symbol('the child did not exit within the bound');

/**
 * Resolve once the child is no longer running: `undefined` when it exited, a description when it
 * never ran at all.
 *
 * **Call this when the child is spawned, not during cleanup.** `exit` fires exactly once, so a
 * listener attached after the fact would wait out the whole bound on a process that is long gone.
 * A failure to spawn emits `error` and may emit no `exit`; that child holds nothing either, and is
 * reported as itself rather than as a wedged process.
 */
function whenGone(child: ChildProcess): Promise<string | undefined> {
  return new Promise((done) => {
    if (child.exitCode !== null || child.signalCode !== null) return done(undefined);
    child.once('exit', () => done(undefined));
    child.once('error', (err: Error) => done(`it never ran (${err.message})`));
  });
}

/** Wait for a child to be gone, but not forever — a wedged one must fail this hook, not hang it. */
async function goneWithin(gone: Promise<string | undefined>): Promise<string | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<typeof TIMED_OUT>((done) => {
    timer = setTimeout(() => done(TIMED_OUT), EXIT_TIMEOUT_MS);
  });
  try {
    const outcome = await Promise.race([gone, expired]);
    return outcome === TIMED_OUT
      ? `it was still running ${EXIT_TIMEOUT_MS}ms after SIGKILL`
      : outcome;
  } finally {
    // Otherwise every cell leaves a pending timer behind at teardown.
    clearTimeout(timer);
  }
}

/**
 * Poll `GET /health` until it answers or the deadline passes.
 *
 * Asynchronous on purpose: a busy `while` loop cannot be interrupted by vitest's timeout, so a
 * server that never binds would hang the run instead of failing this cell.
 */
async function waitForHealth(
  port: number,
  child: ChildProcess,
  transcript: () => string
): Promise<number> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  let lastError = '';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `the server exited with code ${child.exitCode} before binding ${port}; it said:\n${transcript()}`
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      return response.status;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(200);
  }
  throw new Error(
    `nothing answered on ${port} within ${BOOT_TIMEOUT_MS}ms (last: ${lastError}); the server said:\n${transcript()}`
  );
}

/**
 * The banner, and the port it names.
 *
 * The host is pinned to the loopback literal rather than matched loosely, because the banner is
 * the claim under test in half these cells: a pattern that accepted any host would keep passing on
 * a server that bound the wildcard and said so.
 */
const LISTENING_BANNER = /AG-UI server listening at http:\/\/127\.0\.0\.1:(\d+)/;

/**
 * Wait for the startup banner and read the port out of it.
 *
 * A caller who asked for port 0 has no other way to learn which port they got, so the banner is
 * the interface here rather than decoration.
 */
async function waitForAnnouncedPort(
  child: ChildProcess,
  transcript: () => string
): Promise<number> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `the server exited with code ${child.exitCode} before announcing a port; it said:\n${transcript()}`
      );
    }
    const announced = LISTENING_BANNER.exec(transcript());
    if (announced) return Number(announced[1]);
    await sleep(200);
  }
  throw new Error(
    `no listening banner within ${BOOT_TIMEOUT_MS}ms; the server said:\n${transcript()}`
  );
}

describe('the gaunt-sloth-api bin reads the flags it accepts', () => {
  /** Each spawned server, paired with the promise that resolves when it is really gone. */
  const children: { child: ChildProcess; gone: Promise<string | undefined> }[] = [];
  const tempDirs: string[] = [];
  /** Ports a cell is deliberately occupying, released in afterEach. */
  const heldPorts: HeldPort[] = [];

  /** Spawn the bin and collect both streams; the child is killed in afterEach either way. */
  function startServer(
    args: string[],
    cwd: string,
    home: string
  ): { child: ChildProcess; transcript: () => string } {
    const child = spawn('node', [cliEntry, ...args], { cwd, env: childEnv(home) });
    children.push({ child, gone: whenGone(child) });
    let output = '';
    child.stdout?.on('data', (chunk) => (output += String(chunk)));
    child.stderr?.on('data', (chunk) => (output += String(chunk)));
    return { child, transcript: () => output };
  }

  /** A pair of temp dirs — an empty project dir to run in, and an empty home. */
  function makeDirs(label: string): { dir: string; home: string } {
    const dir = mkdtempSync(join(tmpdir(), `gsloth-cfg62-${label}-`));
    const home = mkdtempSync(join(tmpdir(), `gsloth-cfg62-${label}-home-`));
    tempDirs.push(dir, home);
    return { dir, home };
  }

  afterEach(async () => {
    const failures: string[] = [];
    // Unconditionally, including on the failure path: an orphan holding a port makes the NEXT
    // cell fail in a way that reads like a defect in the code under test.
    for (const { child, gone } of children.splice(0)) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      // `kill()` only SENDS the signal, so wait for the process to actually be gone before the
      // removal below. A live process is no obstacle to unlinking its directory on POSIX, but on
      // win32 it holds a lock on its own `cwd` — which is what the spawning cells run in — and the
      // removal fails there with EPERM. `force: true` does not cover that: it suppresses a missing
      // path, not a permission error.
      const problem = await goneWithin(gone);
      if (problem) failures.push(`the server (pid ${child.pid}) was not cleaned up: ${problem}`);
    }
    // Before the directories, and for the same reason the children are killed first: a port this
    // suite is still occupying would make a later cell fail as though the server could not start.
    for (const held of heldPorts.splice(0)) {
      try {
        await held.release();
      } catch (err) {
        failures.push(
          `port ${held.port} could not be released: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    for (const dir of tempDirs.splice(0)) {
      try {
        // Node's own EPERM/EBUSY backoff, for a win32 handle that outlives the process by a moment.
        // It is belt-and-braces around the wait above, not a substitute for it, and it THROWS when
        // it never succeeds — so this catch records a persistent failure and rethrows it below
        // rather than swallowing it. Catching at all only keeps one stuck directory from stranding
        // the others, and keeps a wedged child and a failed removal from masking each other.
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch (err) {
        failures.push(
          `${dir} could not be removed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    if (failures.length > 0) throw new Error(failures.join('\n'));
  }, CLEANUP_TIMEOUT_MS);

  it(
    'binds the port named by --port, over the one in the config file',
    async () => {
      const flagPort = await freePort();
      const configPort = await freePort();
      expect(flagPort).not.toBe(configPort);

      const { dir, home } = makeDirs('flag');
      const configPath = join(dir, 'gth-fake.json');
      writeFixtureConfig(configPath, configPort);

      const { child, transcript } = startServer(
        ['ag-ui', '--port', String(flagPort), '--config', configPath],
        dir,
        home
      );

      // Connecting is the assertion: it is the only thing that distinguishes the flag's port
      // being bound from the flag being dropped and some other port bound instead.
      expect(await waitForHealth(flagPort, child, transcript)).toBe(200);

      // The ordinary free-port path, kept as the control: the server announces itself, names the
      // port it is really on, and is STILL RUNNING. "Exits 0" for a server that is meant to keep
      // serving is exactly this — it has not exited at all, where the collision path exits.
      expect(transcript()).toContain(`AG-UI server listening at http://127.0.0.1:${flagPort}`);
      expect(child.exitCode).toBeNull();
    },
    CELL_TIMEOUT_MS
  );

  it(
    'exits non-zero, and prints no banner, when another process already holds the port',
    async () => {
      // The port is one this cell took and is holding, not the configured or allocated one. A
      // collision test aimed at "the port the server would use anyway" proves nothing: that port
      // may be free, or held by something unrelated, and either way the cell is not measuring the
      // bind.
      const held = await holdPort();
      heldPorts.push(held);

      const { dir, home } = makeDirs('inuse');
      writeFixtureConfig(join(dir, '.gsloth.config.json'));

      const result = spawnSync('node', [cliEntry, 'ag-ui', '--port', String(held.port)], {
        cwd: dir,
        env: childEnv(home),
        encoding: 'utf8',
        timeout: BOOT_TIMEOUT_MS,
      });

      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      expect(result.status, `expected a non-zero exit; the CLI said:\n${output}`).not.toBe(0);
      // This project's own words and its own interpolation of the port, in one string. Never the
      // platform's errno text — its wording is not the same on win32 as it is here — and never the
      // bare number, which node's own message happens to carry too, so a message that dropped the
      // port would still satisfy it.
      expect(output).toContain(`failed to listen on port ${held.port}`);
      expect(output).not.toContain('AG-UI server listening');
    },
    CELL_TIMEOUT_MS
  );

  it(
    'announces the port the OS chose, when the configured port is 0',
    async () => {
      // Port 0 means "any free port". The number the caller passed is then not the number the
      // socket has, and the banner is the only place they can learn the real one.
      //
      // TWO servers, and the assertion that matters is that they DIFFER. One server cannot tell
      // "the 0 was honoured" from "the 0 was replaced by the default": a single announced port
      // satisfies `not.toBe(0)` on both readings, and answers health on both. Two concurrent
      // servers cannot both be handed the same default, so a precedence that drops the 0 —
      // `port || DEFAULT` in place of `port ?? DEFAULT`, where `0` is falsy — shows up here
      // either as an equal pair or as a second server that never starts at all.
      const first = makeDirs('anyport-a');
      const second = makeDirs('anyport-b');
      writeFixtureConfig(join(first.dir, '.gsloth.config.json'), 0);
      writeFixtureConfig(join(second.dir, '.gsloth.config.json'), 0);

      const a = startServer(['ag-ui'], first.dir, first.home);
      const b = startServer(['ag-ui'], second.dir, second.home);

      const announcedA = await waitForAnnouncedPort(a.child, a.transcript);
      const announcedB = await waitForAnnouncedPort(b.child, b.transcript);

      expect(announcedA).not.toBe(0);
      expect(announcedB).not.toBe(0);
      expect(announcedA).not.toBe(announcedB);
      expect(await waitForHealth(announcedA, a.child, a.transcript)).toBe(200);
      expect(await waitForHealth(announcedB, b.child, b.transcript)).toBe(200);
    },
    CELL_TIMEOUT_MS
  );

  it(
    'binds the port from the file named by --config when no --port is given',
    async () => {
      const configPort = await freePort();
      const { dir, home } = makeDirs('config');
      // The config lives OUTSIDE the working directory, and both the working directory and the
      // home are empty. So there is nothing for discovery to find: reaching a bound port at all
      // proves this file was read, rather than a config that happened to be lying around.
      const elsewhere = mkdtempSync(join(tmpdir(), 'gsloth-cfg62-elsewhere-'));
      tempDirs.push(elsewhere);
      const configPath = join(elsewhere, 'gth-fake.json');
      writeFixtureConfig(configPath, configPort);

      const { child, transcript } = startServer(['ag-ui', '--config', configPath], dir, home);

      expect(await waitForHealth(configPort, child, transcript)).toBe(200);
    },
    CELL_TIMEOUT_MS
  );

  it(
    'CFG-67: with no host configured, loopback answers and this machine LAN address does not',
    async () => {
      // The refusal is the assertion. A cell asserting only that loopback answers does not
      // discriminate at all: a wildcard bind — what this server used to do while telling the user
      // it was for local clients only — answers on loopback too. The LAN address is the one
      // address the two binds disagree about.
      //
      // Liveness first, so the silence measured second is the socket's and not a server that had
      // not finished starting: nothing is asked of the LAN address until /health has answered on
      // loopback.
      const lan = lanAddress();
      const port = await freePort();
      const { dir, home } = makeDirs('loopback');
      writeFixtureConfig(join(dir, '.gsloth.config.json'));

      const { child, transcript } = startServer(['ag-ui', '--port', String(port)], dir, home);
      expect(await waitForHealth(port, child, transcript)).toBe(200);

      // The refusal comes FIRST among the claims, because it is the one this cell exists for. An
      // ordering that checked the banner first would report a widened bind as a wording problem
      // and never reach the socket at all.
      expect(
        lan,
        'this machine reports no non-loopback IPv4 interface, so it cannot express the difference ' +
          'between a loopback bind and a wildcard one'
      ).toBeDefined();
      expect(
        await healthFrom(lan as string, port),
        `${lan}:${port} answered, so the server is reachable from the network; it said:\n${transcript()}`
      ).toBe('no answer');

      // And the banner is the server's claim about that same socket, so the two are checked
      // against each other rather than each on its own.
      expect(transcript()).toContain(`AG-UI server listening at http://127.0.0.1:${port}`);
      expect(transcript()).toContain('a loopback address');
    },
    CELL_TIMEOUT_MS
  );

  it(
    'CFG-67: --host 0.0.0.0 still reaches the LAN, and says the server is exposed',
    async () => {
      // The control. Defaulting to loopback is only correct if the deliberate opt-in still works —
      // breaking the phone, the second dev box or the container network is the failure this whole
      // change exists to avoid. It probes the SAME address the cell above requires silence from,
      // so an environment that cannot route to its own interface reds here, loudly, instead of
      // letting that one pass for the wrong reason.
      const lan = lanAddress();
      const port = await freePort();
      const { dir, home } = makeDirs('wildcard');
      writeFixtureConfig(join(dir, '.gsloth.config.json'));

      const { child, transcript } = startServer(
        ['ag-ui', '--port', String(port), '--host', '0.0.0.0'],
        dir,
        home
      );
      expect(await waitForHealth(port, child, transcript)).toBe(200);

      expect(
        lan,
        'this machine reports no non-loopback IPv4 interface, so it cannot express the difference ' +
          'between a loopback bind and a wildcard one'
      ).toBeDefined();
      expect(
        await healthFrom(lan as string, port),
        `nothing answered on ${lan}:${port}; the server said:\n${transcript()}`
      ).toBe(200);

      // And it says so. The warning names the mechanism — the address bound and that reaching it
      // needs no credential — rather than an intention about who ought to connect.
      //
      // The family is part of the mechanism, so it is part of the assertion: `0.0.0.0` is every
      // IPv4 interface and no IPv6 one (measured — a client dialling `[::1]` is refused against
      // this bind and answered against a `::` one), and the bare "every network interface"
      // describes `::`.
      expect(transcript()).toContain('every IPv4 network interface on this machine');
      expect(transcript()).toContain('unauthenticated');
      expect(transcript()).not.toContain('only clients on this machine');
    },
    CELL_TIMEOUT_MS
  );

  it(
    'OPS-16: a preflight from the origin named by --cors-origin is allowed that same origin',
    async () => {
      // The acceptance measurement, made the way the defect was found: an OPTIONS preflight sent
      // from the origin a relocated web client has, against a config still pinning the origin it
      // used to have. Before this flag existed the answer was the pinned origin whatever the
      // client's real origin was, and the browser refused every chat request that followed.
      //
      // The two origins must DIFFER for this to measure anything. A cell run where the client had
      // not moved would be allowed the pinned origin and pass on a server that ignores the flag
      // entirely, which is why neither value is derived from a port allocation.
      expect(RELOCATED_ORIGIN).not.toBe(PINNED_ORIGIN);

      const port = await freePort();
      const { dir, home } = makeDirs('cors-flag');
      writeFixtureConfig(join(dir, '.gsloth.config.json'), undefined, PINNED_ORIGIN);

      const { child, transcript } = startServer(
        ['ag-ui', '--port', String(port), '--cors-origin', RELOCATED_ORIGIN],
        dir,
        home
      );
      expect(await waitForHealth(port, child, transcript)).toBe(200);

      expect(
        await preflightAllowOrigin(port, RELOCATED_ORIGIN),
        `the server said:\n${transcript()}`
      ).toBe(RELOCATED_ORIGIN);
    },
    CELL_TIMEOUT_MS
  );

  it(
    'OPS-16: with no --cors-origin the configured origin is still what a preflight is allowed',
    async () => {
      // The control, and it must survive every mutation the cell above reds under. The flag is an
      // override; a change that served the new lever by dropping the configured origin would break
      // every deployment that has one — including this demo's own default, which is the case the
      // flag exists to move rather than to replace.
      const port = await freePort();
      const { dir, home } = makeDirs('cors-config');
      writeFixtureConfig(join(dir, '.gsloth.config.json'), undefined, PINNED_ORIGIN);

      const { child, transcript } = startServer(['ag-ui', '--port', String(port)], dir, home);
      expect(await waitForHealth(port, child, transcript)).toBe(200);

      expect(
        await preflightAllowOrigin(port, RELOCATED_ORIGIN),
        `the server said:\n${transcript()}`
      ).toBe(PINNED_ORIGIN);
    },
    CELL_TIMEOUT_MS
  );

  it('exits non-zero and names the path when --config points at a file that is not there', () => {
    const { dir, home } = makeDirs('missing');
    // A config that IS discoverable from the working directory, so a fallback to discovery would
    // produce a running server rather than an error — which is exactly the reported failure.
    writeFixtureConfig(join(dir, '.gsloth.config.json'));
    const missing = join(dir, 'no-such-config.json');

    const result = spawnSync('node', [cliEntry, 'ag-ui', '--config', missing], {
      cwd: dir,
      env: childEnv(home),
      encoding: 'utf8',
      timeout: BOOT_TIMEOUT_MS,
    });

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    expect(result.status, `expected a non-zero exit; the CLI said:\n${output}`).not.toBe(0);
    expect(output).toContain(missing);
  });

  it('exits non-zero and names the value when --port is not a port', () => {
    const { dir, home } = makeDirs('badport');
    writeFixtureConfig(join(dir, '.gsloth.config.json'));

    const result = spawnSync('node', [cliEntry, 'ag-ui', '--port', 'not-a-port'], {
      cwd: dir,
      env: childEnv(home),
      encoding: 'utf8',
      timeout: BOOT_TIMEOUT_MS,
    });

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    expect(result.status, `expected a non-zero exit; the CLI said:\n${output}`).not.toBe(0);
    expect(output).toContain('not-a-port');
    // Not started, rather than started on a port nobody asked for: `listen(NaN)` would bind an
    // arbitrary free port, which is the same class of silent wrong answer this node removes.
    expect(output).not.toContain('AG-UI server listening');
  });

  it('prints usage naming both flags, and exits 0, for --help', () => {
    const { dir, home } = makeDirs('help');

    const result = spawnSync('node', [cliEntry, '--help'], {
      cwd: dir,
      env: childEnv(home),
      encoding: 'utf8',
      timeout: BOOT_TIMEOUT_MS,
    });

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    expect(result.status).toBe(0);
    expect(output).toContain('--port');
    expect(output).toContain('--host');
    expect(output).toContain('--cors-origin');
    expect(output).toContain('--config');
    // The precedence the docs state, stated at the door too, so the two cannot drift apart.
    expect(output).toContain('Port precedence: --port, then commands.api.port');
    expect(output).toContain('Host precedence: --host, then commands.api.host');
    expect(output).toContain(
      'CORS origin precedence: --cors-origin, then commands.api.cors.allowOrigin'
    );
  });

  it('refuses an unrecognised flag instead of ignoring it', () => {
    const { dir, home } = makeDirs('unknown');
    writeFixtureConfig(join(dir, '.gsloth.config.json'));

    const result = spawnSync('node', [cliEntry, 'ag-ui', '--porrt', '4000'], {
      cwd: dir,
      env: childEnv(home),
      encoding: 'utf8',
      timeout: BOOT_TIMEOUT_MS,
    });

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    expect(result.status, `expected a non-zero exit; the CLI said:\n${output}`).not.toBe(0);
    expect(output).toContain('porrt');
    expect(output).not.toContain('AG-UI server listening');
  });
});
