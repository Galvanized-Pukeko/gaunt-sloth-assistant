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
