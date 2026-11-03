# @bb/frp-client

Runs `frpc` for bb connect next. Used by the `bb--connect-next` plugin (the
server machine) and meant for the host daemon (other machines).

## API

- `frpArchiveFor(platform, arch, tool)`, `installFrp`, `resolveFrpc({ dataDir, env })`:
  frp `FRP_VERSION` (from `@bb/tunnel-contract/next`) from the GitHub release,
  linux/darwin/windows × amd64/arm64, checked against `FRP_ARCHIVE_SHA256`
  before it is extracted in process (tar.gz, zip on Windows) into
  `<dataDir>/frp/<version>/`. `BB_CONNECT_FRPC` (`FRPC_OVERRIDE_ENV`) names a
  binary to use instead.
- `parseTunnelServer(value, envName)`, `tunnelServerUrl(server)`: a `ws://` or
  `wss://` frp server (`BB_CONNECT_NEXT_SERVER` by default).
- `buildFrpcConfig`, `writeFrpcConfig` (mode 0600), `defaultTrustedCertificates`
  (Node's roots plus `NODE_EXTRA_CA_CERTS`), `writeTrustedCaFile`. frpc skips
  certificate checks over `wss` unless `transport.tls.trustedCaFile` is set, so
  the supervisor always writes `roots.pem` for `wss`.
- `cleanFrpcLine` (colour codes stripped, secrets redacted) and `parseFrpcLine`
  (`connecting`, `logged-in`, `proxy-started`, `proxy-refused`,
  `proxy-removed`, `offline`, and `refused` when the Login hook answered
  exactly `FRP_LOGIN_REFUSED_REASON`).
- `FrpcSupervisor`: give it `frpDir`, `primaryProxy` (the proxy whose start
  means `connected`, or `null` for "logged in"), `resolveBinary`,
  `trustedCertificates`, `prepare()` (server, user, credential, or
  `{ kind: "halt", reason }`), `proxies()` (the proxies wanted now), a logger and
  `onStatusChange`. `start()` launches and keeps `frpc` running (backoff 1 s
  doubling to 30 s, reset after 10 s up; 5 minutes after a refusal); `stop()`
  ends it. `status()` gives the state (`idle`, `connecting`, `connected`,
  `refused`, `offline`, `error`, `halted`), the last error, the next retry and
  each proxy's state (`pending`, `active`, or `refused` with the gate's reason).
  A refused primary proxy stops `frpc`; a refused other proxy is only reported.
- Proxy changes without a restart: call `proxiesChanged()` after `proxies()`
  changes. Each `frpc` gets an admin server on `127.0.0.1` with a random port,
  user and password (only in the 0600 config, redacted from the log); the
  supervisor rewrites the config and calls `GET /api/reload`. frpc keeps
  unchanged proxies and their connections, adds new ones and closes removed
  ones. If the reload fails, the supervisor restarts `frpc` at once.
  `frpProxyDiff(current, next)` names what changed.

## Tests

`pnpm exec turbo run test --filter=@bb/frp-client` runs real `frpc` and `frps`
0.71.0, cached in `~/.cache/bb-frp/0.71.0` (`BB_FRP_CACHE_DIR`), against a
stand-in for the gate's frp hooks. `@bb/frp-client/testing` exports those
fixtures for other packages.
