# Commands

This document provides detailed information about all available commands in Gaunt Sloth Assistant.

## Overview

Gaunt Sloth Assistant provides several commands to help with code review, analysis, and interaction. All commands can be executed using either `gsloth` or `gth`.

## init

Initialize Gaunt Sloth Assistant in your project.

```bash
gsloth init <type>
```

### Arguments
- `<type>` - Configuration type. Available options: `anthropic`, `groq`, `deepseek`, `openai`, `google-genai`, `vertexai`

### Description
Creates the necessary configuration files for your project. If a `.gsloth` directory exists, files will be placed in `.gsloth/.gsloth-settings/`. Otherwise, they will be created in the project root.
- `.gsloth.config.js`, `.gsloth.config.json`, or `.gsloth.config.mjs` - Configuration file
- `.gsloth.guidelines.md` - Project guidelines file

### Examples
```bash
gsloth init vertexai
gsloth init anthropic
gsloth init groq
```

## pr

Review a Pull Request in the current directory.

```bash
gsloth pr <prId> [requirementsId]
```

### Arguments
- `<prId>` - Pull request ID to review (required)
- `[requirementsId]` - Optional requirements ID to retrieve requirements from provider

### Options
- `-p, --requirements-provider <provider>` - Requirements provider for this review
- `-f, --file [files...]` - Input files to add before the diff

### Prerequisites
- GitHub CLI (`gh`) must be installed and authenticated
- For optimal reviews, the PR branch should be checked out locally

### Description
Reviews a pull request using GitHub as the default content provider. Can integrate with issue tracking systems to include requirements in the review.

### Examples
```bash
# Review PR #42
gsloth pr 42

# Review PR #42 with GitHub issue #23 as requirements
gsloth pr 42 23

# Review PR #42 with JIRA issue PROJ-123
gsloth pr 42 PROJ-123 -p jira

# Review PR #42 with additional context from files
gsloth pr 42 -f architecture.md notes.txt
```

## review

Review any diff or content provided via stdin, files, or content providers.

```bash
gsloth review [contentId]
```

### Arguments
- `[contentId]` - Optional content ID to retrieve content from provider

### Options
- `-f, --file [files...]` - Input files to add before the content
- `-r, --requirements <requirements>` - Requirements for this review
- `-p, --requirements-provider <provider>` - Requirements provider
- `--content-provider <provider>` - Content provider
- `-m, --message <message>` - Extra message to provide before the content

### Description
Flexible review command that can process content from various sources including stdin, files, or configured providers.

### Examples
```bash
# Review current git changes
git --no-pager diff | gsloth review

# Review specific commit range
git --no-pager diff origin/main...feature-branch | gsloth review

# Review with requirements file
gsloth review -r requirements.md

# Review with custom message
git diff | gsloth review -m "Please focus on security implications"
```

## ask

Ask questions about code or general programming topics.

```bash
gsloth ask [message]
```

### Arguments
- `[message]` - The question or message

### Options
- `-f, --file [files...]` - Input files to include with the question

### Description
Ask questions with optional file context. At least one input source (message, file, or stdin) is required.

### Examples
```bash
# Ask a general question
gsloth ask "which types of primitives are available in JavaScript?"

# Ask about a specific file
gsloth ask "Please explain this code" -f index.js

# Ask about multiple files
gsloth ask "How do these modules interact?" -f module1.js module2.js

# Use with stdin
cat error.log | gsloth ask "What might be causing these errors?"
```

## chat

Start an interactive chat session with Gaunt Sloth.

```bash
gsloth chat [message]
```

It is possible to press Escape during inference to interrupt it.

### Arguments
- `[message]` - Initial message to start the chat

### Description
Opens an interactive chat session where you can have a conversation with the AI. The session maintains context throughout the conversation. Chat history is saved to `.gsloth/CHAT_<timestamp>.md`.

### Features
- Interactive conversation with context memory
- Type 'exit' or press Ctrl+C to end the session
- Chat history automatically saved

### Examples
```bash
# Start a chat session
gsloth chat

# Start with an initial message
gsloth chat "Let's discuss the architecture of this project"
```

## code

Write code interactively with full file system access within your project.

```bash
gsloth code [message]
```

It is possible to press Escape during inference to interrupt it.

### Arguments
- `[message]` - Initial message to start the code session

### Description
Opens an interactive coding session where the AI has full read access to your project files. This command is specifically designed for code writing tasks with enhanced context awareness. Code session history is saved to `gth_<timestamp>_CODE.md`.

### Features
- Full file system read access within project
- Interactive coding session with context memory
- Type 'exit' or press Ctrl+C to end the session
- Code history automatically saved
- Streaming disabled for better interactive experience

### Examples
```bash
# Start a code session
gsloth code

# Start with specific coding task
gsloth code "Help me refactor the authentication module"
```

## Command-Specific Configuration

Commands can be configured individually in your configuration file. See [CONFIGURATION.md](./CONFIGURATION.md) for detailed configuration options.

### Example Configuration
```json
{
  "llm": {
    "type": "anthropic",
    "model": "claude-sonnet-4-5"
  },
  "commands": {
    "pr": {
      "contentProvider": "github",
      "requirementsProvider": "github"
    },
    "review": {
      "contentProvider": "file",
      "requirementsProvider": "file"
    }
  }
}
```

## Output Files

All command outputs are saved as markdown files:
- If `.gsloth` directory exists: Files are saved to `.gsloth/`
- Otherwise: Files are saved to the project root
- File naming: `gth_<timestamp>_<COMMAND>.md` for interactive sessions (same as for other commands)

## Exit Codes

- `0` - Success
- `1` - Error occurred during command execution
