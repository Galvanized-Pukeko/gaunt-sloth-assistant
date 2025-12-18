# Configuration

Populate `.gsloth.guidelines.md` with your project details and quality requirements.
A proper preamble is paramount for good inference.
Check [.gsloth.guidelines.md](https://github.com/Galvanized-Pukeko/gaunt-sloth-assistant/blob/main/.gsloth.guidelines.md) for example.

Your project should have the following files in order for gsloth to function:
- Configuration file (one of):
  - `.gsloth.config.js` (JavaScript module)
  - `.gsloth.config.json` (JSON file)
  - `.gsloth.config.mjs` (JavaScript module with explicit module extension)
- `.gsloth.guidelines.md`

> Gaunt Sloth currently only functions from the directory which has one of the configuration files and `.gsloth.guidelines.md`. Configuration files can be located in the project root or in the `.gsloth/.gsloth-settings/` directory.
>
> You can also specify a path to a configuration file directly using the `-c` or `--config` global flag, for example `gth -c /path/to/your/config.json ask "who are you?"`

## Using .gsloth Directory

For a tidier project structure, you can create a `.gsloth` directory in your project root. When this directory exists, gsloth will:

1. Write all output files (like responses from commands) to the `.gsloth` directory instead of the project root
2. Look for configuration files in `.gsloth/.gsloth-settings/` subdirectory

Example directory structure when using the `.gsloth` directory:

```
.gsloth/.gsloth-settings/.gsloth.config.json
.gsloth/.gsloth-settings/.gsloth.guidelines.md
.gsloth/.gsloth-settings/.gsloth.review.md
.gsloth/gth_2025-05-18_09-34-38_ASK.md
.gsloth/gth_2025-05-18_22-09-00_PR-22.md
```

If the `.gsloth` directory doesn't exist, gsloth will continue writing all files to the project root directory as it did previously.

**Note:** When initializing a project with an existing `.gsloth` directory, the configuration files will be created in the `.gsloth/.gsloth-settings` directory automatically. There is no automated migration for existing configurations - if you create a `.gsloth` directory after initialization, you'll need to manually move your configuration files into the `.gsloth/.gsloth-settings` directory.

### Identity profiles

Sometimes two different teams have different perspectives of a project.
For example, developers may want to review the code for code quality.
DevOps may want to be notified when some configuration files or docker image their configurations of Gaunt Sloth
may be so different that this is better to keep them in complete separation.

Identity profiles may be used to define different Gaunt Sloth identities for different purposes.

Identity profiles can only be activated in directory-based configuration.
`gth -i devops pr PR_NO` is invoked, the configuration is pulled from `.gsloth/.gsloth-settings/devops/` directory,
which may contain a full set of config files:
```
.gsloth.backstory.md
.gsloth.config.json
.gsloth.guidelines.md
.gsloth.review.md
```

When no identity profile is specified in the command, for example `gth pr PR_NO`,
the configuration is pulled from the `.gsloth/.gsloth-settings/` directory.

`-i` or `-identity-profile` overrides entire configuration directory, which means it should contain
a configuration file and prompt files. In the case if some prompt files are missing, they will be
fetched from the installation directory.

### Controlling Output Files

By default, Gaunt Sloth writes each response to `gth_<timestamp>_<COMMAND>.md` under `.gsloth/` (or the project root).
Set `writeOutputToFile` in your config to:
- `true` (default) for standard filenames,
- `false` to skip writing files,
- a string for a custom path (behavior depends on the format):
  - **Bare filenames** (e.g. `"review.md"`) are placed in `.gsloth/` when it exists, otherwise project root
  - **Paths with separators** (e.g. `"./review.md"` or `"reviews/last.md"`) are always relative to project root

**Examples:**
- `"review.md"` → `.gsloth/review.md` (when `.gsloth` exists) or `review.md` (otherwise)
- `"./review.md"` → `review.md` (always project root)
- `"reviews/last.md"` → `reviews/last.md` (always relative to project root)

Override the setting per run with `-w/--write-output-to-file true|false|<filename>`. Shortcuts `-wn` or `-w0` map to `false`.

## Configuration Object

Refer to documentation site for [Configuration Interface](https://gaunt-sloth-assistant.github.io/docs/interfaces/config.GthConfig.html)

Refer to documentation site for [Default Config Values](https://gaunt-sloth-assistant.github.io/docs/variables/config.DEFAULT_CONFIG.html)

It is always worth checking sourcecode in [config.ts](../src/config.ts) for more insightful information.

## Config initialization
Configuration can be created with `gsloth init [vendor]` command.
Currently, anthropic, groq, deepseek, openai, google-genai, vertexai, openrouter and xai can be configured with `gsloth init [vendor]`.
For providers using OpenAI format (like Inception), use `gsloth init openai` and then modify the configuration.

### Google GenAI (AI Studio)
```bash
cd ./your-project
gsloth init google-genai
```

### Google Vertex AI
```bash
cd ./your-project
gsloth init vertexai
gcloud auth login
gcloud auth application-default login
```

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
(note this meant to be an API key from deepseek.com, rather than from a distributor like TogetherAI)

### OpenAI
```bash
cd ./your-project
gsloth init openai
```
Make sure you either define `OPENAI_API_KEY` environment variable or edit your configuration file and set up your key.

### Open Router

```bash
cd ./your-project
gsloth init openrouter
```

Make sure you either define `OPEN_ROUTER_API_KEY` environment variable or edit your configuration file and set up your key.

### Other OpenAI-compatible providers (Inception, etc.)
For providers that use OpenAI-compatible APIs:
```bash
cd ./your-project
gsloth init openai
```

Then edit your configuration file to add the custom base URL and API key. For example, for Inception:
```json
{
  "llm": {
    "type": "openai",
    "model": "mercury-coder",
    "apiKeyEnvironmentVariable": "INCEPTION_API_KEY",
    "configuration": {
      "baseURL": "https://api.inceptionlabs.ai/v1"
    }
  }
}
```
* apiKeyEnvironmentVariable property can be used to point to the correct API key environment variable.

### xAI
```bash
cd ./your-project
gsloth init xai
```
Make sure you either define `XAI_API_KEY` environment variable or edit your configuration file and set up your key.

## Examples of configuration for different providers

### JSON Configuration (.gsloth.config.json)

JSON configuration is simpler but less flexible than JavaScript configuration. It should directly contain the configuration object.

**Example of .gsloth.config.json for Anthropic**
```json
{
  "llm": {
    "type": "anthropic",
    "apiKey": "your-api-key-here",
    "model": "claude-sonnet-4-5"
  }
}
```
You can use the `ANTHROPIC_API_KEY` environment variable instead of specifying `apiKey` in the config.

**Example of .gsloth.config.json for Groq**
```json
{
  "llm": {
    "type": "groq",
    "model": "deepseek-r1-distill-llama-70b",
    "apiKey": "your-api-key-here"
  }
}
```
You can use the `GROQ_API_KEY` environment variable instead of specifying `apiKey` in the config.

**Example of .gsloth.config.json for DeepSeek**
```json
{
  "llm": {
    "type": "deepseek",
    "model": "deepseek-reasoner",
    "apiKey": "your-api-key-here"
  }
}
```
You can use the `DEEPSEEK_API_KEY` environment variable instead of specifying `apiKey` in the config.

**Example of .gsloth.config.json for OpenAI**
```json
{
  "llm": {
    "type": "openai",
    "model": "gpt-4o",
    "apiKey": "your-api-key-here"
  }
}
```
You can use the `OPENAI_API_KEY` environment variable instead of specifying `apiKey` in the config.

**Example of .gsloth.config.json for Inception (OpenAI-compatible)**
```json
{
  "llm": {
    "type": "openai",
    "model": "mercury-coder",
    "apiKeyEnvironmentVariable": "INCEPTION_API_KEY",
    "configuration": {
      "baseURL": "https://api.inceptionlabs.ai/v1"
    }
  }
}
```
You can use the `INCEPTION_API_KEY` environment variable as specified in `apiKeyEnvironmentVariable`.

**Example of .gsloth.config.json for Google GenAI**
```json
{
  "llm": {
    "type": "google-genai",
    "model": "gemini-2.5-pro",
    "apiKey": "your-api-key-here"
  }
}
```
You can use the `GOOGLE_API_KEY` environment variable instead of specifying `apiKey` in the config.

**Example of .gsloth.config.json for VertexAI**
```json
{
  "llm": {
    "type": "vertexai",
    "model": "gemini-2.5-pro"
  }
}
```
VertexAI typically uses gcloud authentication; no `apiKey` is needed in the config.

**Example of .gsloth.config.json for Open Router**
```json
{
  "llm": {
    "type": "openrouter",
    "model": "moonshotai/kimi-k2"
  }
}
```

Make sure you either define `OPEN_ROUTER_API_KEY` environment variable or edit your configuration file and set up your key.
When changing a model, make sure you're using a model which supports tools.

**Example of .gsloth.config.json for xAI**
```json
{
  "llm": {
    "type": "xai",
    "model": "grok-4-0709",
    "apiKey": "your-api-key-here"
  }
}
```
You can use the `XAI_API_KEY` environment variable instead of specifying `apiKey` in the config.

### JavaScript Configuration

(.gsloth.config.js or .gsloth.config.mjs)

JavaScript configuration provides more flexibility than JSON configuration, allowing you to use dynamic imports and include custom tools.

**For a complete working example** demonstrating custom middleware and custom tools, see:
- [JavaScript Config Example README](../examples/js-config/README.md) - Full documentation and usage guide
- [Example Config File](../examples/js-config/.gsloth.config.js) - Complete working example with custom logging middleware and custom logger tool

The example demonstrates:
- Custom middleware with all lifecycle hooks (`beforeAgent`, `beforeModel`, `afterModel`, `afterAgent`)
- Custom tool creation using LangChain's `tool()` API
- Combining built-in and custom middleware
- Practical patterns for extending Gaunt Sloth functionality

**Example with Custom Tools**
```javascript
// .gsloth.config.mjs
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const parrotTool = tool((s) => {
  console.log(s);
}, {
  name: 'parrot_tool',
  description: `This tool will simply print the string`,
  schema: z.string(),
});

export async function configure() {
  const anthropic = await import('@langchain/google-vertexai');
  return {
    llm: new anthropic.ChatVertexAI({
      model: 'gemini-2.5-pro',
    }),
    tools: [
      parrotTool
    ]
  };
}
```

**Example of .gsloth.config.mjs for Anthropic**
```javascript
export async function configure() {
    const anthropic = await import('@langchain/anthropic');
    return {
        llm: new anthropic.ChatAnthropic({
            apiKey: process.env.ANTHROPIC_API_KEY, // Default value, but you can provide the key in many different ways, even as literal
            model: "claude-sonnet-4-5"
        })
    };
}
```

**Example of .gsloth.config.mjs for Groq**
```javascript
export async function configure() {
    const groq = await import('@langchain/groq');
    return {
        llm: new groq.ChatGroq({
            model: "deepseek-r1-distill-llama-70b", // Check other models available
            apiKey: process.env.GROQ_API_KEY, // Default value, but you can provide the key in many different ways, even as literal
        })
    };
}
```

**Example of .gsloth.config.mjs for DeepSeek**
```javascript
export async function configure() {
    const deepseek = await import('@langchain/deepseek');
    return {
        llm: new deepseek.ChatDeepSeek({
            model: 'deepseek-reasoner',
            apiKey: process.env.DEEPSEEK_API_KEY, // Default value, but you can provide the key in many different ways, even as literal
        })
    };
}
```

**Example of .gsloth.config.mjs for OpenAI**
```javascript
export async function configure() {
    const openai = await import('@langchain/openai');
    return {
        llm: new openai.ChatOpenAI({
            model: 'gpt-4o',
            apiKey: process.env.OPENAI_API_KEY, // Default value, but you can provide the key in many different ways, even as literal
        })
    };
}
```

**Example of .gsloth.config.mjs for Inception (OpenAI-compatible)**
```javascript
export async function configure() {
    const openai = await import('@langchain/openai');
    return {
        llm: new openai.ChatOpenAI({
            model: 'mercury-coder',
            apiKey: process.env.INCEPTION_API_KEY, // Default value, but you can provide the key in many different ways, even as literal
            configuration: {
                baseURL: 'https://api.inceptionlabs.ai/v1',
            },
        })
    };
}
```

**Example of .gsloth.config.mjs for Google GenAI**
```javascript
export async function configure() {
  const googleGenai = await import('@langchain/google-genai');
  return {
    llm: new googleGenai.ChatGoogleGenerativeAI({
      model: 'gemini-2.5-pro',
      apiKey: process.env.GOOGLE_API_KEY, // Default value, but you can provide the key in many different ways, even as literal
    })
  };
}
```

**Example of .gsloth.config.mjs for VertexAI**
VertexAI usually needs `gcloud auth application-default login`
(or both `gcloud auth login` and `gcloud auth application-default login`) and does not need any separate API keys.
```javascript
export async function configure() {
    const vertexAi = await import('@langchain/google-vertexai');
    return {
        llm: new vertexAi.ChatVertexAI({
            model: "gemini-2.5-pro", // Consider checking for latest recommended model versions
            // API Key from AI Studio should also work
            //// Other parameters might be relevant depending on Vertex AI API updates.
            //// The project is not in the interface, but it is in documentation and it seems to work.
            // project: 'your-cool-google-cloud-project',
        })
    }
}
```

**Example of .gsloth.config.mjs for xAI**
```javascript
export async function configure() {
    const xai = await import('@langchain/xai');
    return {
        llm: new xai.ChatXAI({
            model: 'grok-4-0709',
            apiKey: process.env.XAI_API_KEY, // Default value, but you can provide the key in many different ways, even as literal
        })
    };
}
```

## Using other AI providers

The configure function should simply return instance of langchain [chat model](https://v03.api.js.langchain.com/classes/_langchain_core.language_models_chat_models.BaseChatModel.html).
See [Langchain documentation](https://js.langchain.com/docs/tutorials/llm_chain/) for more details.

## Integration with GitHub Workflows / Actions

Example GitHub workflows integration can be found in [.github/workflows/review.yml](.github/workflows/review.yml)
this example workflow performs AI review on any pushes to Pull Request, resulting in a comment left by,
GitHub actions bot.

## Model Context Protocol (MCP)

Gaunt Sloth Assistant supports the Model Context Protocol (MCP), which provides enhanced context management. You can connect to various MCP servers, including those requiring OAuth authentication.

### OAuth-enabled MCP Servers

Gaunt Sloth now supports OAuth authentication for MCP servers. This has been tested with the Atlassian Jira MCP server.

#### Example: Atlassian Jira MCP Server

To connect to the Atlassian Jira MCP server using OAuth, add the following to your `.gsloth.config.json`:

```json
{
  "llm": {
    "type": "vertexai",
    "model": "gemini-2.5-pro",
    "temperature": 0
  },
  "mcpServers": {
    "jira": {
      "url": "https://mcp.atlassian.com/v1/sse",
      "authProvider": "OAuth",
      "transport": "sse"
    }
  }
}
```

For a complete working example, see [examples/jira-mcp](../examples/jira-mcp).

**OAuth Authentication Flow:**
1. When you first use a command that requires the MCP server, your browser will open automatically
2. Complete the OAuth authentication in your browser
3. The authentication tokens are stored securely in `~/.gsloth/.gsloth-auth/`
4. Future sessions will use the stored tokens automatically

**Token Storage:**
- OAuth tokens are stored in JSON files under `~/.gsloth/.gsloth-auth/`
- Each server's tokens are stored in a separate file named after the server URL
- The storage location is cross-platform (Windows, macOS, Linux)

### MCP stdio Server Configuration

To configure local MCP server, add the `mcpServers` section to your configuration file,
for example, configuration for reference sequential thinking MCP follows:

```json
{
  "llm": {
    "type": "vertexai",
    "model": "gemini-2.5-pro"
  },
  "mcpServers": {
    "sequential-thinking": {
      "transport": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-sequential-thinking"
      ]
    }
  }
}
```

This configuration launches the MCP filesystem server using npx, providing the LLM with access to the specified directory. The server uses stdio for communication with the LLM.

## Content providers

### GitHub Issues

Gaunt Sloth supports GitHub issues as a requirements provider using the GitHub CLI. This integration is simple to use and requires minimal setup.

**Prerequisites:**

1. **GitHub CLI**: Make sure the official [GitHub CLI (gh)](https://cli.github.com/) is installed and authenticated
2. **Repository Access**: Ensure you have access to the repository's issues

**Usage:**

The command syntax is `gsloth pr <prId> [githubIssueId]`. For example:

```bash
gsloth pr 42 23
```

This will review PR #42 and include GitHub issue #23 as requirements.

To explicitly specify the GitHub issue provider:

```bash
gsloth pr 42 23 -p github
```

**Configuration:**

To set GitHub as your default requirements provider, add this to your configuration file:

```json
{
  "llm": {"type": "vertexai", "model": "gemini-2.5-pro"},
  "commands": {
    "pr": {
      "requirementsProvider": "github"
    }
  }
}
```

### JIRA

Gaunt Sloth supports three methods to integrate with JIRA:

#### Atlassian MCP

MCP can be used in `chat` and `code` commands.

Gaunt Sloth has OAuth client for MCP and is confirmed to work with public Jira MCP.

```json
{
  "llm": {
    "type": "vertexai",
    "model": "gemini-2.5-pro",
    "temperature": 0
  },
  "mcpServers": {
    "jira": {
      "url": "https://mcp.atlassian.com/v1/sse",
      "authProvider": "OAuth",
      "transport": "sse"
    }
  }
}
```

#### 1. Modern Jira REST API (Scoped Token)

Jira API is used with `pr` and `review` commands.

This method uses the Atlassian REST API v3 with a Personal Access Token (PAT). It requires your Atlassian Cloud ID.

**Prerequisites:**

1. **Cloud ID**: You can find your Cloud ID by visiting `https://yourcompany.atlassian.net/_edge/tenant_info` while authenticated.

2. **Personal Access Token (PAT)**: Create a PAT with the appropriate permissions from `Atlassian Account Settings -> Security -> Create and manage API tokens -> [Create API token with scopes]`.
   - For issue access, the recommended permission is `read:jira-work` (classic)
   - Alternatively granular access would require: `read:issue-meta:jira`, `read:issue-security-level:jira`, `read:issue.vote:jira`, `read:issue.changelog:jira`, `read:avatar:jira`, `read:issue:jira`, `read:status:jira`, `read:user:jira`, `read:field-configuration:jira`

Refer to JIRA API documentation for more details [https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-issueidorkey-get](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-issueidorkey-get)

**Environment Variables Support:**

For better security, you can set the JIRA username, token, and cloud ID using environment variables instead of placing them in the configuration file:

- `JIRA_USERNAME`: Your JIRA username (e.g., `user@yourcompany.com`).
- `JIRA_API_PAT_TOKEN`: Your JIRA Personal Access Token with scopes.
- `JIRA_CLOUD_ID`: Your Atlassian Cloud ID.

If these environment variables are set, they will take precedence over the values in the configuration file.

JSON:

```json
{
  "llm": {"type": "vertexai", "model": "gemini-2.5-pro"},
  "requirementsProvider": "jira",
  "requirementsProviderConfig": {
    "jira": {
      "username": "username@yourcompany.com",
      "token": "YOUR_JIRA_PAT_TOKEN",
      "cloudId": "YOUR_ATLASSIAN_CLOUD_ID"
    }
  }
}
```

Optionally displayUrl can be defined to have a clickable link in the output:

```json
{
  "llm": {"type": "vertexai", "model": "gemini-2.5-pro"},
  "requirementsProvider": "jira",
  "requirementsProviderConfig": {
    "jira": {
      "displayUrl": "https://yourcompany.atlassian.net/browse/"
    }
  }
}
```

JavaScript:

```javascript
export async function configure() {
  const vertexAi = await import('@langchain/google-vertexai');
  return {
    llm: new vertexAi.ChatVertexAI({
      model: "gemini-2.5-pro"
    }),
    requirementsProvider: 'jira',
    requirementsProviderConfig: {
      'jira': {
        username: 'username@yourcompany.com', // Your Jira username/email
        token: 'YOUR_JIRA_PAT_TOKEN',        // Your Personal Access Token
        cloudId: 'YOUR_ATLASSIAN_CLOUD_ID'    // Your Atlassian Cloud ID
      }
    }
  }
}
```

##### Automatic work logging for Jira reviews

When you pass a Jira issue ID to `gsloth pr` and use the modern Jira provider (`requirementsProvider: "jira"`),
you can ask Gaunt Sloth to log review time back to that issue automatically by setting
`commands.pr.logWorkForReviewInSeconds`. The value is recorded as worklog seconds after each PR review.

```json
{
  "commands": {
    "pr": {
      "requirementsProvider": "jira",
      "logWorkForReviewInSeconds": 600
    }
  }
}
```

This automation only runs when a `requirementsId` is supplied on the command line and the provider resolves to `jira`.

#### 2. Legacy Jira REST API (Unscoped Token)

Jira API is used with `pr` and `review` commands.

This uses the Unscoped API token (Aka Legacy API token) method with REST API v2.

A legacy token can be acquired from `Atlassian Account Settings -> Security -> Create and manage API tokens -> [Create API token without scopes]`.

Example configuration setting up JIRA integration using a legacy API token for both `review` and `pr` commands.
Make sure you use your actual company domain in `baseUrl` and your personal legacy `token`.

**Environment Variables Support:**

For better security, you can set the JIRA username and token using environment variables instead of placing them in the configuration file:

- `JIRA_USERNAME`: Your JIRA username (e.g., `user@yourcompany.com`).
- `JIRA_LEGACY_API_TOKEN`: Your JIRA legacy API token.

If these environment variables are set, they will take precedence over the values in the configuration file.

JSON:

```json
{
  "llm": {"type": "vertexai", "model": "gemini-2.5-pro"},
  "requirementsProvider": "jira-legacy",
  "requirementsProviderConfig": {
    "jira-legacy": {
      "username": "username@yourcompany.com",
      "token": "YOUR_JIRA_LEGACY_TOKEN",
      "baseUrl": "https://yourcompany.atlassian.net/rest/api/2/issue/"
    }
  }
}
```

JavaScript:

```javascript
export async function configure() {
  const vertexAi = await import('@langchain/google-vertexai');
  return {
    llm: new vertexAi.ChatVertexAI({
      model: "gemini-2.5-pro"
    }),
    requirementsProvider: 'jira-legacy',
    requirementsProviderConfig: {
      'jira-legacy': {
        username: 'username@yourcompany.com', // Your Jira username/email
        token: 'YOUR_JIRA_LEGACY_TOKEN',     // Replace with your real Jira API token
        baseUrl: 'https://yourcompany.atlassian.net/rest/api/2/issue/'  // Your Jira instance base URL
      }
    }
  }
}
```

## Development Tools Configuration

The `code` command can be configured with development tools via `commands.code.devTools`. These tools allow the AI to run build, tests, lint, and single tests using the specified commands.

The tools are defined in `src/tools/GthDevToolkit.ts` and include:

- **run_tests**: Executes the full test suite.
- **run_single_test**: Runs a single test file. The test path must be relative.
- **run_lint**: Runs the linter, potentially with auto-fix.
- **run_build**: Builds the project.

These tools execute the configured shell commands and capture their output.

Example configuration including dev tools (from .gsloth.config.json):

```json
{
  "llm": {
    "type": "xai",
    "model": "grok-4-0709"
  },
  "commands": {
    "code": {
      "filesystem": "all",
      "devTools": {
        "run_build": "npm build",
        "run_tests": "npm test",
        "run_lint": "npm run lint-n-fix",
        "run_single_test": "npm test"
      }
    }
  }
}
```

Note: For `run_single_test`, the command can include a placeholder like `${testPath}` for the test file path.
Security validations are in place to prevent path traversal or injection.

## Middleware Configuration

Gaunt Sloth supports middleware to intercept and control agent execution at critical points. Middleware provides hooks for cost optimization, conversation management, and custom logic.

### Predefined Middleware

There are two predefined middleware types available:

#### Anthropic Prompt Caching Middleware

Reduces API costs by caching prompts (Anthropic models only):

```json
{
  "llm": {
    "type": "anthropic",
    "model": "claude-sonnet-4-5"
  },
  "middleware": [
    "anthropic-prompt-caching"
  ]
}
```

With custom TTL configuration:

```json
{
  "middleware": [
    {
      "name": "anthropic-prompt-caching",
      "ttl": "5m"
    }
  ]
}
```

TTL options: `"5m"` (5 minutes) or `"1h"` (1 hour)

#### Summarization Middleware

Automatically condenses conversation history when approaching token limits:

```json
{
  "middleware": [
    "summarization"
  ]
}
```

With custom configuration:

```json
{
  "middleware": [
    {
      "name": "summarization",
      "maxTokensBeforeSummary": 8000,
      "messagesToKeep": 5
    }
  ]
}
```

Configuration options:
- `maxTokensBeforeSummary`: Maximum tokens before triggering summarization (default: 10000)
- `messagesToKeep`: Number of recent messages to keep after summarization
- `summaryPrompt`: Custom prompt template for summarization
- `model`: Custom model for summarization (defaults to main LLM)

### Multiple Middleware

You can combine multiple middleware:

```json
{
  "llm": {
    "type": "anthropic",
    "model": "claude-sonnet-4-5"
  },
  "middleware": [
    "anthropic-prompt-caching",
    {
      "name": "summarization",
      "maxTokensBeforeSummary": 12000
    }
  ]
}
```

### Custom Middleware (JavaScript Config Only)

Custom middleware objects are only available in JavaScript configurations. Always wrap them with LangChain's `createMiddleware` to include the required `MIDDLEWARE_BRAND` marker—plain objects/functions will be rejected by the registry.

```javascript
// .gsloth.config.mjs
import { createMiddleware } from 'langchain';

const requestLogger = createMiddleware({
  name: 'request-logger',
  beforeModel: (state) => {
    // Custom logic before model execution
    console.log('Processing request...');
    return state;
  },
  afterModel: (state) => {
    // Custom logic after model execution
    console.log('Model completed');
    return state;
  },
});

export async function configure() {
  const anthropic = await import('@langchain/anthropic');
  
  return {
    llm: new anthropic.ChatAnthropic({
      model: "claude-sonnet-4-5"
    }),
    middleware: [
      "summarization",
      requestLogger
    ]
  };
}
```

## Review Rating Configuration

The `review` and `pr` commands **automatically provide** automated review scoring with configurable pass/fail thresholds. **Rating is enabled by default** - the AI concludes every review with a numerical rating (0-10) and a comment explaining the rating.

### Rating Scale

- **0-2**: Bad code with syntax errors or critical issues (equivalent to REJECT)
- **3-5**: Code needs significant changes (equivalent to REQUEST_CHANGES)
- **6-10**: Code is acceptable (equivalent to APPROVE)

### Default Behavior

**Out of the box, without any configuration:**
- ✅ Rating is **enabled**
- ✅ Pass threshold is **6/10**
- ✅ Failed reviews (< 6) **exit with code 1** for CI/CD integration

### Configuration Options

You can customize rating behavior for `review` and `pr` commands under `commands.review.rating` or `commands.pr.rating`:

- **`enabled`** (boolean, default: `true`): Enable or disable review rating
- **`passThreshold`** (number 0-10, default: `6`): Minimum score required to pass the review
- **`minRating`** (number, default: `0`): Lower bound for the rating scale
- **`maxRating`** (number, default: `10`): Upper bound for the rating scale
- **`errorOnReviewFail`** (boolean, default: `true`): Exit with error code 1 when review fails (below threshold)

### Example Configurations

**Default configuration (no config needed):**

Rating works out of the box with no configuration required! The defaults provide sensible CI/CD integration.

**Disable rating:**

```json
{
  "commands": {
    "review": {
      "rating": {
        "enabled": false
      }
    }
  }
}
```

**Custom threshold:**

```json
{
  "commands": {
    "review": {
      "rating": {
        "passThreshold": 8
      }
    }
  }
}
```

**Different thresholds for review and PR:**

```json
{
  "llm": {
    "type": "anthropic",
    "model": "claude-sonnet-4-5"
  },
  "commands": {
    "review": {
      "rating": {
        "enabled": true,
        "passThreshold": 6,
        "errorOnReviewFail": true
      }
    },
    "pr": {
      "rating": {
        "enabled": true,
        "passThreshold": 7,
        "errorOnReviewFail": true
      }
    }
  }
}
```

**Rating without failing the build:**

```json
{
  "commands": {
    "review": {
      "rating": {
        "enabled": true,
        "passThreshold": 6,
        "errorOnReviewFail": false
      }
    }
  }
}
```

### Output Format

When rating is enabled, the review will conclude with a clearly formatted rating section:

```
============================================================
REVIEW RATING
============================================================
PASS 8/10 (threshold: 6)

Comment: Code quality is good with minor improvements needed.
Well-structured and follows best practices.
============================================================
```

For failing reviews:

```
============================================================
REVIEW RATING
============================================================
FAIL 4/10 (threshold: 6)

Comment: Significant issues found requiring refactoring
before this code can be merged.
============================================================
```

### CI/CD Integration

When `errorOnReviewFail` is set to `true` (default), failed reviews will exit with code 1, which will fail CI/CD pipeline steps. This is useful for enforcing code quality standards in automated workflows.

Example usage in GitHub Actions:

```yaml
- name: Run code review
  run: gsloth review -f changed-files.diff
  # This step will fail if rating is below threshold
```

## A2A (Agent-to-Agent) Protocol Support (Experimental)

> **Note:** A2A support is an experimental feature and may change in future releases.

Gaunt Sloth supports the [A2A protocol](https://google.github.io/A2A/) for connecting to external AI agents. This allows delegating tasks to specialized agents.

### Configuration

Add `a2aAgents` to your configuration file:

```json
{
  "llm": {
    "type": "YOUR_PROVIDER",
    "model": "MODEL_OF_YOUR_CHOICE"
  },
  "a2aAgents": {
    "myAgent": {
      "agentId": "my-agent-id",
      "agentUrl": "http://localhost:8080/a2a"
    }
  }
}
```

Each agent becomes available as a tool named `a2a_agent_<agentId>` in `chat` and `code` commands.

See [examples/a2a](../examples/a2a) for a working example.

## Server Tools Configuration

Some AI providers provide integrated server tools, such as web search.

**.gsloth.config.json for OpenAI Web Search**
```json
{
  "llm": {
    "type": "openai",
    "model": "gpt-4o"
  },
  "tools": [
    { "type": "web_search_preview" }
  ]
}
```

**.gsloth.config.json for Anthropic Web Search**
```json
{
  "llm": {
    "type": "anthropic",
    "model": "claude-sonnet-4-5"
  },
  "tools": [
    {
      "type": "web_search_20250305",
      "name": "web_search",
      "max_uses": 10
    }
  ]
}
```
