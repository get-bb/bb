# Hosted website, dashboard, and marketplace

Status: **2026-09-05: 5 passed, 7 partial/blocked**. See [the audit](../MAINTENANCE.md) and [per-recipe ledger](../validation-2026-09-05.json).

## Setup and entry points

Use `pnpm cloud:dev` in an unused checkout with a fresh `.wrangler/cloud-dev`
state directory. Read `scripts/bb-cloud-dev.mjs` first: it derives gateway,
worker and website ports from this checkout and rejects occupied ports. Record
the printed local URLs, owned PIDs and local D1 state location; never point test
writes at production. Stop only this invocation and retain evidence outside
its state directory. Authentication/email/forge integration needs configured
test services; document unavailable prerequisites instead of using real users.

## Source

- `apps/web/src/routes/dashboard.tsx`
- `apps/web/src/server/fns.ts`
- `apps/web/src/routes/marketplace_.tsx`
- `apps/web/src/routes/api.subscribe.tsx`
- `apps/web/src/routes/link.tsx`
- `apps/web/src/server/account.ts`
- `apps/ai-gateway/src/gateway.ts`
- `scripts/bb-cloud-dev.mjs`

## Feature recipes

| Feature | Drive | Observable success |
| --- | --- | --- |
| Landing and navigation | Open the local landing page at desktop and compact widths, follow navigation/download/community links without submitting externally. | Links and layout target the intended pages; remote destinations are recorded without pretending local content proves their service. |
| Authentication | Sign in/out with a disposable configured test identity; inspect callback and returnTo handling including invalid destinations. | Session belongs to the correct account/origin; logout clears access and unsafe redirects are rejected. |
| Claim account handle | Claim an available test handle and try invalid/taken handles; inspect availability feedback. | Normalized handle and validation match persisted account state; collisions cannot claim another account. |
| Server registration and labels | Create a test dashboard server, check label availability/account limit and inspect disconnected/connected panels. | Unique labels and maximum-per-account policy are enforced; panel state matches the actual test tunnel. |
| Pairing codes | Issue/redeem server and machine codes through their supported dashboard/API flows; test reuse/expiry. | Codes authorize only intended test resources once and do not expose unrelated accounts. |
| Browser link sign-in | Run `account login` from a fresh dev bb against the local cloud, open the printed `/link?code=…` URL, claim a handle if prompted, and approve as a new server; repeat choosing Replace for an existing server (type a wrong code, then the right one), and once Deny; call `link/start` in a loop with curl. | The page shows the client name and "Requested … from …"; the CLI reports sign-in only after approval; `/api/account/me` answers for the new credential; Replace refuses a wrong code and a replaced server's old bb is signed out; a denied or expired code never yields a credential; polling faster than the interval gets `slow-down`; repeated starts get 429 `rate-limited`. |
| Tunnel tickets | With a signed-in dev bb, let Connect dial through the local gate; tamper with or reuse an expired ticket through curl; save a ticket, replace the server through `/link`, then dial with the saved ticket. | The tunnel comes up with a `bbtkt_` ticket and reconnects mint fresh ones; tampered, expired, other-server, and pre-rotation tickets get 401. |
| AI gateway metering | Start `pnpm cloud:dev` with and without `OPENROUTER_API_KEY`; with a signed-in dev bb, run `ai on`, pick bb cloud for Thread titles, create threads, and read `ai usage`; set a tiny `AI_DAILY_BUDGET_MICROS` and repeat. | Without a key the gateway answers 503 and titles fall back; with a key titles come from bb cloud and usage grows by the reported cost; an exhausted budget answers 402 with the next UTC midnight and bb cloud reports not ready. |
| Open, disconnect, remove | Open the test server link, disconnect and remove only that server; cancel an alternative removal. | Tunnel availability and dashboard state agree; removal cannot revoke unrelated machines. |
| Machine revocation | Inspect paired machines and revoke a disposable enrollment. | Revoked credentials cannot reopen the test server; other authorized clients remain usable. |
| Marketplace browse | Browse plugin cards, author pages, detail, search/filter controls and invalid plugin IDs. | Visible metadata/version/author come from the selected catalog and unavailable items fail clearly. |
| Catalog APIs | Read v1 and v2 catalog endpoints for a fixture plugin and unknown entries. | Responses conform to their own public format and match UI metadata; compatibility is maintained deliberately. |
| Blog and changelog | Open index, individual posts, changelog and missing slugs; follow in-page links. | Correct content, titles and fallback state render without broken routes at compact widths. |
| Subscribe | Submit valid/invalid/duplicate synthetic email to a local stubbed test service and inspect response. | Validation and subscription outcome are truthful; no real email is sent during documentation work. |
| Downloads, privacy, app association | Read privacy/download routes and Apple/Android association documents; inspect target/package identifiers against build config. | Public routes return intended content/redirects and correct app-link identity; downloading is not proof of installation. |

## Evidence and cleanup

Record each row and platform separately with the actual entry point, observed
state, persisted side effect, and evidence. Missing hardware/service access is
a prerequisite gap, not a pass. Stop only owned sessions/processes, restore
preferences, and remove only synthetic resources after evidence is preserved.

## Maintenance notes

- The local launcher enables disposable email/password account creation from Create an account. This exercises dashboard authentication without GitHub OAuth setup. Keep OAuth/email-provider integration as separate prerequisite-gated checks. Source: `scripts/bb-cloud-dev.mjs:245`.
- A fresh cloud store has no marketplace catalog. Seed only its LOCAL R2 bucket with the repository test v2 manifest at `v2/marketplace.json` and stats at `stats.json`, using `wrangler r2 object put ... --local --persist-to <owned-cloud-state>`. Record that fixture assets may be absent. Never seed production R2. Initial503 with an empty bucket is a setup gap, not a catalog regression. Source: `apps/web/src/marketplace/marketplace-data.ts:10`.
