# Adding review rater for review command

We want the review to be concluded with a rating following this scale.

The score should be a number from 0 to 10, where:
- 0 to 2: Bad code. Code has syntax errors or has other critical issues (equivalent to REJECT)
- 3 to 5: Code needs significant changes (equivalent to REQUEST_CHANGES)
- 6 to 10: Code is acceptable (equivalent to APPROVE)

This change should only apply to the `review` mode accessed via
src/commands/reviewCommand.ts and src/commands/prCommand.ts, but this should be considered to make
the ability to add similar functionality configurable for other commands.

The review scoring should be configurable via a config file,

we need the following settings
- enabled (default: true)
- passThreshold (the min threshold to pass the review, default: 6) 
- errorOnReviewFail (default: true)

Import exit from src/utils/systemUtils.ts when you need to exit the app with a code,
make sure to call this at the latest possible point in the code to make sure all messages are printed.

The final output before the exit should be the rating and a comment, the rating should be printed to make obvious what is the scale (e.g. FAIL 4/10) and what the threshold is.

The core idea is to add a response format to the main agent loop in src/core/GthLangChainAgent.ts
```typescript
import { createAgent, toolStrategy } from "langchain";
import * as z from "zod";

const RateSchema = z.object({
  rate: z.number().min(0).max(10),
  comment: z.string(),
});

const agent = createAgent({
  model: "gpt-4o-mini",
  tools,
  // explicitly using tool strategy
  responseFormat: toolStrategy(RateSchema), 
});
```

## Plan:
- Implement the change
- Implement and update tests
- Self-review
- Iterate to fix tests if necessary
- Update documentation