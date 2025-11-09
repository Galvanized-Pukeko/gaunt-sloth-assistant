Testing revealed some shortcomings of the structured output.

It seems like this discourages the model from talking as it used to be, this is undesired outcome,
for existing users we want it to produce the same review as before,
just producing the final review and a short summary in the end;
also this seems to cause quite a lot of custom code in the agent file (src/core/GthLangChainAgent.ts).

We are considering refactoring the feature to use middleware instead,
this will reduce the amount of incidental complexity in the agent file.
Apart from that, it will also retain the same behavior for the main loop as before,
simply adding an extra call in the end.

Below follows the snippet, roughly outlining the middleware,
please make sure it uses the schema we already have
and uses the prompt provided below;
the prompt has to be refactored to be dynamic,
taking in an account the threshold, the min max etc.

*Rough outline middleware prompt we used (feel free to improve):*
```text
At the end of the review you need to provide your rating ({min}-{max}) for the code and give a final short summary.

Pass threshold is {threshold}, everything below will be considered a fail.

Additional guidelines:
- Never give {threshold}/{max}} or more to code which would explode with syntax error.
- Rate excellent code as {max}/{max}
- Rate code needing improvements as {middleBetweenThresholdAndMax}/{max}
```

Also we believe it is better to introduce min max parameters as well.

*Pre-plan:*
- Refactor to use middleware
- Add min max parameters
- Refactor prompt to be dynamic
- Refactor .gsloth.review.md, the middleware should take care of rate prompt.
- Make sure `npm run it vertexai reviewCommand` and `npm run it vertexai prCommand` still pass.
- Update unit tests and iterate to fix them.
