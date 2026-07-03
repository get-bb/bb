# BB Plugin System — V1 Design

Status: reviewed draft (adversarial review round 1 folded in). Replaces ad-hoc UI forking
as the sanctioned extension path.

## 1. Summary

A BB **plugin** is a single TypeScript package that can extend both the server and the
frontend:

- **Backend**: a TS entry file loaded in-process into the server via jiti (pi's model),
  default-exporting a factory that receives a typed `BbPluginApi`. Full trust, no sandbox.
- **Agent-facing**: the **primary tool surface is plugin CLI subcommands** (Hermes's
  pattern): a plugin registers `bb <name> …` subcommands that both humans and agents use —
  agents invoke them through bash like any other CLI, taught by an auto-generated skill.
  Plugins can also contribute skills (auto-imported from `skills/`), per-turn context, and
  native dynamic tools where a schema'd tool call is genuinely better.
- **Frontend**: three layers, from most to least stable:
  1. **Host-rendered contributions** — thread actions, mention providers,
     settings panes. Registered backend-side; the shipped UI renders them. No plugin code
     runs in the browser. (Slash commands shipped here originally and were REMOVED
     2026-07-02: plugin skills already ride the composer's `/` menu, so the
     agent-free-macro niche didn't justify a parallel command path.)
  2. **Slots** — named stable extension points (homepage section, nav panel, thread panel
     tab, composer accessory) that mount real plugin React components from a runtime-loaded
     ESM bundle sharing the host's React.
  3. **`unstable_` swizzle** — a wrap-only runtime registry over named host components.
     No compat promise; this is the growth platform for new stable surfaces.
- **Distribution**: pi's model — `bb plugin install npm:… | git:… | <path>`, pinned refs,
  manifest in `package.json` under a `bb` field.

Hero plugins that define the V1 surface: **GitHub** (full-stack; the original **Linear**
hero filled this role and was REMOVED 2026-07-02 in its favor — no third-party API key
needed to exercise), **Slack bot** (headless
background service), **Small UX pack** (thread actions), **Agent
enrichment** (skills/CLI tools/context only).

The whole system launches behind a `plugins` system experiment (same gate style as
`uiForking`) until Phase 3 stabilizes.

### Decisions record (interview 2026-07-01)

| Decision | Choice |
| --- | --- |
| Frontend mechanism | Stable slots + runtime-loaded plugin bundles; `unstable_` swizzle tier |
| Backend runtime | In-process in the server via jiti, full trust, async-first API |
| Agent tools | **CLI subcommands first** (Hermes pattern); native dynamic tools secondary |
| Skills | `skills/` directory auto-imported by convention; manifest override optional |
| Install sources | Local path + git + npm (full pi model) |
| Plugin data | Namespaced KV in bb.db **and** per-plugin SQLite file |
| Unstable gating | `unstable_` name prefix only (no manifest ceremony) |
| Scoping | Global enable/disable only in V1 (per-project gating later) |
| Settings | Declarative schema, host-rendered UI, `secret: true` fields |
| Name | "Plugins" (`bb plugin …`, `<dataDir>/plugins`, `@bb/plugin-sdk`) |
| `bb ui fork` | Keep behind experiment during V1; deprecate after heroes prove parity |
| Rollout | Behind a `plugins` experiment until Phase 3 stabilizes |
| Component reuse | Curated `@bb/plugin-sdk/app` kit (stable) + full internal module registry (`unstable_`, Phase 5) |

### Non-goals for V1

- Sandboxing or permission prompts beyond an install-time trust confirmation.
- Per-project plugin enablement or per-project agent-contribution gating.
- A marketplace/gallery (npm keyword `bb-plugin` reserves the door).
- Plugin-to-plugin dependencies or Backstage-style plugin-exported extension points.
- Running plugin code on the host daemon. Plugins run server-side; host-local effects go
  through the SDK/daemon commands like every other server feature.
- Native (compiled) npm dependencies in plugins — see §6 (Electron ABI).

### Multi-host behavior

Plugin CLI commands, native tools, and context work for threads on **any** host: the tool
round-trip and the `bb` CLI both terminate at the server. Plugin **skills** are staged
from server-machine paths, so in V1 they reach only threads on hosts sharing the server's
filesystem (same limitation as data-dir skills today); they silently degrade to absent on
remote hosts.

## 2. Plugin anatomy

```
bb-plugin-linear/
  package.json          # manifest under the "bb" key
  server.ts             # backend entry: default-export factory
  app.tsx               # frontend entry (optional)
  skills/               # auto-imported: every subdir with SKILL.md becomes a skill
    linear-workflow/SKILL.md
  dist/                 # `bb plugin build` output (app bundle), gitignored
```

```jsonc
// package.json
{
  "name": "bb-plugin-linear",
  "version": "0.1.0",
  "engines": { "bb": ">=0.9" },
  "bb": {
    "server": "./server.ts",
    "app": "./app.tsx"           // omit for headless plugins
    // "skills": ["./other-skills/*"]  // only to override the skills/ convention
  },
  "keywords": ["bb-plugin"]
}
```

Convention over configuration: `skills/` is auto-imported when present (pi's
convention-dirs pattern); the manifest field exists only to relocate or exclude.
Plugin id = sanitized package name (`bb-plugin-linear` → `linear` if prefixed, else the
full name). Ids namespace everything: KV keys, routes, settings, CLI subcommands, slot
registrations, the SQLite file, realtime channels.

## 3. Backend runtime and lifecycle

**Loader.** The server creates one jiti instance (`createJiti`, `moduleCache: false`; jiti
becomes a direct server dependency) and imports each enabled plugin's `server` entry.
`@bb/plugin-sdk` resolves to the live in-process implementation via a tiny emitted shim:
the server build (`scripts/build-node-entry.mjs`) emits `dist/plugin-sdk-runtime.js`
alongside the bundle (same pattern as the existing `--external ./start-server.js`), which
reads the API object from a global the server sets before loading plugins; jiti's alias
maps `@bb/plugin-sdk` to that file. One copy of the API, zero backend version skew — the
npm `@bb/plugin-sdk` package is types + frontend runtime only.

**Experiment gate.** A `plugins` field in `experimentsSchema`
(`packages/domain/src/experiments.ts`, default false, persisted in `system_experiments`)
gates the entire system, mirroring `uiForking`. Off means: the loader never runs, the
boot-time dispatcher and contributions endpoints return a structured "disabled" error,
the frontend loads no bundles and shows no plugin settings sections, and `bb plugin *`
commands fail with the same style of message as `bb ui fork` ("Plugins are disabled.
Enable the \"Plugins\" experiment …"). The toggle is **live** — no server restart:
enabling runs the normal load path for all enabled plugins; disabling runs the §3 dispose
sequence for every loaded plugin (both paths must exist anyway for reload).

**Boot order.** Plugins load **after** the HTTP listener is up (they are additive; nothing
core awaits them). Factory execution is time-boxed (30s → status `error: load timed out`)
so a hung factory cannot wedge startup. Engine/SDK compatibility is re-checked at **every
boot and reload**, not just install; failures map to a dedicated `incompatible` status. A
plugin whose files are gone (restored dataDir, manual deletion) gets status `missing` —
enumeration, the contributions endpoint, and asset serving all tolerate ENOENT.

**Two-phase load/bind (from pi).** The factory runs at load and its registrations
(`bb.on`, `bb.cli.register`, …) are recorded into an inert per-plugin record; the server
then binds records into live routing tables. **Load-safe APIs** (callable inside the
factory): `settings.*`, `storage.*`, `log`, registrations. **Bind-gated APIs** (throw a
descriptive error until bind completes): `sdk.*`, `realtime.publish`, HTTP dispatch.

```ts
// server.ts
import type { BbPluginApi } from "@bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  // registrations + load-safe startup work
}
```

**Reload sequence** (`bb plugin reload [id]`, `bb plugin dev` watcher) — explicit order:
1. Abort background services (AbortSignal) and **await their `start()` promises** with a
   bounded timeout (5s); on timeout mark the plugin `degraded: service did not stop`
   rather than double-starting.
2. Run `bb.onDispose` hooks LIFO.
3. Drain in-flight handler invocations (bounded).
4. Close every resource the host vended (all `bb.storage.sqlite()` handles are tracked and
   closed; subsequent use throws, matching stale-context semantics).
5. Invalidate every context handed to the plugin (`PluginContextStaleError` on use).
6. Clear the jiti cache, re-run the factory, rebind.

Events that fire during the reload window are lost, not replayed — documented. Node cannot
truly unload modules; leaked timers are the plugin author's responsibility and `onDispose`
is the sanctioned cleanup hook.

**Failure isolation.** Every handler invocation is wrapped: errors are caught, logged to
the plugin's log, and recorded on per-plugin status (db) surfaced as a badge in the UI and
`bb plugin list`. The wrapper also records **wall-time per invocation**, surfaced as
p95/total in `bb plugin list` — so "the app got janky" becomes "plugin linear spent 40s
blocking this hour" (better-sqlite3 is synchronous; this is the visibility that makes the
in-process trade honest). A plugin that throws at load is marked `error` and skipped — the
server always boots. A hard crash or busy-loop can still take the server down; that is the
accepted V1 trade. The API is async-first everywhere so a later process split does not
change signatures.

**Observability.** `bb.log` is a leveled, plugin-scoped child of the server logger,
written to a per-plugin log file; `bb plugin logs <id> [-f]` tails it. Background services
can report status `needs-configuration` (e.g. no API key yet) instead of crash-looping
into an error badge.

**State tables.** New `plugins` table: id, source spec, version, enabled, status
(`running | error | incompatible | missing | degraded | needs-configuration`), error text,
sdk version at install, installed_at. Plus `plugin_kv`, `plugin_settings`, and
`plugin_schedules` (below).

## 4. Backend API surface (`BbPluginApi`)

All methods are stable unless prefixed `unstable_`.

### 4.1 `bb.sdk` — full BB SDK

The **entire** published `bb-app` public SDK surface (threads, projects, automations,
status, realtime `on` — including `threads.output` and `threads.timeline`), instantiated
in-process against the local server (`createBBSdk({ baseUrl: loopback })`; the local API
is unauthenticated today, so "pre-authenticated" costs nothing). This is the workhorse —
no bespoke plugin APIs for things the SDK already does.

Two SDK-level additions plugins need (server-contract changes):

- **Spawn without environment policy**: plugins *can* read environments and hosts through
  the SDK and pass explicit `environment` args (`{ type: "reuse", environmentId }`, or a
  host + workspace choice) — note the published public SDK currently types
  `environments`/`hosts` as bare `object` (`public-sdk.ts:308-310`); promoting them to
  typed areas is a Phase-1 contract task. What no plugin should have to do is re-derive
  the *defaulting* logic (which host, worktree vs personal workspace) that the compose
  flow owns. So add a server-resolved `environment: { type: "project-default" }` variant
  (the server owns product policy); explicit selection remains available for plugins with
  an opinion. Doc sketches use the real shapes:

  ```ts
  const { threadId } = await bb.sdk.threads.spawn({
    projectId,
    input: [{ type: "text", text: prompt }],
    environment: { type: "project-default" },
    origin: "plugin",
    title: `Slack: ${topic}`,
  });
  await bb.sdk.threads.send({ threadId, mode: "followUp", input: [...] });
  ```

- **Attribution**: `origin: "plugin"` added to `threadCreateOriginSchema` plus
  `originPluginId`, rendered as a badge/filter in the thread list so plugin-spawned
  threads are distinguishable.

### 4.2 `bb.settings`

```ts
const settings = bb.settings.define({
  apiKey:   { type: "string",  label: "Linear API key", secret: true },
  teamKey:  { type: "string",  label: "Team key", default: "ENG" },
  mode:     { type: "select",  label: "Mode", options: ["thread-per-mention", "long-living"],
              default: "thread-per-mention" },
  project:  { type: "project", label: "Target BB project" },   // host renders a picker,
                                                               // stores the project id
  autoSync: { type: "boolean", label: "Sync automatically", default: true },
});
const { apiKey } = await settings.get();
settings.onChange((next, prev) => { … });
```

Descriptor types: `string | boolean | select | project`. Typing rule: `default` present →
non-optional; absent → `T | undefined`. Non-secret values live in `plugin_settings`;
`secret: true` values are written via new `@bb/secret-storage` helpers
(`writeSecretFile`/`deleteSecretFile`, 0600, atomic rename — a named Phase-1 task; today
the package only has `readOrCreateSecretFile`) under `<dataDir>/plugins/<id>/secrets/`.
The app renders one settings section per plugin; secrets render write-only and are
**never sent to the frontend** — `useSettings()` returns `Omit<Settings, secret keys>` at
both the wire and type level.

Honesty note (also shown in the install confirmation): `secret: true` protects secrets on
disk and in the UI, **not from other installed plugins** — every enabled plugin is
full-trust code in the same process and can read all local data.

### 4.3 `bb.storage`

```ts
await bb.storage.kv.set("sync-cursor", { ts: "…" });   // JSON values ≤256KB, namespaced
await bb.storage.kv.get<Cursor>("sync-cursor");
await bb.storage.kv.list("issue:");                    // prefix scan
const db = bb.storage.sqlite();                        // better-sqlite3 Database at
                                                       // <dataDir>/plugins/<id>/data.db
bb.storage.migrate(db, ["CREATE TABLE IF NOT EXISTS issues (…)", …]); // ordered, tracked
```

KV rides a `plugin_kv` table in bb.db (indexed `(plugin_id, key)`, values capped at 256KB
— error beyond). `sqlite()` hands out the **server's own better-sqlite3** (one reason
plugins never need their own native deps), opened with WAL + busy_timeout; handles are
host-tracked and closed on dispose/reload. Writes should be chunked into small
transactions — sqlite is synchronous and blocks the shared event loop (SDK docs carry
this; the per-invocation wall-time metric makes violations visible).

### 4.4 Agent-facing contributions

**Primary: CLI subcommands (the Hermes pattern).** Plugins register subcommands on the
`bb` CLI; agents use them through bash exactly like humans do:

```ts
bb.cli.register({
  name: "linear",                       // → `bb linear …`
  summary: "Search and manage Linear issues",
  commands: [
    { name: "issues",  summary: "List open issues",        usage: "bb linear issues [--team ENG] [--json]" },
    { name: "start",   summary: "Spawn a BB thread for an issue", usage: "bb linear start <issue-id>" },
  ],
  async run(argv, ctx /* { stdin, cwd, threadId?, projectId? } */) {
    return { exitCode: 0, stdout: JSON.stringify(issues) };
  },
});
```

Mechanics: the `bb` CLI fetches plugin command metadata from
`GET /api/v1/plugins/contributions` (so `bb --help` and `bb linear --help` render without
executing plugin code) and proxies invocation to
`POST /api/v1/plugins/:id/cli` `{ argv, cwd, threadId? }`; the handler runs **server-side**
and returns `{ exitCode, stdout, stderr }` (buffered in V1; streaming later). Argv is
passed through verbatim — the SDK ships a small arg-parsing helper, but parsing is
plugin-owned (Hermes's `setup_fn` freedom without shipping code to the CLI). Core `bb`
commands always win name collisions; plugins cannot shadow them, and
`bb plugin run <id> <argv…>` is the always-available explicit form.

Agents discover these through a server-generated **`plugin-commands` skill** injected like
other skills: one line per plugin (name, summary, "run `bb linear --help` for details"),
so context cost stays near zero until a command is actually needed. This surface is
provider-agnostic (any agent with bash), needs no session restart to appear mid-thread,
and doubles as human CLI surface for free. Per the CLI/guide/skill rule in AGENTS.md, the
`bb` guide templates get a plugin-commands chapter.

**Skills** — `skills/` auto-imports (§2). Implementation: a `plugin` tier in
`resolveInjectedSkillSources` (precedence: project > data-dir > **plugin** > builtin) and
a `plugin` sourceType added to the closed union in
`packages/host-daemon-contract/src/commands.ts:91` (daemon-contract change; same-host
limitation per §1).

**Context** — *(REMOVED 2026-07-02)* `bb.agents.addContext` shipped per-turn
programmatic instruction sections and was deleted: standing agent knowledge
ships as plugin `skills/` instead — declarative, user-visible, no per-turn
plugin code on the turn-submission path.

**Native dynamic tools (secondary)** — for cases where a schema'd, permission-visible tool
call beats a CLI invocation:

```ts
bb.agents.registerTool({
  name: "linear_search",
  description: "Search Linear issues",
  parameters: z.object({ query: z.string() }),      // zod accepted directly; params inferred
  async execute(params /* { query: string } */, ctx /* { threadId, projectId, signal } */) {
    return { content: [{ type: "text", text: "…" }] };   // MCP-style content union
  },
});
```

Feeds `resolveDynamicTools()` (`thread-runtime-config.ts:94`) and replaces the hardcoded
dispatch in `apps/server/src/internal/tool-calls.ts:42` with a registry lookup. All four
provider adapters already plumb `dynamicTools` (claude-code via the bb-bridge MCP proxy,
codex, pi, acp) — the risk is e2e verification, not plumbing. Two known wrinkles to fix in
Phase 2: the instructions-gating in `thread-runtime-config.ts` currently assumes the
single built-in tool, and tool-set changes apply on next session start (documented; CLI
commands don't have this limitation, another reason they're primary).

### 4.5 `bb.on` — thread lifecycle events

```ts
bb.on("thread.created", ({ thread }) => { … });          // thread: public Thread DTO
bb.on("thread.idle",    ({ thread, lastAssistantText }) => { … });
bb.on("thread.failed",  ({ thread, error }) => { … });
```

Payloads are concrete: `thread` is the public Thread DTO; `thread.idle` carries
`lastAssistantText: string | null` (assembled server-side the same way
`threads.output` is). Emission hooks the lifecycle-application choke points
(`lifecycle-outcome.ts` wrappers), not the wire-level ChangedMessages (which carry no
payloads). Observe-only in V1 — middleware/veto semantics are a deliberate cut until
needed; adding them later is additive.

### 4.6 `bb.http` and `bb.rpc` — wire surfaces

Routing mechanics: Hono routes cannot be added after boot (the `/api/v1` 404 catch-all in
`server.ts` shadows late registrations, and Hono has no route removal for reload). So the
server registers **fixed dispatcher routes at boot** — `app.all("/api/v1/plugins/:id/*")`
plus `GET /api/v1/plugins[/contributions]` — before the catch-all; dispatch goes through
the mutable per-plugin routing table built at bind. Reload = swap the table.

```ts
bb.http.route("POST", "/webhook", handler, { auth: "token" });
// → /api/v1/plugins/<id>/webhook
```

Auth modes (honest about today's server: `/api/v1` has no user auth at all):
- `"local"` (default) — same trust level as the rest of the local API, hardened the cheap
  way: JSON-only content type on RPC (forces CORS preflight, which the existing allowlist
  denies) plus an Origin/Host check on `/api/v1/plugins/*` to blunt CSRF/DNS-rebinding —
  plugin RPC wired to `threads.spawn` is more dangerous than existing routes.
- `"token"` — per-plugin generated secret in a header/URL; for webhook endpoints.
- `"none"` — only for signature-verified webhooks (Slack/Linear both sign); the docs say
  exactly that.

RPC — the canonical typing pattern is a **hoisted factory** (a bare
`export type Rpc = typeof handlers` can't see inside the plugin factory's scope):

```ts
// server.ts
function makeHandlers(bb: BbPluginApi, db: Database) {
  return {
    listIssues: async (input: { filter: string }) => queryIssues(db, input.filter),
    startWork:  async (input: { issueId: string; projectId: string }) => {
      const t = await bb.sdk.threads.spawn({ /* §4.1 shape */ });
      return { threadId: t.id };
    },
  };
}
export type Rpc = ReturnType<typeof makeHandlers>;

export default function plugin(bb: BbPluginApi) {
  const db = bb.storage.sqlite();
  bb.rpc.register(makeHandlers(bb, db));
}
```

Inputs/outputs are constrained to JSON-serializable types; the client-side type is
`Promise<Jsonify<Output>>`. `bb plugin new` scaffolds this shape so nobody rediscovers it.

### 4.7 `bb.realtime` — push to the frontend

```ts
export type Channels = { "issues-updated": { count: number } };
bb.realtime.publish<Channels>("issues-updated", { count: 42 });
// app side: useRealtime<Channels>("issues-updated", (p /* { count: number } */) => …)
```

This is a **contract addition**, not a ride-along: change kinds are closed enums with
strict validation and no payload field (`packages/domain/src/change-kinds.ts`,
`hub.ts:712`). V1 adds a new ephemeral WS message type (`plugin-signal`, precedent:
`threadOpenFileSignalSchema` / `notifyThreadOpenFile`) plus a plugin subscription target
in `@bb/domain` + `@bb/server-contract`. `plugin-reloaded` similarly joins
`SYSTEM_CHANGE_KINDS` (distinct from `ui-reloaded`, which hard-reloads the page via the
recovery shim — plugin dev iterations must not).

### 4.8 `bb.background` — services and schedules

```ts
bb.background.service("slack-socket", {
  async start(signal) { /* long-lived connection; resolve on abort */ },
});
bb.background.schedule("sync-issues", "*/5 * * * *", async () => { … });
```

Services start after bind, get an AbortSignal on disable/reload/shutdown (awaited per the
§3 reload sequence), auto-restart with backoff on crash, and can set
`needs-configuration` status. Schedules get their own small `plugin_schedules` table using
the automation sweep's compare-and-swap claiming **pattern** (`expectedNextRunAt` CAS),
driven from the existing periodic-sweeps loop — deliberately *not* the automations table:
that sweep exits without an enrolled primary host (plugin crons doing pure HTTP must run
host-less), requires a projectId, and emits user-facing automation notifications. Schedule
run status surfaces in `bb plugin list`, not the automations UI.

### 4.9 Host-rendered UI contributions (no frontend bundle required)

```ts
bb.ui.registerThreadAction({
  id: "run-tests", title: "Run tests", icon: "beaker",
  confirm: "Send a test-run request to this thread?",        // optional
  async run({ threadId, projectId }) {
    await bb.sdk.threads.send({ threadId, mode: "followUp", input: [...] });
    return { toast: { kind: "success", message: "Tests requested" } };
  },
});
```

The host renders a pending state while `run` is in flight, an automatic error toast on
rejection, the optional declarative `confirm` step, and the returned toast. Failures reach
the user at the point of interaction, not just the status badge.

> **REMOVED 2026-07-02** — `bb.ui.registerSlashCommand` (composer `/` commands with a
> `void | { insertText } | { send }` return contract) shipped in P2.4 and was deleted:
> skills cover the `/`-menu flow, and the agent-free macro niche stayed theoretical.

```ts
bb.ui.registerMentionProvider({
  id: "linear-issue", label: "Linear issues",
  async search({ query, projectId, threadId }) { return items; },  // {id,title,subtitle,icon}
  async resolve(id) { return { context: "…markdown…" }; },
});
```

Semantics: `resolve` runs once **at send**; its context attaches as an agent-visible,
user-collapsed prompt input (the visibility machinery exists in `promptInputSchema`);
resolve failure blocks send with a visible error; plugin items group under the provider
label in the existing mention popover. Honest sizing: this is a **contract change**, not
pure data-over-the-wire — the prompt-mention union (`PromptMentionSuggestion`,
`PromptTextMention.resource`) is closed across domain/server-contract/SDK and needs a
generic `{ kind: "plugin", pluginId, itemId, label }` resource end to end.

All contributions are served by `GET /api/v1/plugins/contributions` and rendered
generically by the shipped UI — the most stable tier.

## 5. Frontend architecture

### 5.1 Bundle build and loading

- `app.tsx` is compiled by **`bb plugin build`** (esbuild, owned by the bb CLI) to a
  single ESM file `dist/app.js`. Externals are handled by an **esbuild plugin that emits
  virtual shim modules** (esbuild has no native external-to-global): `react`,
  `react-dom`, `react-dom/client`, `react/jsx-runtime`, `react/jsx-dev-runtime`, and
  `@bb/plugin-sdk/app` map to shims reading `globalThis.__bbPluginRuntime`, with named
  export lists generated from the host React version at SDK release time. `bb plugin
  build` forces the production jsx-runtime; `bb plugin dev` uses jsx-dev-runtime, which
  the host also exposes. (Miss one of these and a second React lands in the page —
  "Invalid hook call" crashes that look like plugin bugs.)
- The bundle embeds the SDK version it was built against (`export const __bbSdk =
  { major, version }`); the host skips incompatible bundles with a "plugin needs update"
  badge instead of a TypeError.
- **Styling**: plugin components render in the host DOM, so theming comes free — all
  theme tokens (`--canvas`/`--ink` and the derived tokens in
  `apps/app/src/components/ui/theme.css`) are live CSS variables, and custom palettes
  (Nord, Dracula, …) apply to plugin UI automatically. `bb plugin build` runs its own
  Tailwind v4 pass over the plugin's sources and emits `dist/app.css`, loaded with the
  bundle — full Tailwind against host tokens (host-compiled classes already exist; new
  ones come from the plugin's own pass). Plugin docs carry the repo's token rules (derive
  colors from `--canvas`/`--ink` via `color-mix`; no hand-set achromatic literals).
- **Who builds `dist/`**: install-time build for `git:` and path sources; `npm:` packages
  must ship a prebuilt `dist/app.js` (recorded SDK version checked at load). On server
  boot after a BB upgrade, git/path bundles are rebuilt when their recorded SDK version
  differs; npm plugins with a mismatched major go `incompatible`.
- The host app sets `__bbPluginRuntime` during boot, fetches `GET /api/v1/plugins`
  (enabled plugins + content-hashed bundle URLs), and `import()`s each bundle; assets are
  served from `/api/v1/plugins/<id>/assets/app.js?h=<hash>` (404 for missing/errored
  plugins). Verified: no CSP blocks same-origin dynamic import today (desktop applies CSP
  only to internal viewer pages); any future CSP hardening must allowlist this path.
- **Error containment**: every slot mount is wrapped in a per-plugin ErrorBoundary — a
  throwing component collapses to a "plugin `<id>` crashed" chip and disables that slot
  for the session; a bundle that fails to import marks the plugin errored without
  touching the rest of the app.
- **Reload**: frontend registrations are keyed by plugin id and **replaced wholesale** on
  `plugin-reloaded` (drop old slot registrations, unmount, re-import with fresh hash,
  apply new) — never appended, or every dev save duplicates homepage sections. ESM modules
  can't be unloaded; the old module simply becomes unreferenced.
- **Dev loop**: `bb plugin dev` = jiti watch on the server entry (backend reload per §3) +
  esbuild watch on the app entry + the `plugin-reloaded` signal.

### 5.2 Slots (stable tier)

```tsx
// app.tsx
import { definePluginApp } from "@bb/plugin-sdk/app";
import type { Rpc } from "./server";

export default definePluginApp((app) => {
  app.slots.homepageSection({ id: "linear-issues", title: "Linear", component: IssuesCard });
  app.slots.navPanel({ id: "linear", title: "Linear", icon: "columns",
                       path: "linear", component: BoardView });
  app.slots.threadPanelTab({ id: "linear-issue", title: "Issue",
                             visible: ({ threadId }) => hasLinkedIssue(threadId),
                             component: ThreadIssueTab });
  app.slots.composerAccessory({ id: "linear-picker", component: IssuePicker });
});
```

V1 slot set with **versioned per-slot props contracts** (additive-only within a major):

| Slot | Props | Mount site |
| --- | --- | --- |
| `homepageSection` | `{ projectId: string \| null }` | `RootComposeSecondaryContent.tsx` |
| `navPanel` | `{}` (own route) | `AppRoutes` + `AppSidebar.tsx` (route + sidebar entry + nav state) |
| `threadPanelTab` | `{ threadId }`, `visible(ctx)` predicate | `SecondaryPanelTabStrip.tsx` (extends the typed panel-tab union — localized but not one-line) |
| `composerAccessory` | `{ projectId, threadId: string \| null }` | `PromptBoxInternal.tsx` (`footerStart` slot prop already exists) |
| `settingsSection` | auto-generated from settings schema | `SettingsView.tsx` |

Hooks from `@bb/plugin-sdk/app`: `useRpc<Rpc>()`, `useRealtime<Channels>()`,
`useSettings()` (secrets excluded), `useBbContext()` (current project/thread selection),
and `useBbNavigate()` with **typed helpers** (`toThread(id)`, `toPluginPanel(path)`) — no
guessed URL schemes. Plus the `@bb/plugin-sdk/app` **UI kit**: a curated re-export of BB
primitives (Button, Card, Tabs, EmptyState, Markdown, …), versioned with the SDK and
grown additively as heroes need components — this is the *stable* reuse surface. Internal
app components are deliberately not part of it (reachable internals become load-bearing —
the Obsidian lesson); they are reachable through the unstable module registry (§5.4)
instead.

### 5.3 `unstable_swizzle` (growth tier)

```tsx
app.unstable_swizzle("ThreadHeader", (Original) => (props) => (
  <>
    <MyBanner threadId={props.threadId} />
    <Original {...props} />
  </>
));
```

Mechanism: strategic host components are wrapped in `<Swizzleable name="…">` consulting a
runtime registry. Discipline that keeps it sane:

- The registry is **frozen at boot**: registrations collect during bundle import and apply
  once before the routed app mounts. Changing swizzles (install/reload) requires a full
  app reload — cheap and honest for an unstable tier, and it eliminates the
  late-registration remount hazard (a swizzle landing 2s in would remount `PromptBox` and
  wipe the user's draft).
- Each `Swizzleable` has its own per-plugin ErrorBoundary whose **fallback renders
  `Original` unwrapped** — a broken wrapper degrades to stock UI, never blanks the view.
- Composition order across plugins: sorted plugin id (deterministic), each wrapper
  receiving the layer below as `Original` (Docusaurus `@theme-original`, linearized at
  runtime). **Wrap-only — no eject.**
- Registering a name absent from the running build warns loudly (badge + log) instead of
  silently no-opping.

Props are whatever the host component takes and may change in any release.
`bb plugin swizzle --list` prints the names in the running build. Initial set:
`ThreadHeader`, `ThreadTimelineItem`, `PromptBox`, `AppSidebar`, `RootComposeView`.
Surfaces that prove popular get promoted into real slots with stable props — swizzling is
the telemetry for where the stable API grows.

**Eject.** Replacement needs no extra machinery — a wrapper that never renders `Original`
(`app.unstable_swizzle("ThreadHeader", () => MyThreadHeader)`) is eject semantics, built
against the plugin SDK. On top of that, `bb plugin swizzle eject <name>` copies the
component's source files into the plugin as a **reference starting point**, pulled from
the version-matched UI source (dev checkout, or the `ensureClonedUiSource` clone at the
`desktop-v<version>` tag that `bb ui fork` already uses); the author adapts its imports to
the plugin SDK by hand. Making ejected source compile *unmodified* is the partial-fork
tier — §5.4, scheduled as Phase 5.

### 5.4 `unstable_modules` — partial UI forks (Phase 5)

The full-power tier: the host exposes its internal module graph at runtime so a plugin
can eject a real slice of the UI — a component, a view, the whole homepage — edit the
copied source, and compile it against the live app.

- **Host side**: `import.meta.glob` over `apps/app/src` plus the source-exported
  workspace packages (`@bb/thread-view`, `@bb/core-ui`) builds a lazy path→module
  registry on `__bbPluginRuntime.unstable_modules`. Bundle cost is modest (most modules
  are already in the graph; the glob retains some otherwise-tree-shaken files and changes
  chunking).
- **Build side**: `bb plugin build` rewrites host-internal import specifiers in ejected
  code to top-level-await shims over the registry.
- **Why this beats vendoring**: the registry hands back the *live* host modules, so
  singletons stay correct — ejected code shares the host's Jotai atoms, query client, and
  router instead of dragging in second copies. This is the guarantee whole-app forking
  never had.
- **Fragility contract**: internal module paths and exports may change in any release —
  `unstable_` applies in full. What makes it sane is the degradation story already built
  in §5.1/§7: bundles are SDK-version-stamped, git/path plugins auto-rebuild at boot
  after a BB upgrade, a failed rebuild surfaces as plugin status (never a broken app),
  and the Swizzleable fallback renders stock UI. The `bb ui fork` experience with a
  safety net: an upgrade conflict downgrades one component to stock instead of holding
  the whole UI hostage on a rebase.

## 6. Distribution and CLI

```
bb plugin install npm:bb-plugin-linear@0.3.0
bb plugin install git:github.com/acme/bb-plugin-foo@v1
bb plugin install ./my-plugin          # registers the path (dev)
bb plugin list                         # status, wall-time, versions
bb plugin enable|disable|remove <id>
bb plugin reload [id]
bb plugin dev [path] | build [path] | new <name>
bb plugin logs <id> [-f]
bb plugin run <id> <argv…>             # explicit form of plugin CLI commands
bb plugin swizzle --list
```

npm installs go to `<dataDir>/plugins/npm/<name>@<version>/` via
`npm install --prefix --ignore-scripts --omit=optional` — `--ignore-scripts` kills
transitive postinstall execution (the user trusted the plugin author, not the whole npm
supply chain). **Native addons are unsupported in V1**: the packaged server runs under
`ELECTRON_RUN_AS_NODE` (Electron's ABI), so natively-compiled deps built by system npm
would die at load with `ERR_DLOPEN_FAILED`; `.node` load failures map to a specific
"native dependency unsupported" status. (`bb.storage.sqlite()` hands out the host's own
better-sqlite3 precisely so plugins never need their own.) `npm` on PATH is a documented
prerequisite for `npm:` installs. Git clones to `<dataDir>/plugins/git/<host>/<path>@<ref>`
and build at install time. Install requires a confirm that names the plugin, version,
entries, skills, CLI commands — and states the full-trust reality (§4.2 honesty note).
Engine mismatches **hard-fail install** (a warning that guarantees a later load failure
is worse than a refusal).

Scaffold (`bb plugin new`): `package.json` manifest, `server.ts` with the
`makeHandlers`/`Rpc` pattern, `app.tsx`, a skill stub, tsconfig resolving the types-only
`@bb/plugin-sdk`, dist gitignore, and an example test against `@bb/plugin-sdk/testing` —
`createTestPluginHost()` with in-memory sqlite KV, fake settings, and recorded sdk calls
(consistent with the repo's real-DB testing rule).

Discoverable surfaces to update in the same change (AGENTS.md rule): `bb-guide-*` CLI
guide templates (plugin-commands chapter), the `bb-cli` builtin skill,
`docs/configuration.md`.

## 7. Versioning and stability

- `@bb/plugin-sdk` is published (types + frontend runtime + esbuild shim data). Its
  **major** is the plugin API version. Checks run at install **and at every boot/load**
  (§3), mapping failures to `incompatible` — never a stack trace.
- Frontend bundles carry their build-time SDK version (§5.1); the host refuses stale
  bundles legibly.
- Stable surfaces: additive-only within a major; breaking changes bump the SDK major with
  a changelog migration note. `unstable_` surfaces may break in any release; the prefix is
  the entire ceremony.
- Backend skew is structurally impossible (the runtime shim is the live server
  implementation); frontend skew is confined to the pinned `__bbPluginRuntime` surface +
  typed wire contracts.

## 8. Hero plugin sketches (API validation)

**Linear** *(built, then REMOVED 2026-07-02 — superseded by the GitHub hero,
`examples/plugins/github`, which exercises the full stack without a third-party API
key)* — settings (`apiKey`, `teamKey`); sqlite issue cache; `background.schedule`
sync; `bb.cli.register` (`bb linear issues|start`) so agents and humans share the surface;
`registerMentionProvider` (@ENG-123 → issue context); rpc `listIssues/startWork`; slots:
`homepageSection`, `navPanel` board, `threadPanelTab` with `visible` predicate.

**Slack bot** — settings (`botToken` secret, `appToken` secret, `channelId`,
`mode` select, `project` picker); `background.service` socket-mode connection
(`needs-configuration` until tokens set); on mention → `threads.spawn`
(`origin: "plugin"`, project-default environment) or `send` to the standing thread;
`bb.on("thread.idle")` → post `lastAssistantText` to Slack. No `app` entry — headless
plugins are first-class.

**Small UX pack** — `registerThreadAction("Run tests")` with confirm + toast. First
plugin written end-to-end. (Its `/standup` slash command was removed with the
slash-command surface.)

**Agent enrichment** — `skills/` auto-imported; `bb.cli.register("docs", …)` as the
docs-search tool (primary surface); `addContext` injecting repo conventions (later removed); optionally
`registerTool` to compare the native path. No UI whatsoever.

## 9. Implementation phases

**Phase 1 — backend core.** Loader (jiti dep, sdk-runtime shim emitted by
`build-node-entry.mjs`, two-phase bind, §3 reload sequence, load timeout, status model),
`plugins`/`plugin_kv`/`plugin_settings`/`plugin_schedules` tables, CLI
(`install/list/enable/disable/reload/new/logs/run`), `bb.sdk` (+ `project-default`
environment + plugin origin contract changes), `settings` (+ secret-storage write
helpers), `storage`, `bb.on` events, `bb.background`, `bb.http`/`bb.rpc` (boot-time
dispatcher), `bb.log`, `bb.cli.register` + CLI proxying + generated plugin-commands
skill. Behind the `plugins` experiment.
*Exit criteria*: Slack bot and Agent-enrichment heroes run from `~/.bb/plugins`; server
survives a plugin that throws at load, in a handler, and during reload; reload while the
Slack socket is live neither double-connects nor leaks the sqlite handle; an agent thread
successfully runs a plugin CLI command via bash.
*Validation*: integration tests (in-memory SQLite + real server); regression test for the
reload sequence ordering; smoke: `bb plugin install ./examples/plugins/slack-bot`,
`bb plugin list` shows `running`, `bb <plugin> --help` renders from metadata.

**Phase 2 — agent contributions + host-rendered UI.** Skills auto-import (`plugin`
source tier + daemon-contract sourceType), `addContext` (later removed), `registerTool` (registry dispatch
in `internal/tool-calls.ts`, instructions-gating fix, zod param inference), contributions
endpoint + thread actions (pending/confirm/toast), slash commands (later removed),
mention providers (prompt-mention union contract change, resolve-at-send).
*Exit criteria*: Small-UX-pack hero fully works; a plugin CLI tool and a native tool are
each exercised by a real thread per provider (e2e verification across claude-code, codex,
pi, acp); `@`-mention search hits a plugin provider and the resolved context reaches the
agent.
*Validation*: regression test that a second registered dynamic tool dispatches correctly;
UI test for thread action pending/error states.

**Phase 3 — frontend runtime.** `__bbPluginRuntime` + esbuild shim plugin (full externals
list incl. jsx-dev-runtime), plugin Tailwind pass (`dist/app.css`), bundle versioning +
install-time/boot-time build policy,
`bb plugin build/dev`, `plugin-signal` + `plugin-reloaded` contract additions, slot mounts
(5 slots incl. secondary-panel tab-union extension), `@bb/plugin-sdk/app` hooks
(`useRpc/useRealtime/useSettings/useBbContext/useBbNavigate` + UI-kit re-exports),
per-plugin ErrorBoundaries, replace-wholesale frontend reload.
*Exit criteria*: Linear hero complete end-to-end.
*Validation*: kill-switch test (throwing slot component → chip, app alive); reload twice →
exactly one homepage section; stale-bundle test (old `__bbSdk` major → "needs update"
badge, no crash).

**Phase 4 — swizzle + fork deprecation.** `Swizzleable` boundaries (initial five),
boot-frozen registry, Original-fallback error boundaries, `bb plugin swizzle --list`,
`bb plugin swizzle eject <name>` (reference-copy from version-matched UI source);
deprecate `bb ui fork` in CLI output and docs; removal once heroes + one real swizzle
user confirm parity.
*Exit criteria*: a demo plugin wraps `ThreadHeader` in the packaged app; a second demo
fully replaces it from an ejected reference copy; a throwing wrapper degrades to stock
`ThreadHeader`; fork deprecation notice shipped.

**Phase 5 — partial UI forks.** `unstable_modules` registry (`import.meta.glob` over app
src + `@bb/thread-view`/`@bb/core-ui`), host-internal import rewriting in
`bb plugin build`, eject-that-compiles.
*Exit criteria*: a plugin ejects `RootComposeView`, meaningfully edits it, and survives a
BB upgrade via the boot-time rebuild path; a deliberately broken rebuild degrades to
stock UI with a legible `error` status.
*Validation*: singleton test (ejected component observes the same query-client/atom state
as the host); upgrade-simulation test (bump recorded SDK version, assert rebuild
triggers).

## 10. Risks and open questions

- **In-process blast radius**: a busy-loop or heavy synchronous sqlite use stalls
  everything. Mitigated by visibility (per-invocation wall-time in `bb plugin list`), WAL
  + busy_timeout, KV size caps; worker offload deliberately deferred — the async-first API
  keeps that door open.
- **Event loss during reload**: `thread.idle` fired mid-reload is dropped (documented).
  If heroes hit this in practice, add a short replay buffer keyed on last-seen event id.
- **Provider parity for native tools**: plumbing exists in all four adapters; e2e behavior
  (esp. mid-session tool-set changes) needs Phase-2 verification per provider. CLI
  commands sidestep this entirely.
- **npm-less machines**: `npm:` installs require npm on PATH (documented); git/path
  sources work without it.
- **Localhost security posture**: the entire local API is unauthenticated today; plugin
  routes inherit that with cheap hardening (JSON-only RPC, Origin/Host checks). A real
  session-auth layer is a separate product decision this design does not depend on.
