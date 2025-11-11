# Gaunt Sloth Assistant project guidelines

This file provides guidance to any AI coding agent (Claude Code, Cursor, etc.) working with this repository.

**IMPORTANT: Always read and follow .gsloth.guidelines.md first for development principles, testing patterns, and workflow.**

## Tool Use

Precedence for your tool use:
1. Your built-in tools (e.g. Read, Edit, Write, Glob, Grep, etc.)
2. Bash commands that are documented in this file and in README.md
3. Other bash commands

**Examples of what to avoid:**
- ❌ `cat file.txt` → ✅ Use Read tool
- ❌ `grep pattern file.txt` → ✅ Use Grep tool
- ❌ `echo content > file.txt` → ✅ Use Write tool
- ❌ `find . -name "*.js"` → ✅ Use Glob tool

Abstain from using bash commands when you already have a built-in tool,
every time you use a bash command that is not in allow-list, it needs approval and slows down the process.

## Integration tests

Running all integration tests (takes ~10 minutes):

```bash
npm run it vertexai
```

Command accepts another argument which is a partial file name to filter tests,

for example `npm run it vertexai review` will run all tests that contain `review` in the file name.

Faster integration tests have `simple` suffix, which allows running a subset of tests quickly,
this also helps with less intelligent models:

```bash
npm run it vertexai simple
```

Run multiple integration test patterns:
```bash
npm run it vertexai prCommand reviewCommand
```

### Building and Testing

```bash
# Build the project
npm run build

# Run tests
npm test

# Run linting
npm run lint

# Auto-fix simple lint issues
npm run lint-n-fix

# Format code
npm run format

# Install globally for development
npm install -g ./
```

## Codebase Architecture

Gaunt Sloth Assistant is a command line AI assistant for software developers, primarily focused on code reviews and question answering.

### High-Level Structure

1. **Commands**: The CLI exposes dedicated commands for each workflow:
   - `askCommand`: Q&A against supplied files, diffs, or providers
   - `reviewCommand`: General diff reviews (stdin, files, providers)
   - `prCommand`: Review GitHub pull requests with optional requirements ingestion
   - `chatCommand`: Starts an interactive chat session (default command)
   - `codeCommand`: Interactive coding session with full workspace FS access
   - `initCommand`: Bootstraps `.gsloth.config.*` for a chosen provider

2. **Modules**:
   - `questionAnsweringModule`: Builds prompts and orchestrates Q&A runs
   - `reviewModule`: Handles diff/pr reviews and requirement stitching
   - `interactiveSessionModule`: Powers chat/code sessions via `createInteractiveSession`

3. **LLM Providers**: Via LangChain the tool works with:
   - Anthropic (Claude), Google Vertex AI (Gemini), Google AI Studio, Groq
   - DeepSeek, OpenAI & OpenAI-compatible (e.g., Inception, OpenRouter)
   - xAI and any other provider configured through JS configs

4. **Content Providers / Inputs**:
   - `file`: Reads local project files
   - `text`: Passes literal strings/stdin
   - `ghPrDiffProvider`: Uses GitHub CLI to fetch PR diffs
   - `ghIssueProvider`: Pulls GitHub issue descriptions
   - `jiraIssueProvider`: Jira REST API (PAT)
   - `jiraIssueLegacyProvider`: Jira REST API v2 with legacy tokens

### Configuration System

- Configurations are stored in `.gsloth.config.js`, `.gsloth.config.json`, or `.gsloth.config.mjs`
- Guidelines are in `.gsloth.guidelines.md`
- Output files are saved to project root or `.gsloth/` directory if it exists
- Environment variables can be used for API keys (e.g., `ANTHROPIC_API_KEY`, `GROQ_API_KEY`)

## Important Architectural Concepts

1. **Command Pattern**: Commands are separated into module and handler code
2. **Provider Pattern**: Abstract interfaces for fetching content
3. **Configuration-driven**: Heavy use of configuration files
4. **Output Persistence**: All outputs are saved to local files
5. **Integration**: GitHub CLI and Jira integration for PR reviews

**Note: For development workflow, testing patterns, imports, and other development principles, refer to .gsloth.guidelines.md**
