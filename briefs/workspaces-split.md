## Requirements Summary

### Phase 1: Initial Workspace Split
- Split monolith into four npm workspaces: `@gaunt-sloth/core`, `@gaunt-sloth/review`, `@gaunt-sloth/api`, `gaunt-sloth-assistant`
- Core: minimal dependencies, no AI vendors
- Review: standalone CI-friendly package with simple CLI (`gaunt-sloth-review`), no commander, no MCP/A2A
- API: full capability minus CLI layer (MCP, A2A, interactive sessions, AG-UI)
- Assistant: retains all existing functionality, owns commander and vendor wiring
- Unit tests, lint, and integration tests must pass

### Phase 2: Strategic Code Reallocation
- Introduce fifth package `@gaunt-sloth/tools` for non-essential tools, middleware registry, and aiignore
- Move agent runner, config system, LLM providers, and utilities into core
- Move MCP, interactive sessions, and A2A into API
- Move command introspection, project config init, and Jira work log into assistant
- Injectable resolver pattern (`AgentResolvers`) to decouple agent from tools/API/middleware imports
- Rename `presets/` → `providers/`, `providers/` → `sources/` with deprecated aliases
- Default filesystem changed to `'none'` (assistant overrides per command)
- Replace `minimatch` with Node 22 built-in `path.matchesGlob`
- Replace `execSync` with `spawnSync` to prevent shell injection in OAuth browser launch
- Dependency chain: `core` ← `tools` ← `api` ← `assistant`; `review` depends only on `core` (tools optional peer)

## Notes
- Review Rater is review command specific tools and is not meant to be in the tool registry.