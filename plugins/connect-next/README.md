# connect-next (`bb--connect-next`)

Opt-in second way in to a bb server: `https://<label>.next.getbb.app`, served by
the Fly gate (`apps/connect-next`) through frp. The domain follows the bb
account: `next.<host of the account's base URL>`, so a staging account
(`https://vibecodethis.site`) gets `https://<label>.next.vibecodethis.site` and
local Cloud (`http://bb.localhost:<port>`) `http://<label>.next.bb.localhost:<port>`. The design is in
[`docs/connect-next.md`](../../docs/connect-next.md).

## Pieces

- `src/account.ts` follows bb account (`bb-account.v1.status`,
  `bb-account.v1.waitForStatusChange`) for the server id, label and base URL, and reads
  the server credential with `bb-account.v1.connectCredential` before each
  `frpc` start. bb account serves that method to `connect` and `bb--connect-next`
  only.
- [`@bb/frp-client`](../../packages/frp-client/README.md) downloads, verifies
  and supervises `frpc`. The plugin installs it in
  `<dataDir>/plugins/bb--connect-next/frp/<version>/` and keeps `frp/frpc.json`
  (mode 0600, it holds the credential) and, for `wss`, `frp/roots.pem` there.
  `BB_CONNECT_FRPC` names a binary to use instead.
- `src/next-site.ts` derives the next domain, the address and the default
  tunnel server (`wss://tunnel.<next domain>:443`) from the account's base URL.
- `src/tunnel.ts` opens the tunnel ingress with `gateAudienceForServer(serverId)`
  and runs an `FrpcSupervisor` with the main proxy (`bb`, `subdomain = <label>`)
  pointing at it. The supervisor restarts `frpc` with backoff, parses its log
  into `connecting`, `connected`, `refused`, or `offline`, waits five minutes
  after a refusal before trying again, and the tunnel closes `frpc` and the
  ingress on off, sign-out, and stop. Log lines are redacted of the credential.
- `src/ingress.ts` is the only place that touches the server's ingress API,
  `bb.server.internal_DO_NOT_USE_openTunnelIngress({ audience })`. It is looked up at
  run time; a server without it reports the `error` state with a message
  saying so.

## Environment

| Variable                 | Effect                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `BB_CONNECT_FRPC`        | Path of an `frpc` binary to run instead of the downloaded one.                                           |
| `BB_CONNECT_NEXT_SERVER` | `ws://host:port` or `wss://host:port` of the frp server instead of `wss://tunnel.<next domain>` (tests). |

## Tests

`pnpm exec turbo run test --filter=bb-plugin-bb--connect-next` runs real `frpc`
and `frps` 0.71.0 (fixtures from `@bb/frp-client/testing`). The release archives are cached in
`~/.cache/bb-frp/0.71.0` (`BB_FRP_CACHE_DIR` overrides it) and verified
against the pinned checksums; a missing archive is downloaded once. The wss
test needs `openssl` and is skipped without it.

## Shares

`src/shares.ts` long-polls the connect plugin for the ports shared from the
server's machine: `connect.internal_DO_NOT_USE.serverShares` and
`connect.internal_DO_NOT_USE.waitForServerSharesChange({ afterRevision })` (25 s), both
`{ revision, ports }` and answered to `bb--connect-next` only. A stopped
connect plugin (HTTP 404/503) counts as no shares. Each port becomes an frpc
proxy `share-<port>`: `type = http`, `subdomain = <label>--<port>`,
`localIP = 127.0.0.1`, `localPort = <port>`, `hostHeaderRewrite =
127.0.0.1:<port>` (dev servers such as Vite refuse other hosts). It goes
straight to the port, not through the ingress, as on the Cloudflare tunnel:
the gate's assertion reaches the dev server and is ignored. Changes are
applied by hot reload, so the main proxy and its connections stay up. The
status lists each share with its URL and proxy state (`pending`, `active`,
`refused` with the gate's reason); a refused share does not stop the tunnel.

## Machines

While the plugin's tunnel is wanted (on, signed in, service running),
`src/tunnel.ts` calls `bb.hosts.internal_DO_NOT_USE_setNextTunnels({ domain, server })`
with the same next domain and tunnel server it dials itself
(`BB_CONNECT_NEXT_SERVER` included), and `null` otherwise. The server sends it
to every enrolled machine's daemon; each runs its own `frpc` for the ports
shared from it (see Machine tunnels in
[`docs/connect-next.md`](../../docs/connect-next.md)). The plugin reads the
daemons' reports with `bb.hosts.internal_DO_NOT_USE_nextTunnelStatuses()`, republishes
its status on `bb.hosts.internal_DO_NOT_USE_onNextTunnelStatusChange`, and lists every
machine that is not idle, shares a port or reports an error under `machines`
in `status`, the CLI and the settings section.
