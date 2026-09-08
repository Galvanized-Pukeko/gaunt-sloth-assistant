# v2.0.0-beta.7

## Potentially Breaking Changes

- The AG-UI server (`gth api ag-ui` and the standalone `gaunt-sloth-api`) now binds `127.0.0.1`
  instead of every network interface, so an unauthenticated agent endpoint is no longer reachable
  from the network by default. Its startup banner previously said `localhost` and warned that the
  server was intended for local clients only while the socket accepted connections from anywhere.
  **If you serve a client on another machine — a phone, a second dev box, a container network — pass
  `--host 0.0.0.0` (or `::` for IPv6 as well) or set `commands.api.host`.** The new default is
  **IPv4** loopback, and one `listen` binds one address, so it narrows a **local** client too: one
  that dials `http://localhost:<port>`, resolves it to `::1` and does not fall back to IPv4 now gets
  a connection refused. **Pass `--host ::1` for that — it is IPv6 loopback, still this machine only;
  `--host ::` serves both families but is a network interface as well.** The banner now names the
  address actually bound, and the server says on startup either that only this machine can reach it
  or that anything routing to the address it names can, and that the endpoint has no
  authentication. See [api ag-ui](../docs/COMMANDS.md#api-ag-ui).

## New Features

- `--cors-origin <origin>` on `gth api ag-ui` and the standalone `gaunt-sloth-api` names the browser
  origin the AG-UI server allows, taking precedence over `commands.api.cors.allowOrigin` in the
  config. It takes one origin, not a list. The port and the origin are one decision: a launcher that
  moves the web client knows the origin it now serves from and cannot rewrite the config file that
  pins the old one, so without the flag the relocated client has every request refused by a preflight
  naming an origin it no longer has. See [api ag-ui](../docs/COMMANDS.md#api-ag-ui).

## Bug Fixes

- The AG-UI server no longer reports a successful start on a port it did not get. Express runs the
  listen callback whether the bind succeeded or failed, so a port another process already held
  produced the ordinary startup banner and an exit status of 0 with no server behind it. A failed
  bind now ends the run with an error naming the port and the host, and exits non-zero — **a script
  or CI job that starts this server and previously absorbed a port collision will now stop rather
  than run against nothing.** The banner also names the port the socket actually got rather than the
  one asked for, so a port of `0`, which asks the OS to choose one, announces an endpoint that can
  be connected to.

- A non-image attachment sent to a provider that silently discards it is now refused before the
  request is built, instead of reaching the model as an empty part. `@langchain/xai`'s Responses
  converter rewrites every content part it does not recognise into an empty text block, so a PDF,
  audio or video attachment on `xai-responses` was dropped with no error, no warning and no provider
  rejection — **the model then answered a question about a document it never received, and the answer
  looked exactly like a good one.** The turn now fails with an error naming the file and the provider.
  **This refuses only where the loss was actually measured.** Every other provider we measured either
  delivers the attachment or rejects it loudly, and images are untouched everywhere, `xai-responses`
  included — one exception worth naming is Groq, whose client puts the block on the wire unchanged
  and whose server-side handling we could not establish without a live call. There is no correct
  shape to send instead: xAI's Responses API accepts a file only as a Files-API `file_id`, and
  gaunt-sloth has no upload path to produce one.
