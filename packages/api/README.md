# @gaunt-sloth/api

API server and agent integration layer for Gaunt Sloth.

## Contents

- AG-UI server module (`apiAgUiModule`) — starts an HTTP server implementing the AG-UI protocol
- Interactive session module (`interactiveSessionModule`)
- A2A client wrapper (`A2AClientWrapper`) and agent tool (`A2AAgentTool`) — Agent-to-Agent protocol support
- MCP utilities (`mcpUtils`) — Model Context Protocol server connection helpers
- OAuth client provider (`OAuthClientProviderImpl`)
- `show_a2ui_surface` tool
- Resolvers (`createResolvers`) — wires built-in tools, MCP servers, and A2A agents into the tool registry

## CLI

The package ships a standalone binary `gaunt-sloth-api` that starts an AG-UI server.

## Dependencies

- `@gaunt-sloth/core`
- `@gaunt-sloth/tools`
- `express`
- `@ag-ui/core`, `@ag-ui/encoder`
- `@langchain/mcp-adapters`, `@modelcontextprotocol/sdk`
- `@a2a-js/sdk`

## Exports

```js
import { apiAgUiModule } from '@gaunt-sloth/api/apiAgUiModule.js';
import { interactiveSessionModule } from '@gaunt-sloth/api/interactiveSessionModule.js';
import { A2AClientWrapper, A2AAgentTool } from '@gaunt-sloth/api/a2a.js';
import { OAuthClientProviderImpl } from '@gaunt-sloth/api/OAuthClientProviderImpl.js';
import { mcpUtils } from '@gaunt-sloth/api/mcpUtils.js';
import { createResolvers } from '@gaunt-sloth/api/resolvers.js';
```

## Related packages

- [`@gaunt-sloth/core`](../core) — Core utilities, config, and agent infrastructure
- [`@gaunt-sloth/tools`](../tools) — Built-in tools, filesystem toolkit, and middleware registry
- [`@gaunt-sloth/api`](../api) — API server, AG-UI, MCP, and A2A integration (this package)
- [`@gaunt-sloth/review`](../review) — Review and Q&A modules with standalone CLI
- [`gaunt-sloth-assistant`](../assistant) — Main CLI application
