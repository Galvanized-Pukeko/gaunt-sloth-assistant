# Replace hooks with middleware

We are workging on 1.0.0-alpha,
The goal is to add configurable "Anthropic prompt caching" and
add an option via config to add predefined LangChain middlewares (with both json and JS config) and to add custom middleware (with JS config only).

- Read https://docs.langchain.com/oss/javascript/langchain/middleware  
- Read src/config.ts
- Add support for predefined LangChain middlewares
- Bear in mind that we are likely to create our own middlewares which should be functioning with json config as well