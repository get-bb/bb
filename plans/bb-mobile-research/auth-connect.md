## Topology (who answers what)

- `https://getbb.app` (apex) = `apps/web` (TanStack Start on CF Workers, better-auth + D1). Routes: `/api/auth/*` (better-auth: GitHub OAuth start/callback/session/sign-out; email+password only when `DEV_EMAIL_PASSWORD_AUTH=true` on `*.localhost`) — `apps/web/src/routes/api.auth.$.tsx:6-9`, `apps/web/src/server/auth.ts:17-56`, `apps/web/src/server/local-auth.ts:4-28`. Unauthenticated code-redeem endpoints: `POST /api/connect/redeem {code}` → server tunnel credential (`api.connect.redeem.tsx:5-19`, `server/api.ts:756-819`, token prefix `bbcred_`), `POST /api/connect/redeem-machine {code}` → `{credential (bbcm_…), machineId, handle, serverUrl}` (`api.connect.redeem-machine.tsx:5-27`, `server/api.ts:825-908`). Server-credential-authenticated: `POST /api/connect/machine-code` (header `x-bb-connect-machine: <server tunnel credential>`) mints a 10-min `machine-pair` code (`api.connect.machine-code.tsx:9-28`, `api.ts:608-636`; TTL `packages/connect-db/src/constants.ts:128`, cap 20 machines/servers `constants.ts:125`); `POST /api/connect/revoke-machine`. Dashboard mutations are `createServerFn`s gated by `getSessionUserId()` (`server/fns.ts:27-119`, `server/current-user.server.ts:9-14`).
- `https://<label>.getbb.app` (wildcard) = `apps/connect` gate worker + per-label `TunnelDO` (`apps/connect/wrangler.jsonc:44`, `src/worker.ts:270-490`). Cookies are scoped `.getbb.app` so the gate verifies the same better-auth cookie (`auth.ts:53-55`; `wrangler.jsonc` comment: BETTER_AUTH_SECRET shared).
- bb server (`apps/server`) binds `127.0.0.1:38886` by default; only `127.0.0.1|0.0.0.0` accepted (`packages/config/src/env-vars.ts:105,363`; `apps/server/src/start-server.ts:42,212-216` logs "The public API is unauthenticated…"). Connect plugin (`plugins/connect`) holds the outbound tunnel: dials `wss://<handle>.getbb.app/__tunnel?v=1` with `Authorization: Bearer <bbcred_…>` (`plugins/connect/src/tunnel.ts:436-448,536-537`) and proxies relayed streams to the server loopback (`tunnel.ts:405-416`).

## (1) Request flow for a browser at https://<name>.getbb.app

`worker.ts:276-490` in order: account APIs intercepted first (`/api/connect/servers|disconnect|desktop-session|machine-label`, lines 281-292; auth = `x-bb-connect-machine` machine OR server credential, else better-auth cookie — `servers.ts:189-209`). Then `parseVisitorHost` → label/target(port) → `resolveLabel` from D1 (`session.ts:85-166`, 15s isolate cache). `/__tunnel` = tunnel client auth by SHA-256(credential) vs `credentialHash` (`worker.ts:332-362`). `/__*` reserved (365). Public unauthenticated GETs: `/install.sh`, `/install/version`, `/install/bb-app.tgz` (376-389). Machine paths = `/internal*`, `/api/v1`, `/api/v1/*`: if `x-bb-connect-machine` present → verified against `machine.credentialHash` (not cached; `session.ts:252-264`), must belong to label's `userId`, host-management mutations refused (`worker.ts:243-260,393-425`), forwarded with `x-bb-gate-auth: machine` + `x-bb-gate-machine-id`; `/internal*` without it → 403 (426-428). Everything else (SPA assets, `/api/v1/*` without machine header, `/ws`, `/ws/terminals/*`) is a visitor request: requires cookie `__Secure-better-auth.session_token` (verified: HMAC-SHA256 `token.sig` + D1 `session` row unexpired, `session.ts:174-223`) OR `__Secure-bb-connect.desktop_session` (HMAC-signed `{userId,expiresAt}` payload, no DB, `servers.ts:62-107`), cookie names in `cloud-dev.ts:2-5`. No cookie → 401 HTML sign-in page linking `https://getbb.app/dashboard?returnTo=<url>` (`worker.ts:55-59,157-167,440-450`) regardless of Accept. Wrong account → 403 `not your server` (451-456). Authorized → `x-bb-gate-auth: session` set (`requestForTunnelDo`, 223-241; visitor-supplied gate headers are stripped), WS upgrades go straight to DO (461-463), GETs use edge cache keyed by label (`cache.ts`), tunnel-down → 503 (`tunnel-do.ts:216-227`; HTML offline page only when Accept includes text/html, `worker.ts:476-487`).
So a non-browser client must present a `Cookie:` header (either cookie) for `/ws` and everything except the machine paths; there is no Authorization/bearer path for visitors. The tunnel client rewrites `Origin` only when it equals the public origin (`packages/tunnel-client/src/headers.ts:16-31`), drops `Host`; the bb server then applies `browserRequestProblem` which only rejects if an `Origin` header is present and untrusted (`apps/server/src/browser-request-guard.ts:169-176`; trusted = configured local origins, request-URL/Host/X-Forwarded-Host origin, or same hostname on a known port, 105-136). No Origin → passes; server has no user auth on `/api/v1` (`server.ts:439-463`) — daemon `/internal/*` uses `Authorization: Bearer <hostKey>` (`server.ts:388-409`).

## (2) Existing token/credential paths a native app can use

- Machine credential (`bbcm_…`): a durable, individually revocable per-device identity (`connect-db/src/schema.ts:207-222`; dashboard "Machines" list revoke `apps/web/src/routes/dashboard.tsx:1216-1308`, `api.ts:269-320`). Desktop obtains it exactly this way: `POST http://127.0.0.1:38886/api/v1/plugins/connect/rpc/createMachineCode` (body `null`, `content-type: application/json`; local server forwards to apex with its pairing secret, `plugins/connect/src/machine-code.ts:26-50`, `rpc.ts:131,205-214`) → `POST https://getbb.app/api/connect/redeem-machine {code}` (`packages/connect-client/src/redeem-machine.ts:79-142`) → `{serverUrl, handle, credential}` (`credential.ts:8-14`); flow in `apps/desktop/src/connect-machine-enrollment.ts:73-142`, stored via Electron `safeStorage` (`connect-credential-cache.ts:52-116`), triggered from `apps/desktop/src/main.ts:1110-1143`. Machine credential is only accepted on `/api/v1/*` + `/internal/*` at the gate; NOT on `/ws`, so it alone cannot drive realtime.
- Desktop session cookie: `POST https://<handle>.getbb.app/api/connect/desktop-session` with `x-bb-connect-machine: <bbcm_ or bbcred_>` → `{cookie:{name,value,domain:".getbb.app",expiresAt}}`, TTL 1h (`servers.ts:18,332-379`; client `connect-client/src/desktop-session.ts:22-58`). Desktop installs it into Electron's cookie jar for the remote origin (`connect-desktop-session.ts:174-224`, httpOnly, sameSite lax) and renews 5 min before expiry / on activate (`connect-session-renewal.ts:1-3,54-70`; `main.ts:1034-1098,2153`). This cookie yields `x-bb-gate-auth: session` (full owner), and works for `/ws`. Same-account server list: `GET https://<handle>.getbb.app/api/connect/servers` with the machine header (`connect-client/src/list-servers.ts:47-95`, `servers.ts:229-295`) → desktop Server menu (`main.ts:1191-1225`, `server-target.ts:9-18`).
- Server pairing credential (`bbcred_`) lives in the connect plugin kv (`plugins/connect/src/credential.ts:9-34`); it can also mint desktop-session cookies (`servers.ts:199-204`) but is the server's secret — the desktop deliberately never copies it (docs/multiple-devices.md:85-90).
- No API keys / PATs (`CLOUD_PAT_PREFIX` defined `constants.ts:134` but unused), no better-auth bearer/expo plugins (`auth.ts` only GitHub social + optional email/password), no device-code flow (`connect_code.purpose` `manual-pair` defined `schema.ts:240-244` but never minted).
- Remote daemons: installer stores `machineCredential`+`connectMachineId` in `~/.bb/config.json` (`apps/server/src/assets/install-machine.sh:466-503`; docs/configuration.md:30-37); daemon runs a loopback machine-auth proxy stamping `x-bb-connect-machine` for its child `bb` CLI (`apps/host-daemon/src/machine-auth-proxy.ts:11,237-268`, `start-host-daemon.ts:212-217,242-247`).

## (3) Loopback/LAN/Tailscale

Public API + `/ws` are unauthenticated; the only defenses are the bind host and Origin checks (`docs/configuration.md:849-855`, `docs/multiple-devices.md:38-41`). With `--server-bind-host 0.0.0.0` a phone on the LAN can use `http://<lan-ip>:38886` with plain fetch/WebSocket; CORS (`server.ts:307-319`, allowlist `packages/config/src/local-app-origins.ts:38-62`) and `browserRequestProblem` only bite when an Origin header is sent (RN iOS WebSocket may send `Origin` = ws URL origin — equal to request origin → allowed by `browser-request-guard.ts:127-129`). Tailscale Serve: `tailscale serve --https=443 http://127.0.0.1:38886` + `BB_APP_URL` (`docs/multiple-devices.md:19-29`); the server trusts `x-forwarded-host/proto` targets (`browser-request-guard.ts:83-102`) and reports `serverUrl` from `appUrl`/forwarded host (`apps/server/src/routes/system.ts:84-109`). Plugin RPC routes (`/api/v1/plugins/:id/rpc/:method`) enforce "local" auth = Origin check + JSON content-type for mutations (`apps/server/src/routes/plugins.ts:126-133,608-616`) — a native client with no Origin and JSON body passes, so a phone on LAN/Tailscale can call `createMachineCode` and self-enroll a machine credential for later roaming via connect.

## (4) OAuth flows / WebView handoff

Sign-in is GitHub OAuth via `POST /api/auth/sign-in/social {provider:"github", callbackURL}` → redirect (`dashboard.tsx:302-312`); `callbackURL`/returnTo validated to be `https://<label>.<basedomain>` (`apps/web/src/lib/connect-return-to.ts:9-35`); after auth the dashboard `window.location.assign(returnTo)` (`dashboard.tsx:359-363`). No device-code, no bearer. Feasible native path: open `https://getbb.app/dashboard?returnTo=https://<handle>.getbb.app/` in an in-app WebView, on navigation to `<handle>.getbb.app` read the `.getbb.app` cookies (httpOnly → need native cookie manager, not JS), then attach `Cookie:` to fetch/WS; or bootstrap once via the desktop model (session cookie → gate → `createMachineCode` RPC → redeem → durable `bbcm_` → mint 1h desktop-session cookies thereafter, revocable from dashboard).

## (5) PWA client storage

The PWA stores no server URL: API base = `window.location.origin` (`apps/app/src/lib/api-server.ts:4-8`, `lib/sdk.ts:5-10`), realtime = same host `/ws` (`lib/ws.ts:56-60`, dev override `lib/dev-websocket-url.ts`), adds `x-bb-app-surface` header (`lib/app-surface.ts:15-29`). Connect state comes from the plugin `status` RPC + realtime (`plugins/connect/app.tsx:3,11,407`, contract `plugins/connect/src/rpc.ts:109-136`, `ConnectStatus` fields 45-59). Persistent prefs are jotai `atomWithStorage` on localStorage (`lib/browser-storage.ts`). Desktop persists target in `server-target.json` (`apps/desktop/src/server-target.ts:5-18,61-77`).

## Key files
- apps/connect/src/worker.ts
- apps/connect/src/session.ts
- apps/connect/src/servers.ts
- apps/connect/src/cloud-dev.ts
- apps/connect/src/protocol-headers.ts
- apps/connect/src/tunnel-do.ts
- apps/connect/wrangler.jsonc
- apps/web/src/server/auth.ts
- apps/web/src/server/api.ts
- apps/web/src/server/fns.ts
- apps/web/src/routes/dashboard.tsx
- apps/web/src/routes/api.connect.redeem-machine.tsx
- apps/web/src/routes/api.connect.machine-code.tsx
- apps/web/src/lib/connect-return-to.ts
- packages/connect-db/src/schema.ts
- packages/connect-db/src/constants.ts
- packages/connect-client/src/credential.ts
- packages/connect-client/src/desktop-session.ts
- packages/connect-client/src/list-servers.ts
- packages/connect-client/src/redeem-machine.ts
- plugins/connect/src/tunnel.ts
- plugins/connect/src/rpc.ts
- plugins/connect/src/machine-code.ts
- plugins/connect/src/credential.ts
- packages/tunnel-client/src/headers.ts
- packages/tunnel-client/src/session.ts
- apps/desktop/src/connect-machine-enrollment.ts
- apps/desktop/src/connect-desktop-session.ts
- apps/desktop/src/connect-session-renewal.ts
- apps/desktop/src/connect-credential-cache.ts
- apps/desktop/src/server-target.ts
- apps/desktop/src/main.ts
- apps/server/src/server.ts
- apps/server/src/browser-request-guard.ts
- apps/server/src/request-context.ts
- apps/server/src/routes/plugins.ts
- apps/server/src/routes/hosts.ts
- apps/server/src/routes/system.ts
- apps/server/src/start-server.ts
- apps/server/src/assets/install-machine.sh
- apps/host-daemon/src/machine-auth-proxy.ts
- packages/config/src/local-app-origins.ts
- packages/config/src/env-vars.ts
- packages/sdk/src/browser.ts
- packages/sdk/src/transport-http.ts
- packages/sdk/src/realtime-url.ts
- packages/sdk/src/realtime-client.ts
- apps/app/src/lib/api-server.ts
- apps/app/src/lib/sdk.ts
- apps/app/src/lib/ws.ts
- apps/app/src/lib/app-surface.ts
- docs/multiple-devices.md
- docs/configuration.md

## Reuse verdicts
- packages/connect-client (@bb/connect-client): **reusable-as-is** — Only imports zod and uses global fetch + WHATWG URL (`credential.ts:22-38`, `redeem-machine.ts:53-69`). Needs a full URL implementation (`.origin/.host/.hostname/.port`), so install react-native-url-polyfill; otherwise no DOM/node deps.
- packages/tunnel-contract (@bb/tunnel-contract): **reusable-as-is** — Pure frame codec (TextEncoder/DataView). Not needed by a client app; only the tunnel client/DO use it.
- packages/tunnel-client (@bb/tunnel-client): **not-reusable** — Imports node:http, node:https and `ws` (`session.ts:3-9`). Also not needed: a phone is a visitor, not a tunnel host. `headers.ts` alone is pure.
- apps/connect (gate worker) and apps/web (getbb.app): **not-reusable** — Cloudflare Workers/D1 server code. Only contracts matter to a client: header names (`protocol-headers.ts`), cookie names (`cloud-dev.ts:2-5`), endpoints. `apps/web/src/lib/connect-return-to.ts` is pure and could be copied.
- apps/desktop connect logic (connect-machine-enrollment.ts, connect-desktop-session.ts, connect-session-renewal.ts): **headless-logic-only** — Lives inside apps/desktop (not a package). enrollment + createCredentialCookieSource are pure fetch/zod; `installConnectDesktopSession` needs a `DesktopCookieStore` impl (RN: @react-native-cookies/cookies); `connect-session-renewal.ts` default timer calls `.unref()` (`:63-66`) — pass `setTimeoutFn`. `connect-credential-cache.ts` uses node:fs + Electron safeStorage → replace with expo-secure-store.
- packages/sdk (@bb/sdk/browser): **reusable-with-small-changes** — browser entry uses fetch + hono/client + zod + global WebSocket (`browser.ts`, `transport-http.ts`, `realtime-client.ts:163-166`); no node: imports on that path. Must pass absolute `baseUrl`, a `fetch` wrapper that adds Cookie/app-surface headers, and a `websocket` factory that attaches the Cookie header (RN WebSocket 3rd-arg headers). Verify Blob/File upload path (`areas/projects.ts:294`) and that `@bb/templates/generated` bundles fine in Metro.
- apps/app/src/lib/ws.ts (WebSocketManager, partysocket): **headless-logic-only** — URL derived from window.location (`ws.ts:56-60`); partysocket itself is RN-compatible. Needs URL + cookie-header injection.
- apps/app/src/lib/api-server.ts / sdk.ts / app-surface.ts: **headless-logic-only** — BASE_URL from window.location.origin (`api-server.ts:4-5`, `sdk.ts:5-6`); `getAppSurface` checks window.bbDesktop (`app-surface.ts:9-14`). Would need a stored server URL and a new AppSurface value (`packages/config/src/app-surface.ts` only defines desktop|web).
- apps/server browser-request-guard / CORS: **not-reusable** — Server-side, but relevant: native clients that send no Origin pass; on iOS RN WebSocket may send Origin equal to the ws URL origin, which is accepted because it matches the request origin (`browser-request-guard.ts:127-129`).

## Risks
- The gate accepts machine credentials only on /api/v1/* and /internal/* (worker.ts:393-425); /ws and /ws/terminals/* require a session cookie, so a native app must run the desktop-session-cookie exchange (1h TTL, servers.ts:18) and renew it, or realtime breaks silently with a 401 HTML body.
- Better-auth session cookie is httpOnly (better-auth default; not overridden in apps/web/src/server/auth.ts) — WebView JS cannot read it; must use a native cookie manager (WKHTTPCookieStore / android CookieManager). iOS WKWebView vs NSHTTPCookieStorage sync semantics for `.getbb.app` cookies need verification.
- React Native fetch/WebSocket cookie behaviour: manual `Cookie:` headers can be overridden by the native cookie jar on iOS; safest is to install the cookie into the native jar for domain `.getbb.app` (as Electron does, connect-desktop-session.ts:174-192).
- Machine-credential-authenticated calls carry `x-bb-gate-auth: machine` and are refused for host management (worker.ts:243-260, apps/server/src/routes/hosts.ts:59-67); a native app relying on the machine header alone is a lower-privilege client.
- Every enrollment consumes one of 20 account machine slots (connect-db constants.ts:125; api.ts:570-579, 856-866); the desktop refuses to enroll without persistent secure storage to avoid burning a slot per launch (main.ts:1121-1127) — mobile must persist the credential (expo-secure-store) for the same reason.
- LAN/Tailscale direct access is fully unauthenticated (start-server.ts:212-216); a phone app that stores `http://<ip>:38886` has no user identity and anyone on that network has the same access. Default bind is loopback so LAN needs `--server-bind-host 0.0.0.0` (env-vars.ts:105,363).
- Gate 401 returns an HTML sign-in page for all clients (worker.ts:440-450, no Accept check); the app's error parser maps HTML 401/403 to 'Authentication failed' (apps/app/src/lib/api.ts:75-77) — native client must detect this to trigger re-auth.
- Cloudflare edge cache keyed by label (cache.ts:17-22) serves cached immutable assets — fine for a native app but means asset URLs are shared across the owner's clients.
- RN's built-in URL is incomplete; connect-client and sdk realtime-url rely on `.origin/.host/.hostname` — needs react-native-url-polyfill or requests will target wrong hosts.
- Tunnel WS visitor upgrade echoes only the first offered subprotocol (tunnel-do.ts:341-347); keep to one subprotocol on the native realtime socket.

## Open questions
- Should the native app enroll as a connect *machine* (own revocable bbcm_ credential, desktop model) or hold the better-auth session cookie directly (7-day default lifetime, not renewable without a browser)? The former needs a bootstrap that can reach `createMachineCode` (owner session through the gate, or LAN/loopback), the latter needs a native cookie manager to read httpOnly cookies from a WebView.
- Would a bearer/token path be added at the gate (e.g. accept `Authorization: Bearer <desktop-session>` or a machine credential on /ws) to avoid cookie-jar juggling in RN? Today no such path exists (worker.ts:433-456).
- Is a new `AppSurface` value (e.g. `mobile`) desired for telemetry/policy? `packages/config/src/app-surface.ts` only knows desktop|web and the server parses the header (request-context.ts:56-64).
- For direct LAN/Tailscale mode, is any authentication acceptable/desired on the bb server, or does the app rely on the user's network boundary as docs prescribe (docs/multiple-devices.md:38-41)?
- Does the connect gate need to serve `/api/connect/desktop-session` on the apex too, or is calling it on `<handle>.getbb.app` (as connect-client does, desktop-session.ts:24) fine for mobile? Note redeem endpoints live only on the apex (bb-web) while desktop-session/servers live only on the gate wildcard.
- Confirm RN iOS WebSocket Origin header behavior against browser-request-guard.ts (I stated it based on RN knowledge, not repo evidence).