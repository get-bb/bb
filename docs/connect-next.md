# bb connect next (Fly)

bb connect next is an opt-in second way in to a bb server, next to the Cloudflare gate (`apps/connect`).
A server with the `connect-next` plugin enabled answers at `https://<label>.next.getbb.app` as well as
`https://<label>.getbb.app` (staging: `https://<label>.next.vibecodethis.site`; the plugin derives the
domain from its bb account, see Plugin). Accounts, servers, machines, credentials and OAuth grants stay in the
Cloudflare D1 database `bb-connect-prod`; only the data plane moves to Fly.

## Pieces

| Piece          | Where                                                                       | Owns                                                                                                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract       | `packages/tunnel-contract/src/next.ts` (`@bb/tunnel-contract/next`)         | Names, wire types, gate assertion signing and verification                                                                                                                                                                 |
| Account API    | `apps/connect` (Worker `bb-connect`, D1)                                    | `POST https://connect.getbb.app/api/gate/resolve[/batch]` and `/api/gate/presence[/batch]` (staging `connect.vibecodethis.site`), all behind `Authorization: Bearer <GATE_SECRET>` (Worker secret); var `NEXT_BASE_DOMAIN` |
| Gate keys      | `apps/web` (getbb.app apex)                                                 | `GET https://getbb.app/.well-known/bb-connect-gate-keys.json` from the `GATE_PUBLIC_KEYS` var (404 while unset; see Gate keys below), `cache-control: public, max-age=300`; var `NEXT_BASE_DOMAIN` for MCP OAuth           |
| Gate           | `apps/connect-next` (Fly app `bb-connect-next`)                             | TLS-terminated HTTP gate on 8080 plus `frps`; every rule of `apps/connect/src/worker.ts`                                                                                                                                   |
| Server ingress | `apps/server/src/services/connect-next`                                     | `bb.server.internal_DO_NOT_USE_openTunnelIngress`: a loopback listener that only accepts requests with a valid gate assertion                                                                                              |
| Plugin         | `plugins/connect-next` (builtin id `bb--connect-next`, disabled by default) | Downloads, verifies, configures and supervises `frpc`; settings, status, RPC, CLI                                                                                                                                          |

## Request path and checks

1. A visitor reaches the nearest Fly region at `<label>.next.getbb.app` (or a share at
   `<label>--<port>.next.getbb.app`). The gate admits them with the same rules as the Cloudflare gate,
   asking the account API (`GateResolveRequest` → `GateResolveResponse`, sent in batches) and caching
   answers (see Answer cache). The better-auth session cookie arrives because bb-web sets it on `.getbb.app`.
2. If the label's tunnel is held by another gate machine, the gate answers `fly-replay: instance=<id>`
   (or, for a body too large to replay, proxies over Fly's private network; see Regions).
3. `frpc` on the bb machine dials `wss://tunnel.next.getbb.app/~!frp`. The gate pipes that WebSocket to
   `frps` on loopback. `frps` asks the gate (server plugin hooks `Login`, `NewProxy`, `CloseProxy`)
   before accepting a client: `user` is the label and `metas.credential` the link credential, checked
   with `GateResolveRequest.credential`. A client may only claim `subdomain = <label>` (and its shares).
4. The gate signs a `GateAssertionClaims` per request (Ed25519, 60 s, `aud` = `server:<id>` or
   `machine:<id>`, bound to method and path-and-query, `target` = share port or null) and sends it as
   `x-bb-gate-assertion`. It strips every inbound `x-bb-gate-*` header, platform cookie and the
   assertion header a visitor sent.
5. `frpc` forwards to the server's tunnel ingress, a loopback port separate from the main one. The
   ingress refuses any request without a valid assertion for this server (401) and turns a valid one
   into the same request context the Cloudflare path produces (`getGateAuthKind`). The main loopback
   port keeps today's local trust. Share traffic (`<label>--<port>`) does not use the ingress: its
   frpc proxy goes straight to `127.0.0.1:<port>` with `Host` rewritten to `127.0.0.1:<port>`, as the
   Cloudflare tunnel does, and the gate rewrites an `Origin` equal to the share's own public origin
   (`<scheme>://<label>--<port>.<domain>[:port]`) to `http://127.0.0.1:<port>` (HTTP and WebSocket
   upgrades), so dev servers such as Vite accept the request and their HMR socket. Any other `Origin`
   is forwarded unchanged (and refused by the gate on state changes and WebSockets). The assertion
   header still reaches the dev server, which ignores it.

The server fetches gate public keys from `https://getbb.app/.well-known/bb-connect-gate-keys.json`
(`BB_CONNECT_GATE_KEYS_URL` overrides it) and caches them; an unknown `kid` triggers one refetch.

### Gate keys

`GATE_PUBLIC_KEYS` is public and lives in `apps/web/wrangler.jsonc` `vars`, not the dashboard (a
deploy replaces dashboard vars). Staging (`bb-web-staging`, served at
`https://vibecodethis.site/.well-known/bb-connect-gate-keys.json`) holds the staging gate's key,
`kid` `staging-2026-10-20`. Production (`env.production.vars`, served at
`https://getbb.app/.well-known/bb-connect-gate-keys.json`) holds `kid` `prod-2026-10-21`, made with
`generateGateKeyPair(kid)`; its private JWK is the `GATE_SIGNING_KEY` Fly secret of `bb-connect-next`.
A new key's public half must be deployed here before the gate signs with it.

## Account API

The routes live on the gate worker and answer only on a host-less or reserved-handle host
(`connect.<BASE_DOMAIN>`), so no server label loses the path. Without the Worker secret
`GATE_SECRET`, or with a missing or wrong bearer (compared in constant time), all of them answer
`404 bb connect: not found`. After that: `405` for anything but `POST`, `400 {"error":"invalid_request"}`
for a body that is not exactly the contract shape (every key present, no extra keys, labels
`[a-z0-9][a-z0-9-]{0,62}`, strings non-empty and at most 8 KiB, body at most 16 KiB; 256 KiB for
`resolve/batch`, 128 KiB for `presence/batch`). Answers carry `cache-control: no-store`.

`POST /api/gate/resolve` takes a `GateResolveRequest` and answers `200` with a `GateResolveResponse`.
Every field is `null` when its input was `null`:

- `label`: the server or machine the label names (`null` when none), with `revoked` and `lastSeenAt`
  (epoch ms). The worker caches labels for 15 s per isolate; a request with `credential` reads fresh.
- `session`: the better-auth `session_token` cookie value (as sent, URL-encoded or not) →
  `{ userId, needsRefresh }`, or `null` when forged, unknown or expired. `needsRefresh` is true once
  the session is within six days of expiry: the gate then does what the Cloudflare gate does, calls
  `GET https://getbb.app/api/auth/get-session?disableCookieCache=true` with the visitor's cookie,
  passes the `Set-Cookie` headers it returns (`Domain=.getbb.app`) to the visitor, and forgets its
  cached answer for that cookie. Only the gate that serves the visit refreshes: a gate that answers
  `fly-replay` leaves it to the holder. Renewed cookies (this one and `desktopSession.setCookie`) are
  added to the visitor's response even when it comes from or goes into the gate's asset cache, and are
  never stored there. The worker caches sessions for 20 s per isolate, but rereads a cached session
  that is due for a refresh, so `needsRefresh` turns false as soon as bb-web renewed it.
- `desktopSession`: the `__Secure-bb-connect.desktop_session` cookie value → `{ userId, setCookie }`.
  `setCookie` is a complete renewed `Set-Cookie` line when the cookie is near expiry and its user owns
  the label (append it to the visitor's response), otherwise `null`.
- `credential`: the frp link credential → `true` when its SHA-256 equals the label's server or machine
  `credentialHash` and the owner is not revoked, else `false`.
- `machine`: a machine credential (`x-bb-connect-machine`) → `{ machineId, userId }` for any unrevoked
  machine; the gate checks `userId` against the label owner. A match for the owner marks the machine seen.
- `oauth`: `{ token, resource }` → `{ scope, grantId, clientName }` only when the label is an unrevoked
  server, `resource` is exactly `https://<label>.<NEXT_BASE_DOMAIN>/mcp`, and the token was issued for
  that resource, user, server and an unrevoked grant. Tokens for `https://<label>.getbb.app/mcp` are
  refused here and next tokens are refused by the Cloudflare gate. The grant is cached 30 s per isolate
  and the gate keeps the answer fresh up to 60 s, so a revoked grant stops working within about 60 s
  (90 s plus one refresh at worst; 5 minutes while the account API is failing, see Answer cache). In local Cloud development (`CLOUD_DEV=true`) the resource may also be
  `http://<label>.<NEXT_BASE_DOMAIN>:<port>/mcp`, the address of a local gate.

`POST /api/gate/presence` takes a `GatePresenceRequest` and answers `200 {"recorded": boolean}`,
`404 {"error":"unknown_label"}`, or `400` when `at` (epoch ms) is more than 60 s ahead. It writes
`next_tunnel_gate`, `next_tunnel_region`, `next_tunnel_at` and `last_seen_at` on the server or machine
row, and only when something changed: a `connected` newer than the stored `at` from another gate
machine or region, or from the same one when the stored `at` is at least 5 minutes older
(`NEXT_TUNNEL_WRITE_INTERVAL_MS`); a `disconnected` from the gate machine on record, not older than the
stored `at`. Older or foreign events are ignored. The dashboard shows a row online while its Cloudflare
tunnel is connected or `next_tunnel_gate` is set and `next_tunnel_at` is younger than 12 minutes
(`NEXT_TUNNEL_STALE_MS`), so the gate re-sends `connected` for every held label at least every
5 minutes and sends `disconnected` when a tunnel closes or the gate machine stops.

`POST /api/gate/resolve/batch` takes a `GateResolveBatchRequest`, `{ "requests": [GateResolveRequest, …] }`
with 1 to `GATE_RESOLVE_BATCH_MAX` (50) entries, and answers `200 { "answers": [...] }` in the same
order, each exactly what `/api/gate/resolve` answers for that entry, or `null` when that entry could
not be checked (a D1 error; the gate treats it as an outage for that entry only). It reads every
label of the batch fresh with one query for servers and one for machines (which also refills the
15 s label cache), so a batch of 50 `Login` checks costs two label queries. The gate sends every
lookup this way.

`POST /api/gate/presence/batch` takes a `GatePresenceBatchRequest`,
`{ "reports": [GatePresenceRequest, …] }` with 1 to `GATE_PRESENCE_BATCH_MAX` (500) entries and no
label twice, and answers `200 { "results": [...] }` in the same order, each `"recorded"`,
`"unchanged"` (known label, nothing to write under the rules above) or `"unknown_label"`. A duplicate
label or an `at` more than 60 s ahead on any entry makes the whole call `400`. The whole batch is one
D1 batch of five statements over `json_each` (known labels; `connected` and `disconnected` updates for
servers and for machines), with the same write rules as `/api/gate/presence`, which now runs the same
statements for a single entry. The gate sends all presence this way. Deploy the Worker before a gate
that uses the batch routes.

The protected-resource metadata on a next address is the gate's to serve:
`GET https://<label>.next.getbb.app/.well-known/oauth-protected-resource[/mcp]` →
`{"resource":"https://<label>.next.getbb.app/mcp","authorization_servers":["https://getbb.app"],
"scopes_supported":["bb"],"bearer_methods_supported":["header"],"resource_name":"bb"}`, and a `401` on
`/mcp` carries `WWW-Authenticate: Bearer error="invalid_token", resource_metadata="https://<label>.next.getbb.app/.well-known/oauth-protected-resource/mcp", scope="bb"`.
bb-web's `/oauth/authorize` and `/oauth/token` accept that resource when `NEXT_BASE_DOMAIN` is set
(`next.getbb.app`, staging `next.vibecodethis.site`) and bind the grant to it exactly.

## Server ingress

The `connect-next` plugin opens the ingress with
`bb.server.internal_DO_NOT_USE_openTunnelIngress({ audience: "server:<serverId>" })` and points `frpc`'s
local address at the returned `baseUrl` (`http://127.0.0.1:<ephemeral port>`). Opening the same
audience again shares the listener; it stops, and drops its WebSockets, when every handle is closed,
and the plugin's handles close when it is disabled or unloaded. Reopen after a restart; the port changes.

For every HTTP request and WebSocket upgrade the ingress:

1. Requires `x-bb-gate-assertion` and verifies it with `verifyGateAssertion` against the audience,
   the request method and the path and query exactly as received (`frpc` must not rewrite the path),
   at the current time. A claim with a non-null `target` (a share) or `kind: "oauth"` without
   `oauth` is refused too. A `kind: "public"` claim is accepted only for `GET` or `HEAD` of the
   install paths (`GATE_PUBLIC_PATHS`: `/install.sh`, `/install.ps1`, `/install/version`,
   `/install/bb-app.tgz`); for anything else it is refused with `not_public`.
2. On failure answers 401 `{ "code": "gate_assertion_invalid", "message", "reason" }`, where
   `reason` is a `GateAssertionFailure`, `missing`, `no_keys`, `unexpected_target`, `not_public`
   or `bad_request_target`, and logs the reason at debug. Nothing reaches the app.
3. On success drops every inbound `x-bb-gate-*` header and sets, from the claims only,
   `x-bb-gate-auth: session | machine | oauth`; for `machine`, `x-bb-gate-machine-id: <sub>` (the gate
   must sign the machine id as `sub`); for `oauth`, `x-bb-gate-oauth-scope`, `-grant` and `-client`,
   with `authorization` and `cookie` removed, as `apps/connect` does for the MCP endpoint; for
   `public`, no `x-bb-gate-auth` at all and `authorization` and `cookie` removed.
4. Rewrites Host to the server's loopback host and an Origin equal to `https://<incoming Host>` to
   the loopback origin, like `packages/tunnel-client`, so `frpc` must forward the public Host
   unchanged. Any other Origin is left for the server's browser guard to refuse.
5. Dispatches in-process into the same app as the main port: HTTP, `/ws`, terminals and plugin
   WebSockets. Ingress requests never count as loopback callers, so loopback-only routes
   (`/internal/hosts/enroll-key`, `/internal/server-move/pending`) refuse them.

Gate keys are fetched on first use, cached in memory and refetched at most once a minute, when a
`kid` is unknown or (in the background) when the set is older than 15 minutes. A failed fetch keeps
the last good set; with no set every ingress request is refused (`no_keys`). The main loopback port
is unchanged and still trusts local callers.

## Plugin

`plugins/connect-next` ships as a builtin plugin that is disabled by default. Enabling it is the
opt-in: its `enabled` setting ("Reach this bb at its next address (beta)") defaults to `true`, so the
tunnel starts as soon as bb account is signed in. The setting (or `bb connect-next off`) turns the
next address off without disabling the plugin.

- **Identity.** It follows bb account (`bb-account.v1.status` / `waitForStatusChange`) for
  `serverId`, `serverLabel` and `baseUrl`, and reads the link credential with `bb-account.v1.connectCredential`,
  which bb account serves to `connect` and `bb--connect-next` only. It never reports a refusal back to bb
  account, so a gate problem cannot sign the server out.
- **Address.** The next domain is `next.<host of the account's baseUrl>`: `next.getbb.app` for
  `https://getbb.app`, `next.vibecodethis.site` for staging, `next.bb.localhost:<port>` for local
  Cloud (`http://bb.localhost:<port>`). The status `url` is `<scheme>://<label>.<next domain>` and the
  tunnel server `wss://tunnel.<next domain>:443` (`ws://tunnel.next.bb.localhost:<port>` locally) unless
  `BB_CONNECT_NEXT_SERVER` overrides it. Before sign-in `url` is `null`, and so is `server` without
  an override.
- **frpc.** Run by `packages/frp-client` (`@bb/frp-client`, shared with the host daemon): frp
  `FRP_VERSION` from the GitHub release (linux/darwin/windows × amd64/arm64), pinned SHA-256 per
  archive, installed in `<dataDir>/plugins/bb--connect-next/frp/<version>/`. The config
  `frp/frpc.json` (0600) sets `serverAddr = tunnel.<next domain>`, `serverPort = 443`,
  `transport.protocol = "wss"`, `user = <label>`, `metadatas.credential`, `loginFailExit = false`,
  an admin `webServer` on `127.0.0.1` with a random port, user and password (used to hot-reload the
  proxy list with `GET /api/reload`; a failed reload restarts frpc) and an `http` proxy `bb` with
  `subdomain = <label>` pointing at the tunnel ingress. frpc does not verify a `wss` certificate
  unless `transport.tls.trustedCaFile` is set, so the plugin always writes Node's root store (plus
  `NODE_EXTRA_CA_CERTS`) to `frp/roots.pem` and points frpc at it.
- **Ingress.** `bb.server.internal_DO_NOT_USE_openTunnelIngress({ audience: gateAudienceForServer(id) })`,
  opened before frpc starts and closed when it stops (`plugins/connect-next/src/ingress.ts`). If it
  throws, the status is `error` and frpc is not started. The main loopback port is never exposed.
- **Status.** `off`, `signed-out`, `connecting`, `connected`, `refused` (the Login hook
  answered exactly `FRP_LOGIN_REFUSED_REASON` from `@bb/tunnel-contract/next`, or a NewProxy hook
  refused the proxy; retried after 5 minutes), `offline` (any other login failure, including
  transport errors and "the gate could not check this"; frpc keeps retrying),
  `error` (ingress, download or spawn failed; retried with backoff). frpc is restarted with backoff
  when it exits. Its log goes to the plugin log with the credential redacted. Realtime channel
  `connect-next`.
- **Shares.** Every port the connect plugin shares from the server machine (`bb connect expose`)
  becomes an frpc proxy `share-<port>`: `subdomain = <label>--<port>`, `localIP = 127.0.0.1`,
  `localPort = <port>`, `hostHeaderRewrite = 127.0.0.1:<port>`. The plugin learns them from connect's
  `connect.internal_DO_NOT_USE.serverShares` and long-polls `connect.internal_DO_NOT_USE.waitForServerSharesChange({ afterRevision })`
  (25 s; both answer `{ revision, ports }` and only to `bb--connect-next`); a stopped connect plugin
  means no shares. A change rewrites `frpc.json` and hot-reloads frpc, so the main proxy and its
  connections stay up; a refused share proxy is reported on that share and does not stop the tunnel.
  The gate answers an unshared port's address `503` at once (it skips the 15 s reconnect wait for a
  share whose label is still connected). Connect, in turn, reads `bb--connect-next`'s `status`
  while next is on and adds `nextUrl` (`<scheme>://<label>--<port>.<next domain>`) to server-machine
  share listings, printed by `bb connect expose` and `bb connect shares`, and
  `<scheme>://<machine-label>--<port>.<next domain>` to other machines' listings (see Machine tunnels).
  A machine enrolled through the next address already has that address as its listing's `url`, so
  its listing carries no `nextUrl` and the CLI prints the address once.
- **Surfaces.** The `enabled` setting's switch and a settings section with the state, address,
  shared ports and each machine's tunnel; RPC `status` (with
  `shares: [{ port, url, state: pending | active | refused, error }]` and
  `machines: [{ hostId, hostName, label, state, lastError, nextRetryAt, since, shares }]`) and
  `setEnabled({ enabled })`; CLI `bb connect-next status|on|off [--json]` (`status` prints a
  `share <port>  <url>  <state>` line per share and a `machine <name> (<host id>)  <label>  <state>`
  line per machine, followed by its shares).
- **Env.** `BB_CONNECT_FRPC` runs a given `frpc` instead of downloading one.
  `BB_CONNECT_NEXT_SERVER` (`ws://host:port` or `wss://host:port`) dials another frp server than the
  one derived from the account.
- **Tests.** `pnpm exec turbo run test --filter=bb-plugin-bb--connect-next` runs real frpc and frps
  0.71.0 (archives cached in `~/.cache/bb-frp/0.71.0`), with a hook server standing in for the gate.

## Machine tunnels

Ports shared from an enrolled machine other than the server's (`bb connect expose <port> --host
<machine>`, delivered by `bb.hosts.declareSharedPorts`) answer at
`<scheme>://<machine-label>--<port>.<next domain>` while next is on, served by that machine's host
daemon through the same gate. The machine label root shows the gate's machine page; there is no
main proxy for a machine.

- **Policy.** The plugin calls `bb.hosts.internal_DO_NOT_USE_setNextTunnels({ domain, server })` while its
  own tunnel is wanted (on, signed in, service running) with the domain and tunnel server it dials
  itself (`BB_CONNECT_NEXT_SERVER` included), and `null` otherwise. The server
  (`apps/server/src/ws/host-shared-ports.ts`) keeps that one config, owned by the plugin and cleared
  when it is disabled.
- **Wire (protocol 247).** The session-open response carries `connectNext: { generation, config }`
  and the server pushes `{ type: "connect-next.replace", generation, config }` (on socket open and
  on every change) to each connected daemon that has a bb connect machine credential
  (`hosts.connect_machine_id` set and `hasMachineCredential`); `config` is `null` for any other host.
  The daemon answers with `{ type: "connect-next.status", status: { state, label, lastError,
nextRetryAt, since, shares: [{ port, state, error }] } }` whenever it changes and on every session
  open; the server keeps the latest per session in memory and drops it with the session. The server
  accepts protocol 246 and 247 (`HOST_DAEMON_COMPATIBLE_PROTOCOL_VERSIONS`): a 246 daemon gets the
  old session-open response (no `connectNext`) and no `connect-next.*` message, so its Cloudflare
  machine tunnel works as before and it simply has no next tunnel.
- **Runner.** `apps/host-daemon/src/connect-next` runs an `FrpcSupervisor` from `@bb/frp-client`
  while the config is set and the machine shares at least one port: `user` = the machine label
  (from the same `connect-tunnel` label assignment the Cloudflare tunnel uses),
  `metadatas.credential` = the machine credential, `frpc` in `<data dir>/connect-next/frp/<version>/`
  (or `BB_CONNECT_FRPC`), `frpc.json` (0600) and `roots.pem` in `<data dir>/connect-next/frp/`, and
  one proxy `share-<port>` per shared port (`subdomain = <machine-label>--<port>`,
  `127.0.0.1:<port>`, `hostHeaderRewrite = 127.0.0.1:<port>`). Every `connect-shares.replace`
  hot-reloads the list (`/api/reload`); dropping to no port reloads to an empty list, waits 1 s so
  the gate sees the proxy removed rather than dropped, then stops frpc. `null`, a new config (then
  it restarts), daemon shutdown and machine removal stop it too, and so does losing the server
  session for 30 s (a machine that joined through the next address cannot hear `null` once next is
  off); the next session-open response starts it again. A Login refusal with the fixed
  reason reports `refused` and retries after 5 minutes; other failures report `offline` and frpc
  keeps retrying; `error` covers download, spawn and a refused config. frpc's log goes to the
  daemon log at debug, with the credential redacted.
- **Trust.** The daemon only sends its credential to the domain it enrolled with: the config's
  domain must be the base domain of its enrollment URL or `next.<base domain>`, the tunnel host
  must be `tunnel.<domain>`, and `wss` is required unless the enrollment is a `*.localhost` one.
  Anything else is `error` with the reason, and frpc never starts.
- **Machines that joined through a next address.** A machine can enroll with a join code
  (`POST /api/v1/hosts/join-codes`) against `https://<label>.next.<domain>`: its runner traffic
  carries `x-bb-connect-machine`, which the gate checks and signs as a `machine` assertion for the
  ingress, so the server records its `connect_machine_id` like the Cloudflare path does. Neither
  loopback-only route (`/internal/hosts/enroll-key`, `/internal/server-move/pending`) is needed for
  that: `bb-app host-daemon join --join-code … --host-id …` skips the enroll-key request. The
  machine's label request (`POST /api/connect/machine-label` on the server's address) is relayed by
  the gate to the account API with the machine credential (`src/machine-label.ts`; 4 KiB body
  limit, `401` without a credential, `405` for anything but `POST`). Such a machine's trusted base
  domain is the next domain, which has no `/__tunnel`, so its Cloudflare machine tunnel does not
  dial (`lastError` says so) and its shares answer only through connect next.

## Not in the first cut

Moving `*.getbb.app` itself.

## Operating it

The gate is `apps/connect-next` (`@bb/connect-next`). One Node 24 process owns:

- the visitor gate on `PORT` (8080), which also answers `GET /__gate/health` on any host for Fly's
  checks, and pipes `GET /~!frp` WebSocket upgrades on `tunnel.<BASE_DOMAIN>` (any port in `Host`)
  byte for byte to `frps`, which serves frp's `websocket`/`wss` transport on its bind port;
- `frps` 0.71.0 as a child, bound to loopback only: bind port `FRP_BIND_PORT`, HTTP vhost port
  `FRP_VHOST_PORT` (routes on `Host: <subdomain>.<BASE_DOMAIN>`), and server plugin hooks
  (`Login`, `NewProxy`, `CloseProxy`, `Ping`) on `FRP_HOOKS_PORT`. If `frps` exits the process exits
  and Fly restarts the machine.

Admission: `Login` needs `metas.credential` and checks it for the frp `user` (the label) with the
account API; `NewProxy` accepts only `http` proxies on `<label>` or `<label>--<port>` without custom
domains; `Ping` (sent only when frpc enables `transport.heartbeatInterval`) closes a client whose
credential the account API now refuses. Server traffic goes to the `<label>` proxy with `target: null`
in the assertion; a share host `<label>--<port>` goes only to a `<label>--<port>` proxy (`target` =
the port), and is offline (503) when the client does not hold one. The labels this machine holds
live behind `TunnelDirectory` (`src/directory.ts`). A label is held (for presence, peer
announcements and the 15 s reconnect wait) while any of its proxies is open, so a machine label
with only share proxies counts too. When the label's frp connection is still open 500 ms after a
`CloseProxy` (a hot reload removed the proxy, not a dropped tunnel), that address stops waiting
and answers 503 at once instead of after the 15 s kept for a dropped tunnel.

Visitor rules follow `apps/connect/src/worker.ts`. Differences: a visitor without a session gets the
sign-in page only when it asks for HTML (`accept: text/html`); API callers get a plain `401`. The
gate refuses a foreign `Origin` on session requests that change state or open a WebSocket (`403`).
The frps `Login` hook rejects a missing, unknown, reserved or refused credential with the fixed
`FRP_LOGIN_REFUSED_REASON` ("bb connect refused this server credential"); an account API outage is
rejected with "the gate could not check this" so the plugin keeps retrying. The hooks first retry a
failing account API with backoff for up to 7 s (`HOOK_RESOLVE_DEADLINE_MS`, inside frpc's 10 s login
wait), so a short outage or a mass reconnect delays logins instead of refusing them.
Install paths (`GATE_PUBLIC_PATHS`) are forwarded with a `public` assertion (`sub: ""`) and no `x-bb-gate-auth`. An
assertion the server refuses (`401 {code:"gate_assertion_invalid"}`) is logged as
`assertion_refused` and answered with the gate's `502`. Deadlines: 30 s to the response head (90 s for
`POST /api/v1/system/voice-transcription`), including the wait of up to 15 s for a tunnel that dropped;
then `504`. Answers from the account API are cached (see Answer cache). Assets are cached in memory per label and encoding (immutable
`max-age ≥ 300`, shells revalidated with their `etag`; `CACHE_MAX_BYTES`, default 256 MiB), and
compressible bodies the origin left unencoded are sent as `br` or `gzip`: brotli quality 5 for
bodies the asset cache stores and for dynamic bodies under 16 KiB, quality 4 for larger or
unknown-length dynamic bodies (about half the CPU of quality 5 for 7% more bytes on JSON; quality 11
costs about 50 times as much and is never used); only bodies without a `content-length` are flushed
chunk by chunk. Logs are JSON lines on stdout without cookies, tokens, credentials or query strings.

Environment (`fly.toml` sets the non-secret ones):

| Variable                                            | Default                | Meaning                                                                                                            |
| --------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `BASE_DOMAIN`                                       | `next.getbb.app`       | Visitor hosts are `<label>[--<port>].<BASE_DOMAIN>`, the tunnel host `tunnel.<BASE_DOMAIN>`                        |
| `ACCOUNT_API_URL`                                   | required               | Origin of the account API, `https://connect.getbb.app` (staging `https://connect.vibecodethis.site`)               |
| `ACCOUNT_APP_URL`                                   | `https://getbb.app`    | Sign-in, reserved-handle redirects, OAuth authorization server, session refresh                                    |
| `PUBLIC_SCHEME`                                     | `https`                | `http` only for local runs; it also switches to the non-`__Secure-` cookie names                                   |
| `PORT`, `BIND_HOST`                                 | `8080`, `0.0.0.0`      | Gate listener                                                                                                      |
| `FRP_BIND_PORT`, `FRP_VHOST_PORT`, `FRP_HOOKS_PORT` | `7001`, `7080`, `7090` | Loopback ports of `frps` and its hooks                                                                             |
| `FRP_TCP_PORT`                                      | unset                  | Also accept frp's plain TCP transport on this port (for a Fly `tls` service on 7000, which needs a dedicated IPv4) |
| `FRPS`, `FRP_LOG_LEVEL`                             | `frps`, `info`         | `frps` binary and log level                                                                                        |
| `FLY_REGION`, `FLY_MACHINE_ID`                      | `local`                | Set by Fly; reported with presence and used as this machine's identity between peers                               |
| `FLY_APP_NAME`                                      | required with peers    | Set by Fly; peers are the `AAAA` records of `<FLY_APP_NAME>.internal`                                              |
| `INTERNAL_PORT`                                     | `7100`                 | Peer listener; reachable on the private network only, no `fly.toml` service exposes it                             |
| `INTERNAL_BIND_HOST`                                | `fly-local-6pn`        | Address of the peer listener (this machine's 6PN address)                                                          |
| `PEER_REFRESH_MS`                                   | `30000`                | How often peers are rediscovered over internal DNS                                                                 |
| `CACHE_MAX_BYTES`, `CACHE_MAX_ENTRY_BYTES`          | 256 MiB, 8 MiB         | Asset cache bounds                                                                                                 |
| `PRESENCE_REFRESH_MS`                               | `240000`               | Presence refresh interval while a label is held (each label at a jittered point in it)                             |
| `OPEN_FILES_LIMIT`                                  | `65536` (image)        | Open-file limit set before the gate starts                                                                         |
| `ASSETLINKS_SHA256_FINGERPRINTS`                    | empty                  | Android app links, as on the Cloudflare gate                                                                       |

Secrets (`fly secrets set` on `bb-connect-next`; the gate holds no D1 or better-auth secret):

- `GATE_SECRET`: equal to the `GATE_SECRET` Worker secret of `bb-connect`; sent as the account API
  bearer.
- `GATE_SIGNING_KEY`: the private Ed25519 JWK with its `kid`, as JSON (`generateGateKeyPair(kid)`'s
  `privateJwk`). Its public half must be in bb-web's `GATE_PUBLIC_KEYS` before the gate signs with it;
  to rotate, publish the new public key, wait out the servers' key cache, then set the new private key.
- `PEER_SECRET`: at least 32 random characters, the same on every machine; gate machines send it to
  each other as `Authorization: Bearer` (and `x-bb-gate-peer-auth` on forwarded requests) and sign
  replay state with it. Without it the gate runs alone: no peer listener, and a label is reachable only
  on the machine its frpc dialled. Rotating it briefly splits the machines into two groups until the
  rolling restart finishes.

DNS and certificates (Cloudflare DNS, records unproxied so Fly terminates TLS): `A`/`AAAA` for
`*.next` and `tunnel.next` pointing at the app's addresses (or `CNAME` to `bb-connect-next.fly.dev`),
Fly certificates for `*.next.getbb.app` and `tunnel.next.getbb.app`, and the `_acme-challenge.next`
`CNAME` Fly names for the wildcard. frpc dials `wss://tunnel.next.getbb.app:443/~!frp`
(`transport.protocol: "wss"`).

Deploy: run the `Deploy Connect Next` workflow by hand (`workflow_dispatch`); it typechecks, runs the
tests, and calls `flyctl deploy --config apps/connect-next/fly.toml --dockerfile apps/connect-next/Dockerfile
--ignorefile apps/connect-next/Dockerfile.dockerignore --remote-only --ha=false` from the repository root
with the repository secret `FLY_API_TOKEN`, a deploy token for this app only (`fly tokens create deploy
-a bb-connect-next`). It is also the first deploy: once the app, its secrets and certificates exist, the
workflow creates the first machine, and `--ha=false` keeps Fly from adding a standby. The image bundles the gate with esbuild and installs `frps` 0.71.0 checked
against its SHA-256. A deploy replaces machines one at a time (Fly's rolling strategy); clients on a
replaced machine redial on their own and may land in another region, which the others learn by
announcement.

Machine size: `fly.toml`'s `[[vm]]` is `performance-2x` with 4 GB, and `flyctl deploy` applies it to
every machine, so all regions run that size. The staging load test showed shared CPUs cannot carry
the gate: a `shared-cpu-2x` 1 GB machine sustained only about 30–40 req/s before Fly throttled its
CPU, while `performance-2x` 4 GB held 2,500 tunnels at about 280 req/s. A smaller size set with
`fly scale vm` (`performance-1x` would do for quiet regions such as `sin` and `syd`) lasts only until
the next deploy resets it. Staging (`bb-connect-next-staging`) overrides the size on its deploy
command with `--vm-size shared-cpu-2x --vm-memory 1024`.

Locally: `pnpm exec turbo run typecheck test --filter=@bb/connect-next`. The tests download frp
0.71.0 once into `~/.cache/bb-frp/0.71.0` (checked by SHA-256; skipped with a message when offline) and
drive real `frps` and `frpc` against a stand-in account API and bb server. To run the gate by hand:
`pnpm --filter @bb/connect-next build`, then `PUBLIC_SCHEME=http BASE_DOMAIN=next.localhost
ACCOUNT_API_URL=… GATE_SECRET=… GATE_SIGNING_KEY='{…}' FRPS=~/.cache/bb-frp/0.71.0/frps node
apps/connect-next/dist/gate.mjs`, and point frpc at `ws://tunnel.next.localhost:8080` with
`transport.protocol: "websocket"`.
A visitor `Host` may carry a port in such a local run (`<label>.next.localhost:8080`): the gate
routes on the host without it and keeps the port on the upstream `Host`, so the server ingress still
sees `Origin` equal to `http://<Host>`.

### Answer cache

`src/account-api.ts` caches each answer under a hash of the whole request (label, cookies,
credential, machine credential, OAuth token and resource), at most 20 000 entries.

- Fresh time: positive answers 60 s, negative ones 5 s, each shortened by a random 0–20 % so entries
  made together do not expire together.
- Stale while revalidate: a positive answer past its fresh time is still served, and the first visit
  after that starts one background refresh (later visits do not start another; a failed refresh is
  retried no sooner than 5 s later). A positive answer is never served more than 5 minutes after it
  was fetched (`maxStaleMs`); after that the visit waits for the account API.
- Outages: while the account API fails, admitted visitors keep getting the last good answer within
  those 5 minutes; a visitor with nothing cached waits at most 8 s (a third of the head deadline) for
  retries, then gets `502`.
- Refutations: when any answer says a label is unknown or revoked, a session or desktop session,
  machine credential or OAuth token is invalid, or a link credential does not match, every cached
  entry that relied on that label or value is dropped at once, so nothing learned to be negative is
  served stale.
- Batching: lookups wait up to 5 ms, background refreshes up to 500 ms, to be sent together to
  `/api/gate/resolve/batch` (at most 50 per call, visitor lookups before background refreshes, at
  most 16 calls in flight); a visitor lookup takes waiting refreshes along. Concurrent lookups of the
  same request share one entry. Transient failures (network, timeout, `408`, `429`, `5xx`, a `null`
  entry) are retried with exponential backoff (250 ms doubling to 2 s, ±50 %) until the caller's
  deadline.

Revocation bound: a revoked server or machine, an expired or signed-out session, a revoked OAuth
grant or a rotated link credential stops working at the gate within the fresh time of the answer it
holds (at most 60 s) plus one refresh, after the Worker sees it (its own per-isolate caches add up
to 15 s for labels, 20 s for sessions and 30 s for OAuth grants). While the account API is failing
the bound is 5 minutes. frp `Login`/`NewProxy` checks use the same cache.

### Presence, shutdown and limits

Presence (`src/presence.ts`): events are coalesced per label (the newest state wins) and flushed
every second in calls of up to 500 to `/api/gate/presence/batch`. A label's first refresh comes a
random 50–100 % of `PRESENCE_REFRESH_MS` (default 4 min) after it connected and every 90–100 % of it
after that, so refreshes for labels that connected together (a mass reconnect) spread over the
interval: at 2 500 labels about 10 per second, one call. A failed call is retried with backoff
(2 s doubling to 30 s), keeping the newest state of each label. With at most 4 minutes between
refreshes and the Worker writing at most every 5 minutes, `next_tunnel_at` is never more than about
8 minutes old while a label is held, inside the dashboard's 12.

Shutdown (`SIGTERM`/`SIGINT`, `src/main.ts` and `ConnectNext.stop`): the gate sends `disconnected`
for every held label in one batch (at most 3 s) and a `POST /__peer/goodbye` to each peer (falling
back to per-label announcements for a peer that answers `404`), and ends every frp WebSocket at once
with a WebSocket close frame (`1001`, sent on a frame boundary; `src/ws-frames.ts` follows frps's
frames) so `frpc` redials. Fly's proxy does not pass a closed instance connection on to the client,
so without the close frame `frpc` noticed only when the machine itself stopped, 5 to 10 s later. With peers it then drains for 3 s (`drainMs`): the
listener stays open, `/__gate/health` answers `503`, and every new request or upgrade on any host,
frp dials included, gets `409` with `fly-replay: elsewhere=true`, so Fly's proxy, which keeps routing
to a stopping machine for a few seconds, re-sends it to another machine instead of failing it.
Without peers it waits 250 ms for in-flight requests. Then it stops listening, drops every remaining
visitor connection and WebSocket, stops `frps` (`SIGKILL` after 500 ms) and exits; the process exits
after 8 s whatever happens, inside Fly's 10 s `kill_timeout`. On staging with 2 294 tunnels the
stop took 0.7 s before draining was added (`gate_stopped` logs `frpClients`, `drainMs` and `ms`).

Open files: the image starts as root, raises the open-file limit to `OPEN_FILES_LIMIT` (65 536) and
drops to the `node` user with `setpriv` before starting the gate, so `frps` and the gate each get
65 536 instead of Fly's 10 240 (about 3 300 tunnels). Check with `cat /proc/<pid>/limits` on a
machine.

### Local end-to-end run

`apps/connect-next/scripts/e2e-local.sh` runs the whole path on one machine, nothing remote, and
prints one `PASS`/`FAIL` line per check (exit status 1 on any failure; results also in
`<work dir>/results.json`, service logs in `<work dir>/logs/`). It needs frp 0.71.0 in
`~/.cache/bb-frp/0.71.0` (the gate's tests download it) and a built app
(`pnpm exec turbo run build --filter=@bb/app`). It clears inherited `BB_*`, `CLOUDFLARE_*` and
`FLY_*` variables, then:

1. Generates a gate key pair with `generateGateKeyPair` and a random `GATE_SECRET`, and starts
   `pnpm cloud:dev` (Connect worker and bb-web under Miniflare, migrations applied to a fresh local
   D1 in `<work dir>/cloud`) with `BB_CLOUD_DEV_GATE_SECRET`, `BB_CLOUD_DEV_GATE_PUBLIC_KEYS` and
   `BB_CLOUD_DEV_STATE_DIR`. Local Cloud uses this worktree's dev ports (`bb.localhost:<cloudPort>`).
2. Signs up two users through bb-web's local email/password auth, and seeds the owner's handle
   `cne2e`, its server row and a `server-pair` code in local D1.
3. Builds and starts the gate with real `frps` (`PUBLIC_SCHEME=http`, `BASE_DOMAIN=next.bb.localhost`,
   `ACCOUNT_API_URL` = the local worker), on a free port bound to `::`.
4. Starts a bb server from source in development mode on a data dir in the work dir, signs it in
   with `bb account login --code` (the real redeem), then restarts it in production mode so it serves
   `apps/app/dist`, with `BB_CONNECT_GATE_KEYS_URL` at local bb-web, `BB_CONNECT_NEXT_SERVER` at the
   gate and `BB_CONNECT_FRPC` at the cached frpc. It enables `bb--connect-next`, which turns
   the next address on (`bb connect-next on` is then a no-op the script still checks). No host daemon runs on the server machine, so host-backed API calls for it
   answer 502; before the production start it writes a host row and `host-id` into the data dir so
   the server has a server machine to share ports from. Other machines' daemons start later (see
   Machines below).
5. Checks through `http://cne2e.next.bb.localhost:<gate port>`: the owner gets the app shell, API
   answers and `/ws`; another user gets 403; no cookie gets the sign-in page (HTML) or 401 (API);
   visitor-sent `x-bb-gate-assertion` (even one genuinely signed) and `x-bb-gate-auth` change nothing;
   the ingress port without an assertion answers 401 and a valid assertion replayed on another path
   too; install files download without a cookie; D1 presence goes online, then offline after
   `bb connect-next off` (address 503) and again after `bb plugin disable bb--connect-next`. The
   status `url` is the address derived from the account (`http://cne2e.next.bb.localhost:<cloudPort>`).
   Shares: starts a Vite-like dev server on loopback (refuses any `Host` but `127.0.0.1:<port>`, and
   any WebSocket `Origin` but its loopback origin) and runs `bb connect expose <port>`, which must
   print both share URLs; `bb connect-next status` lists the share `active`; through
   `cne2e--<port>.next.bb.localhost` the owner loads the page (the dev server sees its own Host and
   the assertion header), a POST with the share's own Origin arrives with the loopback origin and a
   foreign Origin arrives unchanged, another user gets 403 and no cookie the sign-in page, the HMR
   WebSocket opens and echoes, and foreign-origin or other-user WebSockets get 403.
   `bb connect unexpose` makes the address 503 within 10 s while the main address keeps answering
   200 (polled every 200 ms), and exposing again brings it back.
   Machines (it builds `@bb/cli` first, which a source daemon injects): seeds a bb connect machine
   row and credential in local D1, takes a join code from `POST /api/v1/hosts/join-codes`, and
   starts a second host daemon from source (its own `BB_DATA_DIR`, local API port and
   `BB_CONNECT_MACHINE_CREDENTIAL`) with `BB_SERVER_URL` at the next address. It checks that the
   machine enrolls and connects through the gate, that the server recorded its `connect_machine_id`
   from the machine assertion, that a `codex` thread on it completes a turn (a real model call), and
   that its label request was relayed by the gate. It then exposes a Vite-like dev server with
   `bb connect expose <port> --host <machine>` and checks the listing's `nextUrl`, the machine and
   share in `bb connect-next status` (`--json` and text), the daemon's `frpc.json` (machine label,
   machine credential, one proxy per share), that the daemon log never holds the credential, the
   owner's 200 at `<machine-label>--<port>.next…` with Host `127.0.0.1:<port>` and the assertion,
   the Origin rewrite, another user's 403, the HMR WebSocket and a foreign-origin WebSocket's 403;
   that unexposing answers 503 within 10 s while the server address keeps answering 200 and stops
   the machine's frpc; that exposing again brings it back; and that `bb connect-next off` stops the
   next-joined machine's frpc once it has had no server session for 30 s, and `on` brings it back.
   Then it turns bb connect on against local Cloud and starts a third daemon through the bb connect
   address: its share answers on both addresses, the gate reports the machine label's presence in
   D1, `bb connect-next off` stops its frpc within seconds while its bb connect share stays up, and
   `on` starts it again. With `BB_E2E_OLD_DAEMON_REPO` (a checkout and install of a protocol-246
   commit, such as `9fad6b6255`) it also starts that old daemon through the bb connect address and
   checks that it opens a session, that its Cloudflare share answers, and that it reports no next
   tunnel; without it that check is listed as skipped.
6. Session refresh: signs the owner in again, moves that session's `expires_at` in D1 to two days
   ahead, and checks that an app-shell visit returns a renewed `better-auth.session_token` cookie with
   `Domain=.bb.localhost`, that D1 now holds a seven-day expiry, that the renewed cookie works, and that
   the gates called `get-session` exactly once (`session_refresh` events in their logs). Desktop
   session: mints a `bb-connect.desktop_session` cookie with a day left (signed with local Cloud's
   fixed `BETTER_AUTH_SECRET`, granted by the owner's session) and checks the API and the cached shell
   both renew it, and the renewed cookie works without renewing again.
7. MCP OAuth (needs Playwright): enables `bb--mcp`, follows the `401` on `/mcp` to the next address's
   protected-resource metadata and bb-web's authorization-server metadata, serves a client metadata
   document and redirect URI on loopback http (accepted because local Cloud's issuer is http), approves
   the consent page as the owner in headless Chromium with PKCE (S256) and exchanges the code; then
   `initialize` and `tools/list` through the gate reach the server's MCP plugin. A token authorized for
   the bb connect address (`http://cne2e.bb.localhost:<cloudPort>/mcp`) is refused with
   `invalid_token`, `/api/v1/plugins/bb--mcp/http/mcp` (also percent-encoded) answers 404, and after
   revoking the grant at `/oauth/revoke` the token is refused within 95 s.
   With `BB_E2E_PLAYWRIGHT_DIR` pointing at a directory where `playwright` is installed it also loads
   the app in headless Chromium and saves screenshots (also of both consent pages); without it the
   browser and MCP OAuth checks are listed as skipped.

`--two-gates` starts two gates with `PEER_SECRET` (peers injected by
`apps/connect-next/scripts/e2e-peer-gate.ts` instead of Fly DNS) and puts the Fly replay stand-in from
`test/fly.ts` in front, landing every visitor on the gate that does not hold the tunnel: requests are
replayed to the holder, and a body over 1 MiB crosses the peer listener; the server's ingress checks
the assertion either way. Environment: `BB_E2E_DIR` (default `/tmp/bb-connect-next-e2e`, wiped at
start), `BB_E2E_SCREENSHOT_DIR`, `BB_E2E_PLAYWRIGHT_DIR`, `BB_FRP_CACHE_DIR`,
`BB_E2E_OLD_DAEMON_REPO`.

## Regions

The gate runs in several Fly regions with one or two machines each. Fly's anycast lands each frpc on
the nearest region's machine and each visitor on the machine nearest to them, so a visitor's machine
often does not hold the label's tunnel. Routing lives in `src/regions.ts` (the regional
`TunnelDirectory`, wrapping the local one) and `src/peer-server.ts` (the peer listener); the gate asks
the directory and acts on `{ kind: "here" | "elsewhere"; instance | "offline" }`.

Peers. Every machine with `PEER_SECRET` set opens a second listener on `INTERNAL_PORT` (7100), bound
to `fly-local-6pn` so it answers only on Fly's private IPv6 network. `fly.toml` declares no service
for it. Machines find each other from the `AAAA` records of `<FLY_APP_NAME>.internal`, refreshed every
30 s, and greet each new address with `POST /__peer/hello` (machine id, region, start time). The
answer is that peer's snapshot of the labels it holds, so a machine that starts fills its map before
it serves. A greeting also drops whatever the receiver believed the greeter held before it started.
An address that leaves DNS takes its labels with it. Every peer route requires
`Authorization: Bearer <PEER_SECRET>`, compared in constant time; anything else gets `401`.

Announcements. When a label's first proxy opens or its last one closes on a machine, it posts
`{label, machineId, region, state, at}` to `POST /__peer/announce` on every peer (fire and forget,
2 s timeout). A machine that stops posts `{machineId, at}` once to `POST /__peer/goodbye`, and each
peer forgets every label it believed that machine held since before `at`. Each machine keeps label → `{machineId, region, at}`; the newest `at` wins (machine id
breaks a tie), and a `disconnected` only clears the entry it names. Share subdomains follow their
label: they live on the same frpc.

Lookup on a miss. A label nobody announced is asked of every peer in parallel
(`GET /__peer/labels/<label>`, 1.5 s timeout: a first request over the private network from syd or sin to
ams or fra takes about 600 ms); a peer answers only for tunnels it holds itself. A
positive answer stays until an announcement changes it, a negative one for 2 s. A visitor whose label
is offline everywhere still gets the 15 s wait for a tunnel that dropped on this machine, and that
wait ends early when another machine announces the label.

Replay. For a label held elsewhere the gate answers `409` with
`fly-replay: instance=<machineId>;state=<expiry>.<hmac>`; Fly's proxy re-sends the request (WebSocket
upgrades included) to that machine, which receives `fly-replay-src: …;state=…`. The state is an HMAC
over label, target machine and expiry (60 s) with `PEER_SECRET`, so only the gate can mark a request
as replayed. Visitor checks run before routing, so a visitor without access is answered where they
landed. The gate never replays a replayed request: when the target no longer holds the label it tells
its peers it does not (a `disconnected` announcement in its own name), looks the label up afresh once,
and either forwards over the private network to the machine that answers, or waits out the grace and
answers `503` offline.

Private network forwarding. Fly cannot replay large bodies, so a request with `transfer-encoding`
or a `content-length` above 1 MiB is not replayed: the visitor's machine sends the already-checked,
already-signed upstream request to the holder's peer listener with `x-bb-gate-peer-auth: Bearer
<PEER_SECRET>`, streaming both ways. The holder checks the secret, checks that it holds the subdomain
(else `503` with `x-bb-gate-peer-miss`, shown to the visitor as offline), drops the header and
forwards to its `frps` exactly as for a local visitor. The bb server still checks the gate assertion,
so the peer secret alone reaches nothing.

Duplicate tunnels. If the same label connects on a second machine (the server restarted and anycast
picked another region while the old connection is still half-open), the newest announcement wins. The
older machine, on hearing it, stops routing to its own proxy and closes that frpc's connection: the
gate tags each frpc connection it pipes to `frps` (the WebSocket `Origin` it passes on, or the loopback
port for the TCP transport), learns the label from the `Login` hook's `client_address`, and destroys
the matching sockets. If two live frpc processes use one label they take turns winning; that is a
misconfiguration and shows as `tunnel_superseded` in the logs.

Presence. Each machine still reports its own labels to the account API. A machine whose tunnel was
superseded does not report `disconnected` for it, so it does not overwrite the newer machine's
`connected`.

Machine plan: 7 regions, `sjc ord iad ams fra sin syd`, one `performance-2x` 4 GB machine each to
start (the `fly.toml` size, see Machine size) and two where traffic needs it. Machines are independent; nothing is shared but the peer secret. `fly.toml` keeps
`primary_region = "sjc"`; `min_machines_running` applies to the primary region, and
`auto_stop_machines = "off"` keeps the rest running, which they must, since an idle machine still
holds tunnels.

Operator steps (from the repository root, `--config apps/connect-next/fly.toml` on every command or
`-a bb-connect-next`):

1. `fly secrets set PEER_SECRET="$(openssl rand -hex 32)" --stage -a bb-connect-next`, then deploy
   (the `Deploy Connect Next` workflow). The single machine now runs the peer listener with no peers.
2. Spread to one machine per region: `fly scale count 7 --region sjc,ord,iad,ams,fra,sin,syd
--max-per-region 1 -a bb-connect-next`. With several regions the count is the total across them,
   balanced; new machines are clones of an existing one (image, env, secrets). If the first deploy
   left two machines in `sjc`, they stay; `fly scale count 1 --region sjc` trims it.
3. Where a region needs a second machine: `fly scale count 2 --region <region> -a bb-connect-next`
   (one region per command sets that region's count). `fly scale show` and `fly machines list` show
   the result.
4. Check a few machines' logs for `gate_started` with `peers` equal to the number of other machines,
   and `peer_hello_failed` absent.

`flyctl deploy` replaces existing machines in place (it does not create more), so later deploys keep
this layout. If the app is ever recreated, run the workflow (it passes `--ha=false`) and scale per
region as above.

Failure modes:

- A peer is down or slow: lookups wait at most 1.5 s for it, announcements to it are dropped, and it
  leaves the map when it leaves DNS. Labels it held go offline until their frpc redials elsewhere.
- An announcement is lost: the next visitor for that label looks it up; a stale positive entry is
  corrected the first time a replay reaches a machine that no longer holds the label.
- Internal DNS fails: the last peer list stays in use and the failure is logged
  (`peer_discovery_failed`).
- Different `PEER_SECRET`s: peers refuse each other (`peer_refused`, `401`), replays carry state the
  target cannot verify, and labels are reachable only on their own machine until the secrets match.
- A replay target that cannot be reached: Fly answers the visitor with its own error; the gate
  cannot see that.
