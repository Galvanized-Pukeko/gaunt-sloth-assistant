# @gaunt-sloth/review

Review and question-answering functionality for Gaunt Sloth.

## Contents

- Review module (`reviewModule`) — diff and content review orchestration
- Question answering module (`questionAnsweringModule`)
- Command utilities (`commandUtils`)
- Content and requirement sources: `file`, `text`, `ghPrDiff`, `ghIssue`, `jiraIssue`, `jiraIssueLegacy`
- Jira client
- Review rate middleware

## CLI

The package ships a standalone binary `gaunt-sloth-review` for CI-friendly reviews that does not depend on `commander`. This makes it suitable for embedding in pipelines where a minimal footprint is preferred.

## Dependencies

- `@gaunt-sloth/core` (required)
- `@gaunt-sloth/tools` (optional peer dependency)

No MCP, no A2A, no commander. This is intentional to keep the package lightweight for CI use.

## Exports

```js
import { reviewModule } from '@gaunt-sloth/review/reviewModule.js';
import { questionAnsweringModule } from '@gaunt-sloth/review/questionAnsweringModule.js';
import { commandUtils } from '@gaunt-sloth/review/commandUtils.js';
```
