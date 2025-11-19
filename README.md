# Gaunt Sloth Assistant
[![Tests and Lint](https://github.com/Galvanized-Pukeko/gaunt-sloth-assistant/actions/workflows/unit-tests.yml/badge.svg)](https://github.com/Galvanized-Pukeko/gaunt-sloth-assistant/actions/workflows/unit-tests.yml) [![Integration Tests](https://github.com/Galvanized-Pukeko/gaunt-sloth-assistant/actions/workflows/integration-tests.yml/badge.svg?event=push)](https://github.com/Galvanized-Pukeko/gaunt-sloth-assistant/actions/workflows/integration-tests.yml)

Gaunt Sloth Assistant is a lightweight command-line AI code review tool that also provides general-purpose AI capabilities.
Built with TypeScript and distributed via NPM, Gaunt Sloth maintains minimal dependencies for easy integration.

![GSloth Banner](assets/gaunt-sloth-logo.png)

Based on [LangChain.js](https://github.com/langchain-ai/langchainjs)

[Documentation](https://gaunt-sloth-assistant.github.io/docs/) | [Official Site](https://gaunt-sloth-assistant.github.io/) | [NPM](https://www.npmjs.com/package/gaunt-sloth-assistant) | [GitHub](https://github.com/Galvanized-Pukeko/gaunt-sloth-assistant)

## Why?

Gaunt Sloth's promise is that it is small, extendable, cross-platform and can itself be a dependency in your project.

The GSloth was initially built as a code review tool, fetching PR contents and Jira contents before feeding them to
the LLM, but we ourselves found many more use cases which we initially did not anticipate; for example,
we may have it as a dependency in an MCP project, allowing us to quickly spin it up to simulate or test some use cases.

The promise of Gaunt Sloth:

- **Minimum dependencies**. Ideally, we aim to only have CommanderJS and some packages from LangChainJS and LangGraphJS.
- **Extensibility**. Feel free to write some JS and create your Tool, Provider or connect to the MCP server of your choice.
- **No vendor lock-in**. Just BYO API keys.
- **Easy installation via NPM**.
- **All prompts are editable** via markdown files.
- **No UI**. Command Line only, with intent to be used in build pipeline, or as a dependency to help in nodejs projects.

## What GSloth does:

- Reviews code;
  - Suggests bug fixes;
  - Explains provided code
- Reviews Diffs provided with pipe (|);
  - You can ask GSloth to review your own code before committing (`git --no-pager diff | gsloth review`).
- Reviews Pull Requests (PRs) (`gsloth pr 42`);
  - Fetches descriptions (requirements) from Github issue or Jira (`gsloth pr 42 12`);;
- Answers questions about provided code;
- Writes code;
- Connects to MCP server (including remote MCP with OAuth);
- Saves all responses in timestamped `.md` files (override with `-w/--write-output-to-file`);
- Anything else you need, when combined with other command line tools.

### To make GSloth work, you need an **API key** from some AI provider, such as:

- OpenRouter
- Groq;
- DeepSeek;
- Google AI Studio and Google Vertex AI;
- Anthropic;
- OpenAI (and other providers using OpenAI format, such as Inception);
- Ollama with JS config (some of the models, see https://github.com/Galvanized-Pukeko/gaunt-sloth-assistant/discussions/107)
- xAI;

`*` Any other provider supported by LangChain.JS should also work with [JS config](./docs/CONFIGURATION.md#javascript-configuration).

## Commands Overview

`gth` and `gsloth` commands are used interchangeably, both `gsloth pr 42` and `gth pr 42` do the same thing.

For detailed information about all commands, see [docs/COMMANDS.md](./docs/COMMANDS.md).

### Global Flags

These apply to every command:
- `--config <path>` – load a specific config file without moving directories
- `-i, --identity-profile <name>` – switch to another profile under `.gsloth/.gsloth-settings/<name>/`
- `-w, --write-output-to-file <value>` – control response files (`true` by default, use `-wn`/`-w0` for false, or pass a filename)
- `--verbose` – enable verbose LangChain/LangGraph logs (useful when debugging prompts)

### Available Commands:

- **`init`** - Initialize Gaunt Sloth in your project with a specific AI provider
- **`pr`** - ⚠️ This feature requires GitHub CLI to be installed. Review pull requests with optional requirement integration (GitHub issues or Jira).
- **`review`** - Review any diff or content from various sources
- **`ask`** - Ask questions about code or programming topics
- **`chat`** - Start an interactive chat session
- **`code`** - Write code interactively with full project context

### Quick Examples:

**Initialize project:**
```bash
gsloth init anthropic
```

**Review PR with requirements:**
```bash
gsloth pr 42 23  # Review PR #42 with GitHub issue #23
```

**Review local changes:**
```bash
git --no-pager diff | gsloth review
```

**Review changes between a specific tag and the HEAD:**
```bash
git --no-pager diff v0.8.3..HEAD | gth review
```

**Review diff between head and previous release and head using a specific requirements provider (GitHub issue 38), not the one which is configured by default:
```bash
git --no-pager diff v0.8.10 HEAD | npx gth review --requirements-provider github -r 38
```

**Ask questions:**
```bash
gsloth ask "What does this function do?" -f utils.js
```

**Write release notes:**
```bash
git --no-pager diff v0.8.3..HEAD | gth ask "inspect existing release notes in assets/release-notes/v0_8_2.md; inspect provided diff and write release notes to v0_8_4.md"
```

To write this to filesystem, you'd need to add filesystem access to the *ask* command in `.gsloth.config.json`.

```json
{"llm": {"type": "vertexai", "model": "gemini-2.5-pro"}, "commands": {"ask": {"filesystem": "all"}}}
```

*You can improve this significantly by modifying project guidelines in `.gsloth.guidelines.md` or maybe with keeping instructions in file and feeding it in with `-f`.


**Interactive sessions:**
```bash
gsloth chat  # Start chat session
gsloth code  # Start coding session
```
Running `gsloth` with no subcommand also drops you into `chat`.

## Installation

Tested with Node 22 LTS.

### NPM
```bash
npm install gaunt-sloth-assistant -g
```

## Configuration

> Gaunt Sloth currently only functions from the directory which has a configuration file (`.gsloth.config.js`, `.gsloth.config.json`, or `.gsloth.config.mjs`) and `.gsloth.guidelines.md`. Configuration files can be located in the project root or in the `.gsloth/.gsloth-settings/` directory.
>
> You can also specify a path to a configuration file directly using the `-c` or `--config` global flag, for example `gth -c /path/to/your/config.json ask "who are you?"`
> Note, however, is that project guidelines are going to be used from current directory if they exist and simple install dir prompt is going to be used if nothing found.

Configuration can be created with `gsloth init [vendor]` command.
Currently, openrouter, anthropic, groq, deepseek, openai, google-genai, vertexai and xai can be configured with `gsloth init [vendor]`.
For OpenAI-compatible providers like Inception, use `gsloth init openai` and modify the configuration.

More detailed information on configuration can be found in [CONFIGURATION.md](./docs/CONFIGURATION.md)

### Google GenAI (AI Studio)

```bash
cd ./your-project
gsloth init google-genai
```
Make sure you either define `GOOGLE_API_KEY` environment variable or edit your configuration file and set up your key.
It is recommended to obtain API key from Google AI Studio official website rather than from a reseller.

### Google Vertex AI

```bash
cd ./your-project
gsloth init vertexai
gcloud auth login
gcloud auth application-default login
```

As of 18 Nov 2025 those willing to use Gemini 3 with Vertex AI should also set location to `global`,
as other locations give 404. Example config:
```json
{
  "llm": {
    "type": "vertexai",
    "model": "gemini-3-pro-preview",
    "location": "global"
  }
}
```

### Open Router

```bash
cd ./your-project
gsloth init openrouter
```

Make sure you either define `OPEN_ROUTER_API_KEY` environment variable or edit your configuration file and set up your key.

### Anthropic

```bash
cd ./your-project
gsloth init anthropic
```

Make sure you either define `ANTHROPIC_API_KEY` environment variable or edit your configuration file and set up your key.

### Groq
```bash
cd ./your-project
gsloth init groq
```
Make sure you either define `GROQ_API_KEY` environment variable or edit your configuration file and set up your key.

### DeepSeek
```bash
cd ./your-project
gsloth init deepseek
```
Make sure you either define `DEEPSEEK_API_KEY` environment variable or edit your configuration file and set up your key.
It is recommended to obtain API key from DeepSeek official website rather than from a reseller.

### OpenAI
```bash
cd ./your-project
gsloth init openai
```
Make sure you either define `OPENAI_API_KEY` environment variable or edit your configuration file and set up your key.

### OpenAI-compatible providers (Inception, etc.)
For providers using OpenAI-compatible APIs:
```bash
cd ./your-project
gsloth init openai
```
Then edit your configuration to add custom base URL and API key. See [CONFIGURATION.md](./docs/CONFIGURATION.md) for examples.

### xAI
```bash
cd ./your-project
gsloth init xai
```
Make sure you either define `XAI_API_KEY` environment variable or edit your configuration file and set up your key.

### Other AI providers
Any other AI provider supported by Langchain.js can be configured with js [Config](./docs/CONFIGURATION.md).
For example, Ollama can be set up with JS config (some of the models, see https://github.com/Galvanized-Pukeko/gaunt-sloth-assistant/discussions/107)

### JavaScript Configuration with Custom Middleware and Tools
JavaScript configs enable advanced customization including custom middleware and tools that aren't available in JSON configs. See the [JavaScript config example](./examples/js-config/README.md) for a complete demonstration of creating custom logging middleware and custom tools.

## Integration with GitHub Workflows / Actions

Example GitHub workflows integration can be found in [.github/workflows/review.yml;](.github/workflows/review.yml)
this example workflow performs AI review on any pushes to Pull Request, resulting in a comment left by,
GitHub actions bot.

## MCP (Model Context Protocol) Servers

Gaunt Sloth supports connecting to MCP servers, including those requiring OAuth authentication.

This has been tested with the Atlassian Jira MCP server.
See the [MCP configuration section](./docs/CONFIGURATION.md#model-context-protocol-mcp) for detailed setup instructions, or the [Jira MCP example](./examples/jira-mcp) for a working configuration.

If you experience issues with the MCP auth try finding `.gsloth` dir in your home directory,
and delete JSON file matching the server you are trying to connect to,
for example for atlassian MCP the file would be `~/.gsloth/.gsloth-auth/mcp.atlassian.com_v1_sse.json`

## Uninstall
Uninstall global NPM package:
```bash
npm uninstall -g gaunt-sloth-assistant
```

Remove global config (if any)
```bash
rm -r ~/.gsloth
```

Remove configs from project (if necessary)
```bash
rm -r ./.gsloth*
```

## Contributing
Contributors are needed! Feel free to create a PR.
If you are not sure where to start, look for issues with a "good first issue" label.

## Building from repo
See [DEVELOPMENT.md](./docs/DEVELOPMENT.md)

## License
License is [MIT](https://opensource.org/license/mit). See [LICENSE](LICENSE)
