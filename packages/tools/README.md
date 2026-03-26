# @gaunt-sloth/tools

Tools and middleware for Gaunt Sloth.

## Contents

- Built-in tools configuration (`builtInToolsConfig`)
- Filesystem toolkit (`GthFileSystemToolkit`) — provides read/write/glob/grep tools controlled by `.aiignore`
- Custom tools (`GthCustomToolkit`) — executes user-defined shell commands from config
- Dev tools (`GthDevToolkit`) — tools for development and coding sessions
- Status update tool
- Web fetch tool
- Binary content injection middleware
- Middleware registry (`resolveMiddleware`) and types

## Dependencies

- `@gaunt-sloth/core`

## Exports

```js
import { builtInToolsConfig } from '@gaunt-sloth/tools/builtInToolsConfig.js';
import { resolveMiddleware } from '@gaunt-sloth/tools/middleware/registry.js';
```
