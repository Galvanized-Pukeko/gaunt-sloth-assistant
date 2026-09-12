# @gaunt-sloth/agent

The agent runtime for Gaunt Sloth: built-in tools and toolkits (filesystem, dev/shell, web
fetch, custom), the middleware registry, MCP client + OAuth provider, A2A client and tools, the
AG-UI server (`startAgUiServer`), the interactive session
module, and the `createResolvers` tool/middleware resolver wiring. It builds on
[`@gaunt-sloth/core`](https://www.npmjs.com/package/@gaunt-sloth/core) (config, provider
factory, lean agent runtime).

**When to depend on this package** — you are embedding the running agent: serving it to a web
client over AG-UI, wiring its tools/middleware into your own host, or talking to MCP/A2A
services. The fat [`gaunt-sloth`](https://www.npmjs.com/package/gaunt-sloth) CLI wires this same
runtime into `gth chat` / `gth code` / `gth api`; install that instead if you want the terminal
experience rather than a library.

## Installation

```bash
npm install @gaunt-sloth/agent @langchain/anthropic
```

AI providers are optional peer dependencies of `@gaunt-sloth/core` — install the one(s) your
config uses (see the core README's provider list).

## Embedding: serve the agent over AG-UI

I want a local web client to talk to the configured Gaunt Sloth agent over the
[AG-UI protocol](https://github.com/ag-ui-protocol/ag-ui). With a `.gsloth.config.*` in the
working directory:

```js
import { initConfig } from '@gaunt-sloth/core';
import { startAgUiServer } from '@gaunt-sloth/agent';

const config = await initConfig({});
await startAgUiServer(config, config.commands?.api?.port ?? 3000);
// POST /agents/:agentId/run now streams typed AG-UI SSE events
```

The server binds `127.0.0.1`, so only clients on the same machine can reach it. Pass a third
argument — `startAgUiServer(config, port, '0.0.0.0')` — or set `commands.api.host` to accept
connections from the network; **the endpoint has no authentication**, so anything that can route to
it can run the agent with the tools your configuration gives it. A fourth argument —
`startAgUiServer(config, port, undefined, 'http://localhost:5556')` — is the browser origin allowed
to call the server, for a client whose origin the config cannot know because the caller chose it.
Port, host and CORS come from `commands.api.*` in the config — see
[the configuration guide](https://github.com/pukeko-robotics/gaunt-sloth/blob/main/docs/configuration/index.md).
`startAgUiServer` resolves with the bound `http.Server`, which is how an embedder learns the port a
`port` of `0` was given, and how it stops the server.

Beyond the protocol's own events, the stream carries one `CUSTOM` event, named `context_compacted`
(exported as `AGUI_CONTEXT_COMPACTED_EVENT`). It is sent when the provider rejected the turn for
size and the server folded the older conversation into a summary and asked the model again: its
`value` is `{ cause, compaction, notice }` — the numbers `/compact` reports and the notice the other
surfaces show, so a client can render either. Everything already streamed for the run stands; what
follows is the same turn continued with less history behind it, as a new text message. A client
that ignores the event shows a correct turn with the fold unannounced. A second overflow ends the
run with `RUN_ERROR` carrying `code: context_overflow@runner.overflow-compact-exhausted`.

## Binaries

- **`gaunt-sloth-api`** — starts the AG-UI server standalone (the code above as a command):
  `gaunt-sloth-api ag-ui --port 4000 --config ./.gsloth.config.json`. `ag-ui` is the only api-type
  and is the default, so the bare `gaunt-sloth-api` is the same command. The port is taken from
  `--port`, else `commands.api.port`, else 3000, the interface from `--host`, else
  `commands.api.host`, else `127.0.0.1`, and the allowed browser origin from `--cors-origin`, else
  `commands.api.cors.allowOrigin`; a `--config` path that does not exist ends the run
  with an error rather than falling back to the config discovered from the working directory. Full
  reference:
  [the api ag-ui command](https://github.com/pukeko-robotics/gaunt-sloth/blob/main/docs/COMMANDS.md#api-ag-ui).
- **`gaunt-sloth-acp`** — serves the [Agent Client Protocol](https://agentclientprotocol.com/) over
  stdio, for an editor that spawns the agent as a subprocess. Serves **both ACP v1 and ACP v2**,
  choosing the version from the host's own `initialize`. Takes no arguments, and roots the session
  at the working directory the host supplies. Gated tools are escalated to the host as
  `session/request_permission`. The same server is reachable programmatically as
  `startAcpServer()`, and as `createAcpAgentRouter()` when you want to serve it over a transport of
  your own (or `createAcpAgentApp()` / `createAcpV1AgentApp()` for one dialect on its own).

## Exports

- `@gaunt-sloth/agent` (the root export) is the public API: the AG-UI and interactive-session
  modules, A2A client and tool, MCP utilities and OAuth provider, built-in tools config, the
  middleware registry, the agent-backend seam (`resolveAgentFactory`), and `createResolvers`.
- `@gaunt-sloth/agent/<path>.js` deep paths mirror the internal `dist/` layout 1:1 and are
  deliberately kept open for reach-in (the fat CLI imports e.g.
  `@gaunt-sloth/agent/resolvers.js`). They are supported at your own risk: internal files can
  move between alpha/minor versions without a deprecation cycle. Prefer the root export where it
  suffices.

> `@gaunt-sloth/tools` and `@gaunt-sloth/api` are deprecated and now re-export from this
> package.

## Related packages

- [`@gaunt-sloth/core`](https://www.npmjs.com/package/@gaunt-sloth/core) — Core utilities, config, and agent infrastructure ([source](https://github.com/pukeko-robotics/gaunt-sloth/tree/main/packages/core))
- [`@gaunt-sloth/review`](https://www.npmjs.com/package/@gaunt-sloth/review) — Review engine with content/requirement sources (GitHub, Jira, file, text) and standalone CLI ([source](https://github.com/pukeko-robotics/gaunt-sloth/tree/main/packages/review))
- [`@gaunt-sloth/batch`](https://www.npmjs.com/package/@gaunt-sloth/batch) — Batch / eval / workflow runtime ([source](https://github.com/pukeko-robotics/gaunt-sloth/tree/main/packages/batch))
- [`gaunt-sloth`](https://www.npmjs.com/package/gaunt-sloth) — Main CLI application ([source](https://github.com/pukeko-robotics/gaunt-sloth/tree/main/packages/app))
