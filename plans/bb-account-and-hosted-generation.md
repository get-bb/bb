# bb account and hosted title and commit generation

Date: 2026-09-22. Branch: `bb/create-bb-plan-thr_patbjb7umb`. Status: approved;
phase 1 built on this branch (uncommitted), not deployed.

Update 2026-09-24: the re-land after the gate outage (#4250–#4254) dropped
tunnel tickets. Connect dials the gate with the raw server credential, which
bb-account hands it through `connectCredential`, an RPC only the connect plugin
can call (the server verifies the caller). The ticket sections below describe
the original design.

## Build status (2026-09-22)

Built and tested: Parts 1–7, including the hosted side (connect-db migration
0006, `/link`, `/api/account/*`, tunnel tickets, the `bb-ai-gateway` worker),
the bb-account and bb-ai plugins, the connect refactor, the core rework, and the
Settings → AI services picker. A local smoke run (`pnpm cloud:dev` with a fake
upstream plus an isolated `pnpm dev`) passed browser-link sign-in, code
sign-in, sign-out, tunnel tickets, bb cloud titles and commits, budget
exhaustion, and the picker UI.

Where the build differs from the text below:

- bb-account `status` has only `signed-out` and `signed-in`. A held or disabled
  bb-account answers 503, which consumers treat as signed out.
- `bb account login` prints the link and returns; `login --wait` waits for the
  result (plugin CLI output only returns when the command finishes).
- `bb connect off` / `on` toggle remote access; `bb account logout` forgets the
  pairing.
- Connect's lost machine-code lookup uses `POST /api/connect/machine-code-lookup`
  because `bb-account.v1.fetch` cannot send custom headers.
- A selection stores `{ pluginId, serviceId }`, and the Automatic order lives in
  `AUTOMATIC_AI_SERVICE_PLUGIN_IDS` in the builtin registry, so core names no
  provider id.
- AI selections have their own route (`PUT /system/ai-services/selection`)
  instead of riding the general-settings update.

Model eval (step 0, 50 real thread prompts and 30 recent commits, ZDR only,
reasoning off): `AI_MODELS` is now `inception/mercury-2.5`,
`google/gemini-2.5-flash-lite`, `nvidia/nemotron-3.5-lightning`. Mercury had
50/50 clean titles (p50 249 ms, p95 637 ms) and the commit subjects closest to
the real ones. Nemotron hit upstream 429s and a ~4 s p95. `openai/gpt-oss-20b`
refuses to turn reasoning off and `qwen/qwen3.7-flash` has no ZDR endpoint.

Still to do: deploying the migration and the gateway; phase 2 voice.

## Goals

1. One place to sign a bb server into a getbb.app account: a `bb-account`
   plugin. Connect, and every later hosted service, calls it over plugin RPC
   instead of holding its own credential.
2. A hosted service on getbb.app that writes thread titles and commit messages
   for signed-in users. Branch names come from the title, so they improve too.
   It runs on OpenRouter and is metered at 50¢ of model spend per account per
   day.
3. Later, the same service and budget also cover voice transcription
   (Part 8). Phase 1 is shaped so voice adds no new plumbing.
4. Users choose which service handles each task (titles, commits, voice) in a
   Settings picker like the sidebar ones. Any plugin's AI service can appear
   there, including a user's own OpenRouter plugin (Part 6).

## What exists today

- **Identity.** getbb.app runs better-auth with GitHub
  (`apps/web/src/server/auth.ts`). Connect pairing is the only way to link a bb
  server to an account:
  - The dashboard issues a one-time `XXXX-XXXX` code.
  - `plugins/connect/src/redeem.ts` trades the code at
    `POST /api/connect/redeem` for a long-lived `bbcred_` server credential.
  - Connect keeps `{serverUrl, handle, credential}` in its plugin KV
    (`plugins/connect/src/credential.ts`).

  `server.subdomain` is `NOT NULL UNIQUE`, so a linked server always has a
  Connect label. Nothing else in bb uses the getbb.app account. No hosted
  endpoint has rate limits or metering.

- **Generation.** Titles and commit messages share one path:
  `inferenceCompleteWithFallback` in `apps/server/src/services/ai/inference.ts`.
  - It is driven by `BB_INFERENCE` (default `codex/gpt-5.6-luna`) and
    `BB_INFERENCE_FALLBACK` (default `codex/gpt-5.4-mini`).
  - Plugins can serve it through `bb.experimental_aiServices.register`, but
    only from a `bb.host` entry on the primary host. `provider-codex` is the
    only plugin that does.
  - Branch names are a slug of the title (`buildSuggestedBranchName`).
  - PR titles are not generated.
  - Voice input uses the same registry: `BB_TRANSCRIPTION` (default
    `codex/gpt-transcribe`) and the host method `ai.voice.transcribe`
    (`apps/server/src/services/ai/voice-transcription.ts`).
    `resolveVoiceTranscriptionEnabled` shows the mic only when that service is
    registered and the primary host is connected. Voice has no fallback
    setting.
- **The gap.** Without a Codex login the `codex` service is either not
  registered or answers `auth_required`. Neither case reaches the fallback.
  The thread keeps the first 80 characters of the prompt as its title, and
  commits say `bb: automated commit`.
- **Plugin RPC.** `bb.rpc.register(..., { experimental_discoverable: true })`
  and `bb.sdk.plugins.callRpc` already carry calls between plugins.
  `provider-usage` reads usage sources from account-pool, codex and
  claude-code this way. Limits of the mechanism:
  - Handlers saw no caller identity, so any local process could call any
    method, including an agent running `bb plugin rpc call`. The stack adds
    `context.experimental_caller`: a call made through another plugin's
    `bb.sdk.plugins.callRpc` carries a per-load token the server verifies, and
    every other call is a `client` call.
  - Plugins cannot declare dependencies. They load alphabetically, so callers
    must make these calls lazily.

## Shape

```
bb server                                                  getbb.app
─────────                                                  ─────────
core inference ─── bb ───► bb-ai plugin ──┐
                                           ├─► bb-account ── Bearer bbcred_ ─► bb-web         /api/account/*, /api/connect/*
connect plugin ─ REST, tickets ────────────┘   (credential)                    bb-ai-gateway  /api/ai/v1/* ──► OpenRouter
      └─ wss tunnel, Bearer <5-minute ticket> ────────────────────────────────► bb-connect gate
```

The long-lived credential never leaves `bb-account`. Consumers get two things
from it:

- authenticated HTTP through `bb-account.v1.fetch`
- for the tunnel, a five-minute ticket fetched the same way

## Part 1: `bb-account` plugin

Builtin, auto-installed and enabled by default. Id `bb-account`, display name
"bb account".

**Credential.** Stored in plugin KV as `{serviceUrl, serverId, credential}`,
the same way connect stores it today, so server move and the import hold keep
working. It also caches the account profile
`{userId, githubLogin, name, avatarUrl, handle, serverLabel}`. The cache
refreshes from `GET /api/account/me` at start and every 6 hours.

**Sign-in, two ways.**

1. **Browser link (new, default).**
   1. `bb account login`, or the Settings button, calls
      `POST /api/account/link/start` with the machine's hostname.
   2. The response has a user code and
      `https://getbb.app/link?code=ABCD-EFGH`. The UI opens the link. The CLI
      prints it, and opens it when the server is local.
   3. On getbb.app the user signs in with GitHub. If they have no handle yet,
      they claim one, prefilled with their GitHub login. The page shows the
      client name (control and bidi characters stripped) and when and from
      which city and country the request started. They choose "new server"
      or an existing server, then approve; replacing a server that already
      has a bb requires typing the code the bb shows.
   4. The plugin polls `POST /api/account/link/poll` with the secret device
      code and receives the `bbcred_` credential. An approved code delivers
      even if it expired meanwhile, but not after the server was
      disconnected. A later poll within the code's window gets a freshly
      rotated credential if the server still holds the last one delivered,
      so a lost response is recoverable.

   This works for headless and remote servers because the approving browser
   can be on any device.

2. **Pasted code (existing).** `bb account login --code XXXX-XXXX` goes
   through today's `/api/connect/redeem`. `bb connect --code` stays as an
   alias, so the current dashboard instructions keep working.

**Sign-out.** `bb account logout` does three things:

- revokes the server credential through the existing disconnect endpoint
- clears the KV entry
- bumps the status revision

A 401 from `fetch` is confirmed with `GET /api/account/me` first; only a 401
there marks the account `revoked` and clears the credential, so a 401 from a
path that never accepted the credential does not sign the server out.

**RPC contract.** Method names carry a version, like `provider-usage.v1.*`.
Discoverable methods publish their JSON Schema so third-party plugins can use
them.

| Method                                 | Discoverable | What it does                                                                                                                                                                                                                |
| -------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bb-account.v1.status`                 | yes          | Returns `{state: "signed-out" \| "signed-in" \| "revoked" \| "held", revision, account?}`.                                                                                                                                  |
| `bb-account.v1.waitForStatusChange`    | yes          | Long-poll. Resolves when `revision` passes `afterRevision`, or after 25 s. Connect uses it to start the tunnel the moment the user signs in, with no event bus.                                                             |
| `bb-account.v1.fetch`                  | yes          | `{target: "api" \| "gate", method, path, body?}` → `{status, body}`. The origin is fixed to the getbb.app apex or this account's gate host. Paths under `/api/ai/` for any caller; `/api/connect/` only for the connect plugin. Optional `timeoutMs` (1–15 s). JSON only, 1 MB cap. Attaches the credential. |
| `bb-account.v1.adoptConnectCredential` | no           | Connect plugin only. One-time migration from connect's KV. Validates against `/api/account/me` and stores the credential only when signed out. Removed after two releases.                                                                       |

The plugin also has private methods for its own UI: `login.start`,
`login.poll`, `login.cancel`, `redeemCode` and `signOut`.

How much `fetch` protects:

- A caller can use getbb.app APIs as this server but cannot copy the
  credential off the machine.
- The path policy keys off the verified caller: an agent or another plugin
  reaches only `/api/ai/`, so it cannot mint tunnel tickets, machine codes, or
  desktop-session cookies. The same OS user can still read `bb.db`.
- What it does remove is the one-command path for an agent to exfiltrate the
  credential or act as the server.

**CLI.** `bb account status | login [--code <code>] [--no-open] | logout`. Every
command accepts `--json`.

**UI.**

- A Settings section "bb account" showing avatar, GitHub login, handle, server
  label, the hosted services in use, and Sign out.
- A sign-in dialog that shows the code and an "Open getbb.app" button.

**Imported stores.** Extend `createConnectHold`
(`apps/server/src/services/server-move/connect-hold.ts`) to hold
`builtin:bb-account` as well as connect. Once the credential lives in
bb-account, holding connect alone protects nothing: a rehearsal core would
spend the owner's quota and could mint tunnel tickets.
`bb server allow-connect` releases both, and status reports `held` while the
hold is on.

## Part 2: connect becomes a consumer

- **Pairing.** Remove `credential.ts`, `redeem.ts` and the `pair` RPC. When
  signed out, the Settings pair form becomes "Sign in to your bb account",
  which calls bb-account's `login.start` through `useSdk().plugins.callRpc`.
- **Migration.** On start, if connect's KV still holds a legacy credential, it
  calls `bb-account.v1.adoptConnectCredential`. It deletes its own copy once
  the credential is adopted, or once bb-account reports a different signed-in
  account.
- **Tunnel.** Before each dial, connect calls
  `fetch POST /api/connect/tunnel-ticket`, which returns
  `{ticket, tunnelUrl, expiresAt}`. It dials with
  `Authorization: Bearer <ticket>`, and every reconnect mints a fresh ticket.
- **Other hosted calls** go through `bb-account.v1.fetch`: servers,
  desktop-session, machine-code, revoke-machine and server-access grants. The
  desktop and mobile enrollment RPCs keep their current shapes.
- **Signed out.** While signed out, the tunnel service waits on
  `waitForStatusChange`.
- **Changed command.** `bb connect off` now only turns off remote access,
  through a connect setting, and leaves the account signed in.
  `bb account logout` is what forgets the pairing. Document this in the connect
  README, `PLUGIN_OVERVIEW.md` and the `share-server-links` skill.

## Part 3: hosted changes

**bb-web (`apps/web`)**

- Add `GET /api/account/me`, authenticated with the bearer server credential.
- Add `POST /api/account/link/start`, `POST /api/account/link/poll` and a
  `/link` page.
  - Link requests live in `connect_code`, with a new purpose `server-link` and
    new columns `device_code_hash` and `approved_at` (connect-db migration
    0006).
  - Codes are single-use and expire after 10 minutes.
  - Polling is rate limited per device code. `link/start` is rate limited per
    client IP (Workers Rate Limiting, 429 `rate-limited`), and each start
    deletes a bounded batch of unapproved requests that expired over an hour
    ago.
- Add `POST /api/connect/tunnel-ticket`. It returns an HMAC-signed
  `{serverId, credential-hash prefix, exp}` under a gate secret, valid for 5
  minutes. Rotating the server's credential invalidates its tickets.
- Keep the dashboard's `bb connect --code … --server …` instructions until a
  bb release with bb account ships; the hosted side deploys first, and
  `bb connect --code` stays as an alias afterwards.

**bb-connect gate (`apps/connect`)**

- Tunnel dials accept a ticket as well as the raw credential. For a ticket the
  gate checks the HMAC, the expiry, that the server isn't revoked, and that
  the ticket's credential-hash prefix matches the server's current
  credential. The raw credential keeps working until old plugins age out.
- Move credential resolution (`resolveAccountUserId`) into
  `packages/connect-db` so bb-ai-gateway can share it.

**bb-ai-gateway (new worker, `apps/ai-gateway`)**

- **Routing and bindings.** Route `getbb.app/api/ai/*`, which is more specific
  than bb-web's `getbb.app/*`; staging gets the same route. The worker binds
  the shared D1 database, a Workers Rate Limiting binding and the
  `OPENROUTER_API_KEY` secret. It is a separate worker so the OpenRouter key
  and LLM traffic stay out of the site.
- **OpenRouter account.** Use a dedicated OpenRouter account with ZDR
  enforced account-wide. Per-request `provider` routing is not applied to
  transcription requests, so only the account setting also protects voice.
- **`POST /api/ai/v1/complete`.** Authenticated with the bearer server
  credential.
  - Body: `{prompt}`, matching the plugin API's string in.
  - The worker picks the model; clients cannot.
  - Caps: 48 KB of non-blank prompt (the body is read with a 512 KiB byte
    counter, chunked or not), 128 output tokens and a 4 s upstream timeout,
    under bb-ai's 5 s fetch timeout. With these caps the endpoint is useless
    as a free general-purpose LLM proxy.
- **Response.**
  - Success: `{text, usage: {costMicros, spentTodayMicros, limitMicros}}`.
  - Failure: an HTTP error with
    `{error: {code: "budget_exhausted" | "rate_limited" | "unavailable", message, resetsAt?}}`.
- **`GET /api/ai/v1/usage`** returns `{day, spentMicros, limitMicros, resetsAt}`.
- **Logging.** Metadata only: user, server, model, tokens, cost, latency and
  outcome, including refused requests (`rate_limited`, `budget_exhausted`,
  `invalid_request`). Prompts and diffs are never logged. A cron trigger deletes rows
  older than 30 days.

**Metering**

- **Scope.** The budget is per account (`user_id`), not per server, so extra
  servers don't multiply it. Days are UTC. The limit is the worker variable
  `AI_DAILY_BUDGET_MICROS=500000`.
- **Table.** `ai_usage_day(user_id, day, spent_micros, reserved_micros, requests)`.
- **Reserve, then settle.**
  1. Before calling OpenRouter, reserve a fixed worst case of 0.5¢ with one
     conditional statement:
     `UPDATE … SET reserved = reserved + :r WHERE spent + reserved + :r <= :limit`.
  2. After the call, add the actual `usage.cost` from OpenRouter's response to
     `spent` and release the reserve.

  Concurrent requests cannot overshoot the budget. A call is charged the
  cost OpenRouter reports. Without a reported cost, a call OpenRouter may
  still bill (a success, a timeout, a dropped connection or an unreadable
  reply) is charged the reserve, and an error response is charged nothing.
  Settlement runs in a `finally` kept alive with `ctx.waitUntil`, so a client
  disconnect cannot strand the reserve.

- **Burst limit.** 60 requests per minute per account, via the Rate Limiting
  binding.
- **Backstop.** Total spend is bounded by a credit limit with a daily reset on
  the OpenRouter key itself. The worker has no global cap.

## Part 4: model

The picks come from OpenRouter's live catalog, fetched 2026-09-22. Titles and
commit subjects need low latency, short output, and a model that answers with
only the requested text. Reasoning is off.

| Role       | Model                           | $/M in | $/M out | Why                                                                                                                                    |
| ---------- | ------------------------------- | ------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Primary    | `nvidia/nemotron-3.5-lightning` | 0.07   | 0.20    | 30B MoE with 3B active, built for high-throughput short tasks. Three zero-data-retention (ZDR) endpoints: Phala, DeepInfra, CoreWeave. |
| Fallback 1 | `inception/mercury-2.5`         | 0.04   | 0.15    | Diffusion model with very low latency. ZDR at Inception.                                                                               |
| Fallback 2 | `openai/gpt-oss-20b`            | 0.018  | 0.09    | Cheapest option, with many ZDR endpoints.                                                                                              |

No OpenRouter model is called "Nemotron Ultra Fast". Nemotron 3 Ultra is the
550B frontier model at $0.60/$2.40. Nemotron 3.5 Lightning is the fast, cheap
one.

**Request settings.**

- `model` plus a `models` fallback array
- `provider: {zdr: true, data_collection: "deny", sort: "latency"}`
- `reasoning` disabled
- `max_tokens: 128`
- `temperature: 0.2`
- `user` set to a hash of the account id, for OpenRouter's abuse tooling

With these settings, user code only goes to endpoints that don't retain it.

**Cost.**

| Request                                  | Input            | Cost          |
| ---------------------------------------- | ---------------- | ------------- |
| Title                                    | about 1K tokens  | about $0.0001 |
| Commit message at core's 32 KB patch cap | about 10K tokens | about $0.0008 |

- 50¢ a day covers about 600 max-size commits or 5,000 titles.
- A heavy user (50 threads and 20 commits a day) spends about 2¢ a day, or
  about $0.65 a month.
- The 50¢ cap therefore only matters for abuse. The worst case is $15 a month
  per account, and the OpenRouter key's credit limit bounds the total.

**Step 0 of implementation checks the pick.**

1. Run about 50 real first messages and 30 real diffs from this repo through
   all three models, using the actual templates.
2. Record p50 and p95 latency. Title generation blocks environment creation
   for up to 5 s.
3. Record the clean-reply rate (the reply is just the title or message once
   core's cleanup runs) and judge output quality.
4. Reorder the models if the data says so.

## Part 5: core server changes

**1. The plugin API becomes string in, string out.** A plugin registers
plain functions from its `server.ts`:

```ts
bb.experimental_aiServices.register({
  id: "my-openrouter",
  displayName: "OpenRouter",
  complete: async (prompt, { signal }) => {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal,
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const json = await res.json();
    return json.choices[0].message.content;
  },
  transcribe: async (audio, { signal, hint }) => "…",
  status: async () => ({ ready: true }),
});
```

- **`complete(prompt: string, { signal }): Promise<string>`** handles text
  tasks: titles and commit messages.
- **`transcribe(audio: File, { signal, hint }): Promise<string>`** is
  optional and handles voice. `hint` is the existing vocabulary text, or
  `null`.
- **`status(): Promise<{ ready: true } | { ready: false, message }>`** is
  optional. It supplies the picker's status line ("Sign in to your bb
  account") and decides whether Automatic skips the service and whether the
  mic shows.
- **The plugin owns everything behind the function:** which model, which
  API, any retries of its own. Core never sends a model, a schema or a
  purpose.
- **Failure is a rejected promise.** Core aborts `signal` at the task's
  timeout (5 s for titles and commits, 10 s for voice).
- **Which tasks a service appears for** follows from the functions it
  provides. The `kinds` field goes away.
- **Where the functions run.** They run on the server. A plugin that needs
  host-local state reaches its own `bb.host` entry through
  `bb.hosts.experimental_client`, as other plugins already do. Core no longer
  routes AI calls to hosts, so the AI host contract
  (`experimental_aiServicesHostContract`, `@get-bb/plugin-sdk/ai-services`)
  and its error-code enum are deleted.
- **Documentation.** `bb.experimental_aiServices` is already experimental, so
  the new fields don't need prefixes. Rewrite its `docs/api_to_audit.md`
  entry, `surfaces.ts` entry and Plugin Guide card.

**2. Core owns the prompts and the cleanup.**

- The templates `generate-thread-metadata.md` and `generate-commit-message.md`
  now ask for the bare title or message instead of JSON.
- Core cleans each reply before the existing sanitizers
  (`sanitizeGeneratedTitle`, the 72-character commit rule):
  - it strips `<think>…</think>` blocks
  - it keeps the first non-empty line
  - it trims wrapping quotes and backticks, and prefixes like "Title:"
- Every plugin gets the same behavior without having to reimplement it.

**3. Routing.** Each call looks up its task's selection (Part 6).

- **Explicit service:** call it once. If it fails, use the plain fallback
  text.
- **Automatic:** walk the built-in chain, which is Codex, then bb cloud
  (decision 1). A service is skipped when its plugin isn't loaded, when
  `status()` isn't ready, or when it rejects.
- **Off:** use the fallback text.

Automatic matches on plugin id as well as service id, so it only reaches the
builtin `provider-codex` and `bb-ai` plugins. The service ids `codex` and
`bb` are reserved for those plugins, so no third-party plugin can take over
Automatic's traffic.

**4. Delete the env settings and the server-direct providers.**

- Delete `BB_INFERENCE`, `BB_INFERENCE_FALLBACK` and `BB_TRANSCRIPTION`, along
  with their `bb-app config` keys, their defaults and
  `packages/config/src/inference-model.ts`.
- On startup, a stale key in bb-app config logs one warning and is ignored.
  `bb-app config set BB_INFERENCE` fails with a pointer to
  `bb settings ai-services set`.
- Delete the pi-ai server-direct completion path in
  `apps/server/src/services/ai/inference.ts`, the OpenAI-API-key transcription
  path in `voice-transcription.ts`, and `SERVER_DIRECT_AI_SERVICE_IDS`. If
  nothing else in the server uses pi-ai, drop the dependency too.
- Anyone who pointed these settings at an API key (for example
  `anthropic/…`) moves to a plugin. Say so in the changelog.

**5. Codex moves to the new API.**

- `provider-codex` registers `complete`, `transcribe` and `status` in its
  `server.ts`. Each one calls its own host entry on the primary host, because
  the Codex login lives in `~/.codex/auth.json` there. The host contract
  becomes private to the plugin.
- It picks its own models: `gpt-5.6-luna`, then `gpt-5.4-mini` if that
  fails, and `gpt-transcribe` for voice. That replaces today's env defaults.
- It asks for plain text instead of a JSON schema.
- It ships in the same release as the core change.

**6. No daemon wire changes,** so `HOST_DAEMON_PROTOCOL_VERSION` stays as it
is. Plugin host RPC is plugin-level traffic.

## Part 6: choosing a service for each task

A new Settings section, **AI services**, works like the sidebar pickers
(`ReplacementProviderSetting`). It is now the only place this choice is made.
It has one row per task:

| Row             | Lists services with | Notes                                                  |
| --------------- | ------------------- | ------------------------------------------------------ |
| Thread titles   | `complete`          | Branch names follow the title.                         |
| Commit messages | `complete`          |                                                        |
| Voice input     | `transcribe`        | Codex already serves voice. bb cloud joins in phase 2. |

**What each row's dropdown offers.**

- **Automatic (default).** Codex, then bb cloud. The description says what it
  is using right now, for example "Using bb cloud. Codex isn't signed in."
- **Every registered service** from any plugin (bb cloud, Codex or your
  OpenRouter plugin), each with its plugin name and the message from
  `status()`.
- **Off.** No generation. Titles use the prompt text and commits use
  `bb: automated commit`.

The picker chooses a service, never a model. A **Test** button runs a sample
through the current choice and shows the reply and the latency.

**Rules.**

- **An explicit choice is strict.** If the chosen service fails, bb uses the
  plain fallback text and does not send the text to another service. This
  matters when someone picks a local or private service for commits so their
  diffs never leave the machine.
- **Automatic uses only services bb ships.** A third-party service receives
  prompts only after the user picks it.
- **The choice is server-wide,** not per device, because generation runs on
  the server.

**Storage.**

- A new app setting holds the choice:
  `aiServiceSelections: { threadTitle, commitMessage, voice }`. Each value is
  `{mode: "automatic"} | {mode: "off"} | {mode: "service", serviceId}`, and
  every task defaults to Automatic.
- A selection whose plugin has been uninstalled shows as "Unavailable plugin"
  and behaves like Off until changed.
- The shared dropdown moves out of `ReplacementProviderSetting` into a
  presentational component. The sidebar pickers keep their per-device atoms,
  and this section reads and writes server settings.

**Your OpenRouter plugin.**

- It registers `complete` with its own model setting and needs no host
  entry.
- Its service id can be anything except the reserved `codex` and `bb`.

It then appears in the Thread titles and Commit messages rows. Adding
`transcribe` puts it in Voice input too.

**CLI and SDK.**

| Surface                                                                                         | Change                                                                              |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `bb settings ai-services`                                                                       | Prints each task's selection and each service's status. The env lines go away.      |
| `bb settings ai-services set <thread-title\|commit-message\|voice> <automatic\|off\|<service>>` | New.                                                                                |
| `bb settings ai-services test <task>`                                                           | New.                                                                                |
| `sdk.system.config().aiServices`                                                                | Becomes `{ selections, services: [{ id, displayName, pluginId, tasks, status }] }`. |
| Updating a selection                                                                            | Goes through the same app-settings update as the other Settings rows.               |
| `sdk.system.testAiService({ task })`                                                            | New.                                                                                |

New server route: `POST /system/ai-services/test`.

## Part 7: `bb-ai` plugin

A small builtin plugin, enabled by default.

- It registers `{id: "bb", displayName: "bb cloud", complete, status}`.
- `complete` calls `bb-account.v1.fetch POST /api/ai/v1/complete` and returns
  `text`. A gateway error becomes a rejected promise.
- `status()` reports "Sign in to your bb account" when signed out and "Daily
  limit reached, resets 00:00 UTC" when the budget is spent, so Automatic
  skips it in both cases.
- Its Settings section shows today's usage ("$0.03 of $0.50 today, resets
  00:00 UTC"), read from `/api/ai/v1/usage`, and says what is sent where.
- CLI: `bb ai status | usage`.

It is separate from bb-account so users can turn hosted generation off without
signing out or losing Connect. In phase 2 it adds `transcribe`.

## Part 8: voice transcription (phase 2)

Phase 1 already provides the pieces voice needs: the account, the metered
gateway, the `transcribe` function, the Voice input row and the Automatic
chain. Phase 2 adds:

- **Gateway.** `POST /api/ai/v1/transcribe`, which proxies to OpenRouter's
  `POST /api/v1/audio/transcriptions` (base64 `input_audio` in JSON). The
  response carries `usage: {seconds, cost}`, so metering is unchanged.
  - Caps: 5 minutes of audio and 10 MB per request.
  - Reserve 2¢ per call, then settle to the actual cost.
  - Voice draws from the same 50¢ daily budget.
- **Vocabulary hints.** `hint` goes through `provider.options.<slug>.prompt`,
  because OpenRouter ignores the top-level `prompt` field.
- **bb-ai.** Registers `transcribe`. Voice's Automatic chain then becomes
  Codex, then bb cloud, and `resolveVoiceTranscriptionEnabled` shows the mic
  when the Voice input selection resolves to a ready service.
- **Model.** Evaluate these two on real bb dictation, which is full of code
  identifiers, file paths and product names:

  | Model                               | $/min  | ZDR endpoints   |
  | ----------------------------------- | ------ | --------------- |
  | `openai/whisper-large-v3-turbo`     | 0.0002 | Groq, DeepInfra |
  | `mistralai/voxtral-mini-transcribe` | 0.003  | Mistral         |

  For reference, `openai/gpt-transcribe`, the model Codex uses, costs
  $0.0045/min on OpenRouter and has no ZDR endpoint. Even at $0.003/min, 30
  minutes of dictation a day costs 9¢.

- **Verification.** Sign in with no Codex login and the mic appears. A
  recording transcribes. `bb ai usage` counts it. With the budget exhausted,
  Automatic skips bb cloud, so the mic hides unless Codex is available.

## Rollout

1. Run the model eval (step 0).
2. **Core, Codex and the picker, in one release** (Parts 5 and 6).
   - Ship the string-in, string-out API, per-task routing, the AI services
     section, and the CLI and SDK changes.
   - Delete the env settings and the server-direct providers.
   - Move Codex to the new API.

   These ship together because once the env settings are gone, the picker is
   the only place to configure this. None of it depends on the hosted work,
   so your OpenRouter plugin can be picked as soon as this lands.

3. **Hosted.** Ship connect-db migration 0006, `/api/account/*`, the link
   page, tunnel tickets in bb-web and the gate, and the bb-ai-gateway worker.
   Deploy to staging (vibecodethis.site), then production. Everything is
   additive, so today's connect plugin keeps working.
4. **Plugins.** Ship bb-account, the connect refactor with the credential
   handoff, and bb-ai, and extend the import hold. bb cloud joins Automatic
   in this release.
5. **Two releases later.** Remove raw-credential tunnel dials from the gate and
   `adoptConnectCredential` from bb-account.
6. **Phase 2: voice** (Part 8). Ship the transcribe endpoint and bb-ai's
   `transcribe` after the voice model eval.

## Verification

- **Hosted** (vitest with miniflare and real D1; OpenRouter stubbed at
  `fetch`):
  - budget reserve and settle with concurrent requests at the limit
  - UTC day rollover
  - prompt and output caps
  - a revoked credential gets a 401
  - tunnel ticket expiry, tampering, and credential rotation
  - link codes: expiry, reuse, and approval by a different account
- **Server:**
  - routing for each task: explicit, Automatic and Off
  - an explicit choice never falls through to another service
  - Automatic skips a service whose plugin isn't loaded, isn't ready or
    rejects, and never reaches a third-party plugin, even one registering
    `codex` or `bb` while the builtin is disabled
  - reply cleanup: think blocks, quotes, "Title:" prefixes and multi-line
    replies
  - a service that hangs is aborted at the task timeout
  - a stale `BB_INFERENCE` in bb-app config only warns, and
    `bb-app config set BB_INFERENCE` points to the new command
  - a held store keeps both bb-account and connect off
- **Codex:** the server-side `complete` reaches its host entry on the primary
  host. With no host connected, `status()` reports it as not ready.
- **Settings picker:**
  - component tests for option status and for an uninstalled plugin's
    selection showing as unavailable
  - `bb settings ai-services set|test` against a real server
- **Plugins:**
  - on upgrade, the legacy connect credential is adopted and the tunnel
    reconnects with a ticket
  - signing in wakes the tunnel through the long-poll
  - a 401 from `fetch` signs out only when `/api/account/me` confirms it
- **End to end** (`verify-bb` against staging):
  1. Sign in with the browser link.
  2. In a project that uses Claude Code and no Codex, create a thread. It gets
     a generated title and a matching branch.
  3. Use the Commit action. It gets a generated message.
  4. Check that `bb ai usage` goes up.
  5. With a 1¢ staging budget, titles fall back to the prompt text and commits
     to `bb: automated commit`.
  6. In Settings → AI services, pick a test plugin's service for Commit
     messages and leave Thread titles on Automatic. The next commit uses the
     plugin, and the next title still uses bb cloud.

## Surfaces to update

- `docs/configuration.md`: remove the three env settings and point to
  Settings → AI services
- the discoverable surfaces listed in `docs/cli-guide-and-skill.md`, for the
  `bb account` and `bb ai` commands and `bb settings ai-services set|test`
- the bb-guide skill
- connect's README, `PLUGIN_OVERVIEW.md` and `share-server-links` skill
- `builtin-registry.ts` and `plugins/bb-official.json`
- `docs/api_to_audit.md`, `packages/plugin-api-map/src/surfaces.ts` and the
  Plugin Guide card for `bb.experimental_aiServices`
- the changelog, covering the removed env settings and API-key providers
- the getbb.app privacy page: what is sent to OpenRouter, and that only ZDR
  endpoints are used

## Later (not part of this work)

- **An OpenAI-compatible URL plugin.** A separate plugin, configured with a
  base URL, API key, model and optional transcription model, that implements
  `complete` and `transcribe` by calling `/chat/completions` and
  `/audio/transcriptions`.
  - That format is served by OpenRouter, OpenAI, Groq, Ollama, LM Studio,
    vLLM and LiteLLM, so users could reach any of those without writing a
    plugin.
  - It needs nothing new from core; it only uses the Part 5 API.
- **Several endpoints in one plugin.** When that plugin exists, it could
  register one service per configured endpoint, for example Ollama for
  commits and OpenRouter for titles.

## Decisions for the owner

1. **Automatic order: Codex or bb cloud first?** Recommended: Codex first,
   then bb cloud.
   - Anyone whose generation works today sees no change and sends nothing new
     to getbb.app.
   - Everyone else gets generation when they sign in.
   - It keeps our spend lower.

   Running bb cloud first would give everyone the same fast model, but it
   would send Codex users' diffs through getbb.app.

2. **Budget.** 50¢ per account per UTC day, shared by text and voice. Total
   spend is bounded by the OpenRouter key's credit limit, not a worker cap.
3. **Tunnel tickets now or later?** Recommended: now. Without them, bb-account
   has to hand connect the raw credential over an RPC that any local process
   can call.
4. **Sign-in claims a handle.** `server.subdomain` is `NOT NULL`, so linking a
   server claims a label even for users who never use Connect. Recommended:
   keep that, and prefill the handle from GitHub. Making the column nullable
   would touch every gate lookup.
5. **Names.** Plugins `bb-account` (`bb account …`) and `bb-ai` (`bb ai …`),
   service id `bb`, worker `bb-ai-gateway`.
6. **One picker per task, or one for all text?** Recommended: per task
   (titles, commits, voice). The main reason is to allow a private service for
   diffs and a fast cloud service for titles.
7. **Should an explicit choice fall back?** Recommended: no. Only Automatic
   walks a chain, so picking a service guarantees where your text goes.
