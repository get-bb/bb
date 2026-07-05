# bb connect v1 — Implementation Plan

Ship "bb connect": log into getbb.app, connect your bb server and your other
machines through an outbound tunnel, and reach your bb from any browser at
`<handle>.getbb.app`. No Tailscale, no port forwarding, no changes to the core
bb server.

Architecture background (why these shapes were chosen, alternatives weighed):
[plans/bb-connect-architecture.html](bb-connect-architecture.html). The
multi-tenant alternative in `plans/hosted-bb-architecture.html` was considered
and rejected; delete it when this plan starts landing.

## Locked decisions

| Decision | Choice |
| --- | --- |
| Feature name | **bb connect**, consistently — folders, packages, UI copy, docs. |
| Cloud data plane | Our own tunnel protocol on Cloudflare Workers + Durable Objects (WS hibernation). No cloudflared, no ngrok, no VM fleet. |
| Auth | All identity in bb connect cloud. better-auth + GitHub OAuth. Core bb **server** gains zero auth code — the tunnel client injects at loopback, which bb already trusts. |
| Tunnel client home | **Host daemon** (`apps/host-daemon`) — it is a host-local primitive, the daemon's local API (`:38887`) is what `apps/app` already calls for machine-local actions, and the daemon owns the `auth.json` credential pattern. The invariant is therefore: `apps/server` untouched (hard rule); `apps/host-daemon` gains the tunnel client + local-API endpoints. |
| Primary UX | **Button in the bb UI**, browser-callback flow (below). The `bb connect` CLI command ships too, as a thin wrapper over the same daemon API — needed for headless primary machines and agents. |
| DB | Cloudflare D1 + drizzle (SQLite dialect — same idioms as `packages/db`). Not PlanetScale: second vendor + cross-network hop for a handful of small tables. |
| Signup | **Open** (GitHub OAuth). Abuse controls are therefore v1 scope, not later. |
| Servers per account | One in the UX, **N-ready schema** (servers keyed by account + name; v1 hardcodes name `default`, subdomain `<handle>.getbb.app`). No machines table in the cloud — machine management lives entirely in bb's own UI. |
| v1 scope | Includes **multi-machine connect** (daemon-only installs via script). |
| getbb.app dashboard | **Minimal shell**: login, handle claim, server card (online / last seen / revoke), connect instructions, manual-code fallback for headless setups. All product UI is the user's own bb through the tunnel. Cloud stores no threads/code. |
| Staging | **`vibecodethis.site`** — an existing active Cloudflare zone in the same account (`7bb84…`). Apex = dashboard/auth; handles = `<handle>.vibecodethis.site` (single-level wildcard → free Universal SSL). Own D1 + own workers so prod getbb.app is untouched; cut prod routes over in M5. Base domain must be config everywhere (wrangler env vars + tunnel-client `--base-url`), never a literal. Session cookie scoped to `.vibecodethis.site` so the gate can validate apex-set sessions on subdomains. |
| Web app rename | `apps/landing` → **`apps/web`** (`@bb/web`): it grows from marketing site to marketing + auth + dashboard. Done as the first PR (see M1) — rename before new code lands on top. Note: `apps/app` (product SPA) vs `apps/web` (getbb.app site) — keep the distinction crisp in READMEs. |

## The two pairing flows (they are different; UI must keep them distinct)

**Account ↔ server — "Connect to getbb.app"** (new, M3):
1. User clicks **Connect to getbb.app** in bb settings (local access).
2. `apps/app` calls the daemon local API `POST /connect/start`; the daemon
   generates a `state`, returns the approval URL; the app opens
   `https://getbb.app/connect/approve?state=…&callback=http://127.0.0.1:38887/connect/callback`.
3. User logs in with GitHub, approves "Connect this server as
   `sawyer.getbb.app`". Browser redirects to the daemon's loopback callback
   with a one-time code.
4. Daemon exchanges code → durable tunnel credential + pinned account id
   (stored alongside `~/.bb/auth.json` state), dials the TunnelDO, holds it.
5. UI (via daemon local API `GET /connect/status`) shows connected + the URL.
   `POST /connect/disconnect` and dashboard-side revoke both sever it.

Headless fallback: dashboard shows a manual one-time code; on the machine run
`bb connect --code XXXX` (thin CLI → same daemon API).

**Server ↔ machine — "Add a machine"** (existing enrollment, new UI, M4):
1. In bb's UI: **Machines → Add a machine** mints a join code (existing
   enroll-key route — owner traffic arrives at loopback through the tunnel,
   so no route changes).
2. UI shows a copyable one-liner:
   `curl -fsSL https://getbb.app/connect | sh -s -- --code XXXX --server https://sawyer.getbb.app`
3. On the new machine, the script installs bb-app, runs the existing
   `host-daemon join --join-code … --server-url …`, installs a
   launchd/systemd service. The machine appears as a Host in bb's UI.

## Repo layout of new/changed code

```
apps/web                 # RENAMED from apps/landing; grows /login, /dashboard,
                         #   /connect/approve, better-auth routes (apex + www)
apps/connect             # NEW: gate worker on *.getbb.app/* + TunnelDO + code-exchange API
packages/tunnel-contract # NEW: frame types + encode/decode, shared by DO and tunnel client
packages/connect-db      # NEW: drizzle schema + migrations for D1 (better-auth tables,
                         #   accounts, servers, connect_codes) — shared by web + connect
apps/host-daemon         # grows: tunnel client + local-API endpoints
                         #   (/connect/start|callback|status|disconnect)
packages/bb-app          # grows: `bb connect` thin CLI over the daemon API
apps/app                 # grows: Connect settings pane (M3), Machines pane (M4),
                         #   host online/offline surfacing
```

`apps/server`: **no changes, ever, in this plan** — assert in review on every
PR; it is the central invariant.

Cloudflare specifics:
- Both workers bind the same D1. Session cookie domain is the base domain
  (`.getbb.app` in prod) so the gate validates sessions on subdomains.
- `apps/connect` routes: `*.<base>/*` zone route (wildcards can't be
  custom_domains). `apps/web` keeps apex/www custom domains.
- Renaming the deployed worker (`bb-landing` → `bb-web`) re-creates it in
  Cloudflare — re-attach custom domains in the same change window; do it
  when the staging zone already proves the config.
- Handle rules: `^[a-z0-9][a-z0-9-]{2,29}$` + reserved list (`www`, `api`,
  `app`, `admin`, `connect`, `download`, `docs`, `status`, `staging`,
  `mail`, `cdn`, `bb`, …) maintained in `packages/connect-db`.

## Status (2026-07-05) — PROD STAGED, AWAITING APEX CUTOVER

Everything for the getbb.app production launch is deployed except the final
apex flip. Invite-only via `CONNECT_ALLOWED_GITHUB_USERS=sawyerhood`.

- **Marketing fold-in done:** `apps/landing` deleted; `apps/web` serves the
  marketing page at `/`, dashboard at `/dashboard`, plus the ported
  `/download/macos` + `/api/subscribe` endpoints. CI workflow renamed
  `deploy-landing.yml` → `deploy-web.yml` (builds with
  `CLOUDFLARE_ENV=production`).
- **Prod infra live:** D1 `bb-connect-prod` (migrated 0000–0002); gate worker
  `bb-connect` serving `*.getbb.app/*` via the wildcard zone route (wildcard
  DNS record added by Sawyer); reserved-handle subdomains (www, api, …) 301 to
  the apex; `bb-web` deployed with all 5 secrets, previewable at
  `bb-web.sawyer-7bb.workers.dev`. Both workers share BETTER_AUTH_SECRET.
  Secret stashes on Sawyer's machine: `~/.bb/bb-connect-github-oauth-prod.env`,
  `~/.bb/bb-connect-resend-prod.env`, `~/.bb/bb-connect-prod-secrets.env`.
- **Remaining for launch:** flip `getbb.app` + `www.getbb.app` custom domains
  from `bb-landing` → `bb-web` (approval pending), verify, then delete the
  `bb-landing` worker. Config gotcha: `env.production.routes` MUST stay `[]` —
  routes inherit from the top level and a prod deploy once stole
  vibecodethis.site from staging (fixed by redeploying staging).

## Status (2026-07-04, night) — M4 CONNECTION LAYER DONE (both paths verified)

Goal 2 (M4 multi-machine): both connection models the user specified are built and
verified e2e. Three daemons connected to one dev server simultaneously.

- **Trusted-network path — verified.** A second host-daemon (`test-host-2`, fresh
  `BB_DATA_DIR`) enrolled + connected directly over loopback using bb's existing
  enroll flow (mint enroll-key on the server host → `host-daemon` enroll → session
  → `/internal/ws`). No code change needed beyond confirming the server binds all
  interfaces (it does). This is bb's existing capability; the "trusted network" =
  the security boundary.
- **bb-connect path — verified e2e.** A daemon (`tunnel-host-3`) connected *through
  the Cloudflare tunnel*: its `/internal/*` traffic authenticated at the gate by a
  new **machine credential** and forwarded to the server. Built:
  - `packages/connect-db`: `machine` table + `machine-pair` connect-code purpose
    (migration `0001_machine.sql`, applied to staging D1).
  - `apps/web`: `createMachineCode` + `/api/connect/redeem-machine` +
    dashboard "Add a machine" button. Redeem mints a durable `bbcm_` credential.
  - `apps/connect` gate: `verifyMachineCredential` + an `/internal/*` branch that
    requires a valid machine credential for the handle's account, strips the
    header, and forwards to the server (which still host-key-auths underneath —
    defense in depth). **Security verified:** no credential → 403; valid → reaches
    the server's own 401; bogus → 403; enroll-key can be minted through the tunnel
    only with a valid machine credential (closes the loopback-trust hole).
  - Proven with a header-injecting proxy (`/tmp/machine-proxy.mjs`) standing in for
    the not-yet-written daemon-side credential wiring — same "harness now,
    productize later" pattern as the tunnel-client script.
- **Execution routing to a non-primary host — DONE + verified (2026-07-04).** The
  server-side single-host funnel is relaxed: new `assertUsableHostId`
  (`primary-host.ts`) accepts any non-destroyed public host; the ~10
  validate-a-supplied-hostId sites (projects.ts, host-lookup.ts,
  thread-request-eligibility.ts — both the deps and the project-data gate) now use
  it, while default resolution (`resolvePrimaryHostId`/`requireConnectedPrimaryHostId`)
  is unchanged so single-host stays default. Dispatch already routed by hostId
  (`callHostOnlineRpc`), so no dispatch change. CLI gained `--host <id>` on
  `thread spawn`. **Verified live:** `bb thread spawn --host <host2>` created a
  thread whose environment bound to the second host, and the host2 daemon ran
  `thread.start` (ok:true); no-`--host` still routes to primary; unknown host
  rejected. Full server suite green (1010 tests) incl. new `primary-host.test.ts`
  and 2 updated public tests. Files: `primary-host.ts`, `thread-request-eligibility.ts`,
  `system/host-lookup.ts`, `routes/projects.ts`, `cli/.../thread/spawn.ts`, guide +
  bb-cli skill.
- **Still remaining (product polish, not blocking):** daemon-side credential wiring
  (add `x-bb-connect-machine` in `apps/host-daemon` server-client/enroll/WS + a
  `bb connect machine` launcher subcommand) to replace the proxy harness; and a
  host-picker in the `apps/app` UI (the API + CLI already carry hostId).
- **Experiment gate (2026-07-05):** multi-host execution is gated behind the
  "Multi-machine" experiment (Settings → Experiments; `multiMachine` in
  `experimentsSchema`). Non-primary host targeting is rejected with
  `multi_machine_disabled` while off. All bb connect in-product surfaces
  (Connect settings pane, Machines pane, daemon endpoints) must check the same
  experiment as they land.

## Status (2026-07-04, evening) — SPEED OPTIMIZED + real-account testable

- **Cookie-decode fix:** the gate now URL-decodes the better-auth cookie before
  verifying (its base64 signature arrives as `%2F/%2B/%3D`); real browser logins
  were silently 401-ing before this.
- **Speed (Goal 1) — edge caching live.** The gate is now a caching reverse proxy:
  after owner-auth, cacheable GET responses (per the origin's `Cache-Control`) are
  stored in Cloudflare's per-colo edge cache, keyed per-handle, and served on
  repeat without touching the tunnel. Warm-connection asset requests dropped from
  ~150ms (tunnel) to **~25ms** (edge). Respects origin cache headers so it works
  with the dev server too (Vite deps cached, source modules stay fresh). Also:
  handle+server resolved in one JOIN, per-isolate caches for handle + session
  (20s TTL) so a page's request burst mostly skips D1. Remaining refinement:
  credit-based backpressure in the tunnel protocol (helps large/concurrent
  dynamic responses; assets now mostly bypass the tunnel so lower priority).
- **Fast origin:** production bb build (`apps/app` bundled) served by a small
  static+proxy server (`/tmp/preview-server.mjs`, :14003) that proxies /api + /ws
  to the dev server (:22002); tunnel points there. ~55 requests vs Vite dev's
  hundreds; DOM-ready ~200ms through the tunnel.

## Status (2026-07-04, later) — CORE FEATURE WORKING E2E ON STAGING

The real bb product loads from a bb server on this machine, through the
authenticated tunnel, at `https://sawyer.vibecodethis.site`, in a browser, over
the public internet. Verified with a screenshot of the full bb UI.

- **M1 DONE + verified.** `apps/web` (new app; the landing→web rename is deferred
  to M5 cutover to avoid touching prod). Now a **TanStack Start app on Cloudflare
  Workers** (following do-browser's `apps/do-computer-www` template:
  `@cloudflare/vite-plugin` + `tanstackStart` + Tailwind v4), reusing **bb's real
  shadcn primitives** (button/card/input/label/badge/settings-section + theme.css
  copied from `apps/app/src/components/ui`) so the dashboard matches bb visually
  (3D bb logo, Inter, Card/Badge/Button tokens). better-auth + GitHub OAuth on D1
  via server routes; mutations are `createServerFn` RPCs; env bindings via
  `cloudflare:workers`. Deployed to `vibecodethis.site` (worker `bb-web-staging`,
  flat config — the vite-plugin flow ignores wrangler `--env`). Verified in a real
  browser: login page, dashboard, Online badge, and "Generate connect command"
  (server-fn RPC minted a live code). Real GitHub OAuth URL/redirect confirmed;
  forged-but-real session (HMAC-signed with the actual secret) drives the flow.
- **UI polish (2026-07-04).** The tunnel gate's fallback sign-in page (plain worker,
  can't bundle React) was restyled to match bb — Inter, `--canvas`/`--ink` tokens,
  dark primary button, inlined bb logo (`apps/connect/src/bb-icon.ts`). Fixed the
  dashboard **sign-out** (better-auth needs `content-type: application/json` AND a
  JSON body — empty body 500s, wrong/no content-type 415s; browser supplies the
  Origin it CSRF-checks). Both verified in-browser.
- **M2 DONE + verified.** `apps/connect` gate: resolves `<handle>.vibecodethis.site`
  → D1 server row, credential-auths the tunnel, session-auths visitors. No
  session → 401 sign-in page; owner → through; **wrong user → 403 (cross-tenant
  isolation confirmed)**. Per-handle custom domain (`sawyer.vibecodethis.site`)
  attached via API. Presence (last_seen_at) refreshed by a DO alarm.
- **M3 DONE + verified.** `tunnel-client.mts` redeems a code → durable credential
  (stored `~/.bb/cloud.json`) → holds the gate WebSocket → proxies to the local
  bb server. Verified through the authed tunnel: HTTP GET/POST, 10 MB sha256
  integrity, WebSocket echo (text + binary, ~220 ms), and the **real bb SPA +
  /api/v1 + live UI**.
- **M5 partial.** Immediate revocation DONE + verified (disconnect severs the
  live tunnel via a cross-script DO control channel; reconnect with the revoked
  credential → 403; `/__` internal paths blocked externally → 404). Remaining:
  rate-limiting on `/api/connect/redeem` + auth endpoints, Turnstile on signup,
  full `/security-review`, and the landing→web prod rename/cutover.
- **M4 NOT DONE — needs a design decision (surfaced, not guessed).** Adding
  *execution hosts* (other machines' bb daemons) *through the tunnel* requires
  the gate to carry bb's `/internal/*` daemon protocol, which is host-key-authed
  by bb, not better-auth-session-authed. Exposing `/internal/*` through the
  session-gated tunnel is a real security-model choice (mint a machine-connect
  credential + a second gate auth path for `/internal/*`, vs. keep daemon↔server
  on direct/Tailscale and let bb connect own only browser/mobile access). This is
  the one milestone that shouldn't be hacked autonomously.

**Live staging resources:** D1 `bb-connect-staging`; workers `bb-web-staging`
(apex) + `bb-connect-staging` (`sawyer.vibecodethis.site`); secrets set. A test
user owns handle `sawyer`; forged test sessions + a second "intruder" user exist
in D1 (delete before real use). The dev bb server + `tunnel-client.mts` are
running locally to keep `sawyer.vibecodethis.site` live — stop with
`scripts/bb-dev-app stop` and `pkill -f tunnel-client`.

## Status (2026-07-04)

- **M0 spike — DONE and validated on the real Cloudflare edge.** `packages/tunnel-contract`
  (frame codec, 21 tests) + `apps/connect` (TunnelDO + gate + spike client/origin
  scripts) built and deployed to `https://bb-connect.sawyer-7bb.workers.dev`.
  Verified end-to-end through the deployed worker: HTTP GET/POST, 10 MB response
  with sha256 integrity match, chunked streaming (`/slow`), WebSocket echo (text +
  300 KB binary, ~217 ms round-trip incl. NYC↔edge), offline 503 when no tunnel,
  and reconnect-on-replace. Hibernation auto-response wired (`setWebSocketAutoResponse`);
  overnight idle-billing soak still pending. Spike secret saved at
  `~/.bb/bb-connect-spike-secret.txt`; run the client with
  `BB_CONNECT_TUNNEL_URL=wss://bb-connect.sawyer-7bb.workers.dev/__tunnel BB_CONNECT_SECRET=$(cat ~/.bb/bb-connect-spike-secret.txt) pnpm --filter @bb/connect spike:client`.
- **M1 partial — `packages/connect-db` DONE** (D1 schema: better-auth core tables +
  profile/server/connect_code/audit_log, constants incl. handle validation + reserved
  list, `migrations/0000_init.sql`, 9 tests on in-memory SQLite). **Blocked on Sawyer:**
  GitHub OAuth app client id/secret (better-auth), and a staging domain/zone — wrangler
  here is OAuth-authed with workers+D1 write but **zone read-only**, so it cannot create
  zones/DNS. See [[cloudflare-wrangler-access]]. The `apps/landing`→`apps/web` rename +
  auth wiring + dashboard were intentionally **not** done unattended: the rename
  re-creates the live getbb.app worker, which shouldn't happen without you.

## Milestones

Each is a shippable PR chain; M0 gates everything.

### M0 — Spike: skinny DO tunnel (~1 week)

One DO, hardcoded handle, no accounts, on the test domain. Tunnel-client
script (~300 lines, partysocket) on a laptop behind NAT; Worker routes
`spike.<test-domain>` → DO; frames carry HTTP + one WS stream; naive chunking.

- Build the spike **against `packages/tunnel-contract` types from day one**.
- Drive a stock bb server through it from a phone on cellular.

**Exit criteria:** SPA loads; a thread streams live over `/ws`; a terminal
attaches and feels usable; idle 10+ minutes then resume works (hibernation
verified in the CF dashboard — no duration billing while idle);
`host-daemon join` from a second machine through the public URL enrolls.
Written go/no-go note with latency numbers.
**Validation:** manual phone-on-cellular run; screen-record the terminal for
the note. Fallback if no-go: self-hosted Piko fronted by our auth proxy
(revisit plan).

### M1 — Rename + cloud foundation: auth, D1, dashboard shell (~1–2 weeks, parallel with M0 after day 3)

- **PR 1 — rename `apps/landing` → `apps/web`** (`@bb/landing` → `@bb/web`,
  wrangler `bb-landing` → `bb-web`). Per AGENTS.md, grep project-wide for
  stale names: turbo filters, CI workflows, deploy scripts, docs, README.
  Register the staging zone; wrangler envs (`staging` default during build).
- `packages/connect-db`: drizzle schema — better-auth tables, `accounts`
  (handle, github id), `servers` (account_id, name default `'default'`,
  credential hash, last_seen_at, version), `connect_codes` (one-time,
  10-min TTL, purpose: `server-pair` | `manual-pair`). Migrations via
  drizzle-kit → `wrangler d1 migrations`.
- `apps/web`: better-auth with GitHub OAuth; `/login`, `/dashboard` (handle
  claim → server card: online/offline/last-seen → connect instructions →
  manual-code fallback → revoke), `/connect/approve` (the browser-callback
  approval page). PAT issuance (`bbc_…`) for CLI/agent use.
- Open-signup guardrails: Turnstile on OAuth start, per-account limits
  (1 server), reserved-handle enforcement, audit rows for connect/revoke.

**Exit criteria:** on the staging domain — fresh GitHub account → sign up →
claim handle → dashboard shows a disconnected server card with instructions;
second account cannot claim the same handle; reserved handles rejected;
approve page round-trips a code to a fake localhost callback. Prod getbb.app
untouched. **Validation:** `pnpm exec turbo run test --filter=@bb/web
--filter=@bb/connect-db` (vitest + workerd pool, real D1 via miniflare —
never mock the DB); manual signup on staging.

### M2 — Data plane: tunnel-contract, gate worker, TunnelDO (~2–3 weeks)

- `packages/tunnel-contract`: binary frames — stream open/close, HTTP head,
  body chunk (≤1 MiB) + credit-based backpressure, WS frame, account tag,
  heartbeat, reconnect-with-resume. Pure functions, exhaustively unit-tested.
- `apps/connect`: gate worker (hostname → handle → session/PAT check →
  account owns server → attach account tag → route to TunnelDO; offline
  "last seen" page; per-account + per-IP rate limits) and TunnelDO
  (hibernation-aware socket pair, stream table, chunking, backpressure,
  auto-response pings). Code-exchange endpoint for the pairing flow.
- Auth matrix tests: no session, wrong account, revoked credential, expired
  code → rejected at the gate; mistagged frame → rejected by the (test)
  tunnel client.

**Exit criteria:** the M0 spike script, upgraded to the hardened contract,
passes: chunked 100 MB response; backpressure under a slow reader (memory
bounded, verified); tunnel drop mid-stream → reconnect resumes cleanly;
cross-tenant probe suite gets nothing. **Validation:** workerd integration
suite (`pnpm exec turbo run test --filter=@bb/connect`); soak a connected
idle tunnel overnight — hibernation billing ≈ 0, morning resume works.

### M3 — Tunnel client in the daemon + Connect UI + thin CLI (~2 weeks, overlaps M2 tail)

- `apps/host-daemon`: tunnel client (partysocket discipline, account-tag
  verification, proxy streams to the local server port); local-API endpoints
  `POST /connect/start`, `GET /connect/callback`, `GET /connect/status`,
  `POST /connect/disconnect`; credential persisted next to `auth.json`.
  Origin-gate the new endpoints like the rest of the local API.
- `apps/app`: Settings → Connect pane — the button flow from the pairing
  section, connected-state display (handle, URL, reconnecting), disconnect.
  (Reachable when accessing bb locally/tailnet; remote users are by
  definition already through the tunnel.)
- `packages/bb-app`: `bb connect [--code XXXX] [--base-url …]`,
  `bb connect status|off` — thin wrappers over the daemon local API for
  headless machines and agents.
- Per AGENTS.md CLI rules, same change: update
  `packages/templates/src/templates/bb-guide-*.md` + regenerate, the bb-cli
  skill (`apps/server/.../builtin-skills/bb-cli/SKILL.md`), and
  `docs/configuration.md`.

**Exit criteria:** phone on cellular → staging login → `you.<staging>` →
live thread + terminal attach, server on a laptop behind NAT with an
**unmodified `apps/server` build**; the whole connect flow driven from the
bb UI button with no copy-paste; dashboard revoke severs access within
seconds; `bb connect --code` works on a machine with no browser.
**Validation:** real two-network manual run; daemon integration test driving
the tunnel client against a local workerd gate; `pnpm exec turbo run
typecheck test --filter=@bb/host-daemon --filter=bb-app`.

### M4 — Multi-machine connect (~1–2 weeks)

- `getbb.app/connect` serves the install script (from `apps/web`).
- `apps/app`: Machines pane — "Add a machine" mints a join code via the
  existing enroll-key route and shows the copyable one-liner; host list with
  online/offline badges.
- Script: install bb-app → existing `host-daemon join` against the tunnel
  URL → launchd/systemd service. Per-account machine cap (5) enforced at the
  gate by distinct daemon-connection identities.
- Queued-until-online thread starts and per-host capability toggles are
  explicitly **fast-follow**, not v1.

**Exit criteria:** three-machine demo — server at home, work laptop + cloud
VM added via the copied one-liner — all hosts visible with live
online/offline state; a thread runs on each from a phone; daemon killed
mid-thread recovers or fails cleanly after service restart (never wedged).
**Validation:** real multi-machine run + integration test with two daemons
against one server through a local workerd gate.

### M5 — Prod cutover + launch hardening (~1 week)

- Cut over: attach prod zone routes (`getbb.app`, `www`, `*.getbb.app`),
  prod D1 + secrets, worker rename window (re-attach custom domains),
  staging kept as permanent pre-prod.
- Abuse: bandwidth accounting in the DO (soft cap + dashboard warning),
  code brute-force lockout, rate-limit tuning, Turnstile thresholds.
- Observability: Workers analytics + structured logs with a
  **no-payload-logging rule enforced in review**; alerts on gate error rates.
- Security pass: `/security-review` on the full diff; checklist — cookie
  scoping, tag-verification paths, credential rotation, revocation latency,
  local-API origin gating for the new endpoints.
- Docs: getbb.app marketing section, `docs/` entry for bb connect, launch post.

**Exit criteria:** security findings resolved or accepted; one-week staging
soak with ≥3 daily-driver users; open signup on in prod. **Validation:** the
soak + final cross-tenant/auth-matrix CI run against prod config.

## Cross-cutting rules

- **`apps/server` is never touched.** The daemon changes are scoped to the
  tunnel client + its local-API endpoints — no provider/thread behavior.
- **Never mock D1/DB in tests** — miniflare-backed D1 or in-memory SQLite.
- **No payload persistence or logging in the cloud** — the product promise.
- Base domain, limits, TTLs, reserved handles: constants in
  `packages/connect-db` / wrangler env vars, never scattered literals.

## Open items (tracked, not blocking start)

1. E2E-encrypted frames (relay-blind): decide during M2 whether the frame
   header reserves an opaque-payload mode (ADR; leaning yes, cheap now).
2. Fast-follow queue: queued-until-online thread starts, per-host capability
   toggles, LAN-direct fast path, N-servers UX, custom domains, connect
   status surfaced when remote (server-mediated, needs thought).
3. Handle squatting/recycling policy once signup volume is real.
4. Staging-domain choice: register during M1 (any cheap zone works; keep it
   out of code via config).
