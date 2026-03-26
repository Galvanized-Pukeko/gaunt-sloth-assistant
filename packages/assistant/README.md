# gaunt-sloth-assistant

The main CLI application for Gaunt Sloth.

## Contents

- CLI entry point and commander-based command registration
- Commands: `ask`, `review`, `pr`, `chat`, `code`, `init`, `get`, `api`
- Command utilities and config setup
- Vendor package wiring (all LangChain provider packages)
- Integration tests

## CLI Binaries

The package registers four equivalent binary aliases:

- `gaunt-sloth-assistant`
- `gaunt-sloth`
- `gsloth`
- `gth`

## Dependencies

- `@gaunt-sloth/core`
- `@gaunt-sloth/tools`
- `@gaunt-sloth/api`
- `@gaunt-sloth/review`
- `commander`
- All LangChain vendor packages (anthropic, google-genai, groq, openai, vertexai, xai, etc.)

This is the only package in the workspace that pulls in AI vendor dependencies directly. All other packages treat vendors as optional peers.

## Re-exports

`gaunt-sloth-assistant` re-exports public APIs from the sub-packages for backward compatibility. Consumers that previously imported directly from `gaunt-sloth-assistant` continue to work without changes.

## Installation

```bash
npm install -g gaunt-sloth-assistant
```

For full usage documentation see the [root README](../../README.md) and [docs/COMMANDS.md](../../docs/COMMANDS.md).
