---
name: bb-plugin-authoring
description: Write, build, and install bb plugins. Use whenever the task is to create a bb plugin, extend bb itself, or add a bb CLI command, agent tool, background service, settings, panel, mention provider, or other bb surface via a plugin. Covers the entire backend BbPluginApi and the frontend @bb/plugin-sdk/app contract with working patterns.
---

# Authoring bb plugins

A bb plugin is a TypeScript package running in-process inside the bb server.
Its backend entry default-exports a factory that receives the full plugin API
(`bb`); an optional frontend entry registers React UI inside the bb app.
Plugins are full-trust code: they can read all local bb data.

Plugins are gated behind the "Plugins" experiment (Settings → Experiments).
`bb plugin list` tells you if plugins are disabled.

## Quickstart

```
bb plugin new hello            # scaffolds ./bb-plugin-hello (add --app for a frontend entry)
cd bb-plugin-hello
bb plugin install .            # registers the directory in place (--yes to skip the prompt)
bb plugin dev                  # watch loop: rebuild frontend (if any) + reload on every save
```

The manifest is `package.json`:

```json
{
  "name": "bb-plugin-hello",
  "version": "0.1.0",
  "type": "module",
  "engines": { "bb": ">=0.9" },
  "bb": { "server": "./server.ts", "app": "./app.tsx", "skills": ["skills"] }
}
```

- `bb.server` (required) — backend entry. Path installs load it as
  TypeScript directly (no build step); `bb plugin build` also emits a
  self-contained `dist/server.js` + `server.meta.json` that git/npm installs
  prefer when its SDK major matches, so consumers never need npm or
  node_modules. `bb.app` (optional) — frontend entry compiled by
  `bb plugin build` into `dist/app.js` + `app.css` + `app.meta.json`; path
  and git installs build it automatically at install time.
- `bb.skills` (optional) — relocates the auto-imported skills directories
  (default `skills/`; `[]` opts out). Every `skills/<name>/SKILL.md` is
  injected into agent threads as the plugin skills tier.
- Logo (optional, convention over configuration) — a `logo.svg`, `logo.png`,
  or `logo.webp` at the plugin root (that precedence) is auto-detected and
  shown wherever bb renders your plugin's contributions: the sidebar entry,
  the panel title bar, composer command/mention menus, thread action
  buttons, and Settings → Plugins. `bb.logo: "./assets/mark.svg"` relocates
  it (svg/png/webp only; anything else fails the manifest). An optional
  dark-theme variant — `logo-dark.svg` / `logo-dark.png` / `logo-dark.webp`
  at the root (same precedence), or `bb.logoDark` (same rules) — is
  preferred whenever the app is in dark mode, falling back to the light
  logo. Without a logo, contributions fall back to their named `icon` hint
  or a generic bolt. Picked up on `bb plugin reload`.
- `engines.bb` — semver range checked against the bb version at load.
- The plugin id is the package name minus the `bb-plugin-` prefix
  (`bb-plugin-hello` → `hello`); it namespaces routes, storage, settings,
  and CLI commands.

The scaffold ships the full API as bundled type declarations in `types/`
(`bb-plugin-sdk.d.ts`, plus `bb-plugin-sdk-app.d.ts` for `--app`); its
`tsconfig.json` maps `@bb/plugin-sdk` to them, so `npm install && npx tsc
--noEmit` typechecks anywhere — no bb checkout required. Those `.d.ts` files
are the authoritative, exhaustive surface: read them (or the source at
<https://github.com/ymichael/bb>, cloned) when you need an exact signature or
a symbol this skill doesn't cover. Backend imports from `@bb/plugin-sdk` MUST
be type-only (`import type { BbPluginApi } from "@bb/plugin-sdk"`); they are
erased when the server loads the file, so `server.ts` runs as-is with zero
runtime dependencies.

On-disk state per plugin: `<dataDir>/plugins/<id>/data.db` (its SQLite),
`secrets/` (secret settings + HTTP token), `logs/plugin.log` (JSONL,
rotated at 5MB). Settings edits never auto-reload — `bb plugin reload <id>`
after configuring.

## The backend factory

```ts
import type { BbPluginApi } from "@bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  // Register surfaces here. Load-safe: settings, storage, http, rpc,
  // realtime, background, cli, agents, ui, status, on, onDispose.
  // bb.sdk works here in the real server, but prefer it in handlers/services
  // (bind-gated — see below).
}
```

The factory runs at load/reload/enable (time-boxed 30s). A throwing factory
puts the plugin in `error` status with the message as the detail. `bb.pluginId`
is the plugin's own id.

### bb.log

`bb.log.debug|info|warn|error(message: string)` — goes to the server log
(prefixed `[plugin:<id>]`) and to the per-plugin JSONL file behind
`bb plugin logs <id> [-n N] [-f]`.

### bb.settings

`bb.settings.define(descriptors)` declares plain-data descriptors (rendered
in Settings → Plugins and editable via `bb plugin config <id> set <key>
<value>`). Four descriptor types:

```ts
const settings = bb.settings.define({
  apiKey: { type: "string", label: "API key", secret: true },      // 0600 file, never in db or frontend
  teamKey: { type: "string", label: "Team", default: "" },
  mode: { type: "select", label: "Mode", options: ["fast", "slow"], default: "fast" },
  verbose: { type: "boolean", label: "Verbose", default: false },
  project: { type: "project", label: "Project" },                  // project picker, stores a proj_* id
});
const { apiKey, teamKey } = await settings.get();  // load-safe; re-read inside handlers for freshness
settings.onChange((next, prev) => { /* fires after a settings save */ });
```

Typing rule: a descriptor **with** `default` yields a non-optional value
from `get()`; without one the value is `string | boolean | undefined` — so
give non-secrets defaults and handle missing secrets explicitly.

### bb.storage

- `bb.storage.kv` — namespaced JSON key-value rows in bb.db:
  `get<T>(key)`, `set(key, value)`, `delete(key)`, `list(prefix?)`. Values
  are capped at **256KB each** — kv is for cursors, links, and small state;
  caches and datasets go in sqlite.
- `bb.storage.sqlite()` — the plugin's own better-sqlite3 database at
  `<dataDir>/plugins/<id>/data.db` (WAL, busy_timeout 5000). Handles are
  host-tracked and closed on reload; a closed handle throws.
- `bb.storage.migrate(db, statements)` — statement index = migration id;
  unapplied statements run in one transaction. **Append-only**: never
  reorder or edit shipped statements, only push new ones.

```ts
const db = bb.storage.sqlite();
bb.storage.migrate(db, [
  `CREATE TABLE IF NOT EXISTS issues (id TEXT PRIMARY KEY, title TEXT NOT NULL)`,
]);
```

### bb.sdk

The full bb SDK bound to this server over loopback — threads, projects,
providers, etc. **Bind-gated**: reading `bb.sdk` before the host binds it
throws. The real server binds it before loading plugins, so it is available
from the moment factories run there — but isolated harnesses may not, so
prefer using it from handlers, services, timers, and event handlers for
portability.

```ts
const thread = await bb.sdk.threads.spawn({
  projectId,
  environment: { type: "project-default" },   // server resolves the project's default environment
  prompt: "Work on this issue…",              // prompt XOR input — exactly one
  title: "ENG-42: fix the flaky test",
});
```

`threads.spawn` takes `prompt` (a string) or `input` (structured prompt
inputs) — never both. Attribution is auto-filled: `origin: "plugin"` and
`originPluginId: <your id>` unless you set them. `bb.sdk.threads.send({
threadId, mode: "auto", input: [...] })` starts a turn on an idle thread or
queues/steers a running one.

### bb.on — thread lifecycle events

```ts
bb.on("thread.created", ({ thread }) => { ... });
bb.on("thread.idle", ({ thread, lastAssistantText }) => { ... });   // lastAssistantText: string | null
bb.on("thread.failed", ({ thread, error }) => { ... });             // error: string | null
```

Exactly three events. Observe-only: handlers run fire-and-forget after the
transition and can never block or veto it. `thread` is the same DTO
`GET /api/v1/threads/:id` serves. Errors are caught, logged, and counted in
the plugin's handler stats (`bb plugin list`).

### bb.http — HTTP routes

`bb.http.route(method, path, handler, { auth? })` mounts an exact-match
route (no params/wildcards) at `/api/v1/plugins/<id>/http/<path>`. The
handler is a Hono handler: `(context) => Response | Promise<Response>`.
Auth modes:

- `"local"` (default) — request must come from a local bb app origin.
  Right for anything the bb frontend calls.
- `"token"` — requires the per-plugin token (`bb plugin token <id>`;
  `--rotate` generates a new one, invalidating the old) via the
  `x-bb-plugin-token` header or `?token=`. Right for external scripts
  and machines you control.
- `"none"` — no checks. ONLY for webhooks that verify their own signature
  (e.g. Slack's `x-slack-signature` HMAC) inside the handler.

### bb.rpc — the frontend data plane

`bb.rpc.register({ methodName(input) { ... } })` serves POST
`/api/v1/plugins/<id>/rpc/<method>` with local-auth semantics. The JSON body
is the input; the return value is wrapped as `{ ok: true, result }` (or
`{ ok: false, error }` when the handler throws). Inputs and outputs must
survive a JSON round-trip. Inputs arrive untyped — declare handler
parameters as `unknown` and narrow at the top (hoist a `function
makeHandlers()` returning the record if you want shared types between
handlers):

```ts
bb.rpc.register({
  listIssues(input: unknown) {
    const filter = typeof (input as { filter?: unknown })?.filter === "string"
      ? (input as { filter: string }).filter : undefined;
    return { issues: listCachedIssues(filter) };
  },
});
```

### bb.realtime

`bb.realtime.publish(channel, payload)` broadcasts an ephemeral
`plugin-signal` WS message to every connected client; the frontend hook
`useRealtime(channel, handler)` receives it. Payload must be
JSON-serializable; nothing is persisted. Publish state-changed signals and
let the frontend refetch via rpc.

### bb.background — services and schedules

```ts
bb.background.service("worker", {
  async start(signal) {
    while (!signal.aborted) { await doWork(); await sleep(60_000, signal); }
  },
});
bb.background.schedule("sync", "*/5 * * * *", async () => { await syncNow(); });
```

- A **service** starts after the factory completes and must resolve when
  `signal` aborts (reload/disable/shutdown). A crash restarts it with
  capped exponential backoff.
- A **schedule** is a 5-field cron (server-local time) backed by a durable
  row keyed (pluginId, name) — it survives server restarts, and the sweep
  claims due rows with a compare-and-swap, but it only fires while the
  plugin is loaded.
- Semantics differ on throw: a service throwing `NeedsConfigurationError`
  transitions the whole plugin to `needs-configuration` and stops
  restarting until the next load; a schedule throw (any error) only lands
  in the schedule's `last_status`/`last_error` shown by `bb plugin list`.
- `NeedsConfigurationError` is matched **by name**, so no runtime import is
  needed: `throw Object.assign(new Error(msg), { name:
  "NeedsConfigurationError" })`. Pair it with `bb.status.needsConfiguration`
  in the factory so an unconfigured plugin reports itself instead of
  crash-looping:

```ts
const initial = await settings.get();
if (!initial.apiKey) bb.status.needsConfiguration("Set apiKey with `bb plugin config <id>`, then reload.");
```

### bb.cli — an agent-facing `bb` subcommand

One top-level command per plugin (a second `register` replaces the first).
Users and agents run `bb <name> …` like any core command; the bb CLI
proxies it to the server, where `run` executes.

```ts
bb.cli.register({
  name: "weather",                       // lowercase [a-z0-9-]+; core names (thread, plugin, …) are reserved
  summary: "Weather lookups",
  commands: [                            // help/skill metadata only; parsing argv is yours
    { name: "today", summary: "Today's weather", usage: "bb weather today <city>" },
  ],
  async run(argv, ctx) {
    // argv EXCLUDES the command name: `bb weather today sf` → argv = ["today", "sf"]
    // ctx: { cwd?, threadId?, projectId? } — whatever the invoking CLI knew
    return { exitCode: 0, stdout: "sunny" };   // { exitCode, stdout?, stderr? }
  },
});
```

Agents discover plugin commands through the server-generated
`plugin-commands` skill, which lists each command's `summary` and the
`commands` usage lines — fill both in. Caveat: in a `readonly`-sandboxed
thread the sandbox blocks loopback network, so `bb` CLI calls (including
plugin commands) fail there; agent flows that need the CLI want
workspace-write.

### bb.agents — native tools

To give agents standing knowledge (conventions, workflows), ship a
`skills/` directory — there is deliberately no per-turn instruction
injection API. For schema'd capabilities, register a native tool:

```ts
import { z } from "zod";   // runtime import — declare zod as a plugin dependency
bb.agents.registerTool({
  name: "docs_search",                    // [a-zA-Z0-9_-]+, unique ACROSS plugins
  description: "Search the bundled docs.",
  instructions: "Prefer docs_search over guessing conventions.",  // optional, appended to thread instructions
  parameters: z.object({ query: z.string().min(1) }),
  async execute({ query }, { threadId, projectId, signal }) {
    return excerpts.join("\n");           // or { content: [{ type: "text", text }], isError? }
  },
});
```

`parameters` is a zod schema (zod 4; validated per call — bad model args
become a tool error, not a plugin crash) or a plain JSON-schema object
(execute then receives raw `unknown`). Tool-set changes apply on the NEXT
session start, not mid-session. Name collisions: within a plugin the later
registration replaces the earlier; across plugins the earlier plugin wins
and yours is dropped with the reason in your status detail.

### bb.ui — host-rendered UI (no frontend bundle needed)

```ts
bb.ui.registerThreadAction({
  id: "summarize", title: "Summarize thread", icon: "ListChecks",
  confirm: "Ask the agent for a summary?",             // optional confirm dialog
  async run({ threadId, projectId }) {
    return { toast: { kind: "success", message: "Requested." } };  // throw → automatic error toast
  },
});

bb.ui.registerMentionProvider({
  id: "issue", label: "Issues",
  search({ query, projectId, threadId }) {             // as-you-type after "@"; 2s time box, failure = empty list
    return [{ id: "42", title: "ENG-42 Fix flake", subtitle: "Todo" }];
  },
  resolve(itemId) {                                    // once per unique item AT SEND TIME
    return { context: "# ENG-42…" };                   // attached as agent-only context; throwing BLOCKS the send
  },
});
```

Thread actions render in the thread header; mention items under `label`
in the `@` menu. All handlers run server-side. There is deliberately no
plugin slash-command surface: the composer's `/` menu lists skills, so a
plugin capability that crafts a prompt for the agent ships as a `skills/`
entry instead.

### bb.status

`bb.status.needsConfiguration(message)` — mark the plugin
`needs-configuration` (shown in `bb plugin list` and the UI) instead of
failing. Cleared on the next load.

### bb.onDispose and the reload lifecycle

`bb.onDispose(hook)` registers cleanup; hooks run **LIFO**. On
reload/disable/shutdown the host: aborts background services and awaits
them (bounded), runs dispose hooks LIFO (each isolated), drains in-flight
http/rpc/event handlers, closes every `storage.sqlite()` handle, then
invalidates the old `bb` handle and (on reload) calls the factory fresh. A
captured `bb` from a previous load throws `PluginContextStaleError` on use
— never stash the API object in module-level state that outlives a load.

## Frontend (`bb.app` entry)

`app.tsx` default-exports `definePluginApp` from `@bb/plugin-sdk/app`.
React and the SDK are **never bundled** — `bb plugin build` shims them to
the host's shared runtime, so the bundle only works inside bb.

```tsx
import { definePluginApp, useRpc, useRealtime, useSettings, useBbContext, useBbNavigate } from "@bb/plugin-sdk/app";
import { toast } from "sonner";                      // shimmed to the host toaster
import { Button } from "@/components/ui/button";    // vendored source YOU own
import { Dialog, DialogContent } from "@/components/ui/dialog";

export default definePluginApp((app) => {
  app.slots.homepageSection({ id: "issues", title: "Open issues", component: IssuesSection });
  app.slots.navPanel({ id: "board", title: "Board", icon: "Columns", path: "board", component: Board });
  app.slots.threadPanelTab({ id: "issue", title: "Issue", component: IssueTab, visible: ({ threadId }) => linked.has(threadId) });
  app.slots.composerAccessory({ id: "hint", component: Hint });
});
```

Slot props contracts (versioned, additive-only):

- `homepageSection` → `{ projectId: string | null }` (project in view on
  the compose surface). Registration: `{ id, title, component }`.
- `navPanel` → `{}` — owns the whole route at `/plugins/<pluginId>/<path>`
  and gets its own sidebar entry.
  Registration: `{ id, title, icon, path, component, chrome?, headerContent? }`.
  The host renders your plugin logo + `title` into the SHARED app header
  (the same chrome as Settings/Automations) with your optional
  `headerContent` component as the header actions on the right — so do NOT
  repeat the title inside your component; the body below is yours,
  full-width. `headerContent` is plugin code inside host chrome and is
  contained separately: a throw hides the accessory without breaking the
  header or the panel body. `chrome: "page"` (the default) gives the body
  the standard page padding at full width — wrap your content in a
  `mx-auto w-full max-w-3xl space-y-4` div to opt back into the classic
  centered, width-capped column instead; `chrome: "none"` is the escape hatch — your
  `component` owns the ENTIRE body region with zero host padding
  (`headerContent` is ignored; the shared header still shows logo + title)
  and only the crash boundary remains.
- `threadPanelTab` → `{ threadId: string }` — a tab in the thread's right
  panel. Registration: `{ id, title, component, visible? }`; `visible` is
  **synchronous**, runs per render, and a throw hides the tab.
- `composerAccessory` → `{ projectId: string | null, threadId: string | null }`
  — rendered in the composer footer. Registration: `{ id, component }`.

Hooks:

- `useRpc()` → `{ call(method, input?) }` — calls your `bb.rpc` methods;
  untyped (`Promise<unknown>`) in V1, narrow the result yourself.
- `useRealtime(channel, handler)` — fires for this plugin's
  `bb.realtime.publish(channel, …)` signals while mounted.
- `useSettings()` → `{ values, isLoading }` — effective non-secret values
  (secret settings are excluded; read them server-side only).
- `useBbContext()` → `{ projectId, threadId }` from the current route.
- `useBbNavigate()` → `{ toThread(id), toProject(id), toPluginPanel(path) }`.

UI components — **vendored shadcn source you own** (the shadcn model; the
old host-provided component kit is REMOVED — `@bb/plugin-sdk/app` exports
only `definePluginApp` + the hooks):

- `bb plugin new --app` pre-vendors button, card, input, dialog (plus their
  support files: `lib/utils`, `lib/portal-scope`, icon, responsive-overlay,
  drawer, hooks) into `components/ui/` etc., and writes a `components.json`
  whose `@bb` registry is pinned to the release tag matching the running
  BB. Import via the `@/*` alias: `import { Button } from
  "@/components/ui/button"` (tsconfig maps it; `bb plugin build` reads it).
- Add more with stock shadcn tooling: `npx shadcn add @bb/select
  @bb/table` — the BB registry carries the full stock set (~44 items:
  accordion, alert-dialog, calendar, chart, command, form, sheet, table,
  …), generated from the BB app's own component source, so vendored code is
  version-matched to your BB by construction. Edit the copies freely; they
  never change out from under you. Re-running `shadcn add` is the manual
  update path.
- `toast`: `import { toast } from "sonner"` — runtime-shimmed to the host's
  Toaster (`toast.success("Saved")` just works; never mount your own
  `<Toaster>`).
- Never bundled (runtime-shimmed, import freely): react, the portaling
  radix families (`@radix-ui/react-dialog`, `-alert-dialog`, `-popover`,
  `-select`, `-dropdown-menu`, `-context-menu`, `-menubar`, `-hover-card`,
  `-tooltip`, `-navigation-menu`), `sonner`, `vaul`. Your vendored overlays
  therefore share the host's dismissable-layer/focus/scroll-lock world —
  stacking against host overlays behaves correctly.
- Everything else bundles from YOUR `node_modules` (hugeicons, lucide,
  cva/clsx/tailwind-merge, form/calendar/chart libs): run `npm install`
  after adding components (`bb plugin new` runs the first one; `shadcn add`
  installs each item's declared deps). Consumers never need npm — ship your
  built `dist/`.
- Styling: Tailwind classes compile against the host theme's live CSS
  variables (`bg-background`, `text-muted-foreground`, `rounded-lg`, and
  `animate-in`/`fade-in-0` via tw-animate-css) — derive colors from theme
  tokens, never hardcoded grays.
- The old bb extras (`EmptyState`, `Markdown`, `PageBody`, `Spinner`) are
  gone — write your own (each is a few lines; see
  `examples/plugins/github/components/` for reference implementations).

One deviation from stock shadcn: `Dialog` renders as a bottom drawer on
compact viewports (the host's responsive behavior) — same API.

Crash isolation: each slot mounts inside an ErrorBoundary — a throwing
component collapses to a "plugin <id> crashed" chip; the rest of the app
(and other plugins) stay alive.

The sync `visible()` pattern (threadPanelTab): `visible` is synchronous but
"should this tab show?" is usually server state. The canonical answer:
keep a module-level cache
(e.g. `let linked: Set<string> | null`), prime it once at bundle load from
a backend rpc like `listLinks` — guarded with `typeof document !==
"undefined"` so evaluating the bundle outside a browser is side-effect
free — refresh it on a realtime signal, update it optimistically after
mutations, and have `visible()` do a pure cache read (false until loaded,
so no dead tab ever flashes).

Styling: Tailwind classes compile against the host theme's live CSS
variables — use host token classes (`bg-card`, `text-foreground`,
`text-muted-foreground`, `border-border`, `text-destructive`, …). Never
define custom `@theme` colors and never hand-set `oklch(...)`/gray
literals: the build's Tailwind pass emits default-theme utilities only, and
hardcoded colors break custom palettes.

## Testing a plugin

- `bb plugin dev` is the loop: save → rebuild (if `bb.app`) → reload; open
  app pages pick new UI up live. Build/reload failures print and keep
  watching.
- `bb plugin list` shows status, services, schedules (with last_error),
  handler stats, and the CLI command; `bb plugin logs <id> -f` follows
  `bb.log` output. Add `--json` to any plugin command for machine output.
- Exercise wire surfaces directly: `curl -X POST -H "content-type:
  application/json" -d '{}' <server>/api/v1/plugins/<id>/rpc/<method>`,
  `bb <command> …` for the CLI, `bb plugin run <id> …` as the explicit form.
- Keep pure logic in plain functions/modules so it is unit-testable without
  a bb server; the factory file should mostly wire registrations.

Reference examples in `examples/plugins/` (a bb checkout):

- `github` — vendored-component showcase: a gh-CLI-backed issue/PR browser
  in a single navPanel (with `headerContent`), hash-based sub-navigation,
  vendored Tabs/Select/DropdownMenu/Badge/Skeleton + sonner toast
  throughout, background sync service, rpc + realtime, project setting, a
  `bb github` CLI command, and agent-spawn buttons.
- `slack-bot` — headless webhook bot: `auth: "none"` route with signature
  verification, kv thread mapping, `thread.idle` handler, spawn/send,
  needsConfiguration.
- `agent-enrichment` — agent surfaces: CLI command, zod-schema native tool,
  docs mention provider, boolean setting, bundled `skills/` directory.
- `small-ux-pack` — dependency-free host-rendered UI: two thread actions
  (confirm + toast, and the automatic error-toast path).

## Gotchas

- `bb.sdk` is bind-gated: the real server binds it before plugins load, so
  factories can use it there, but isolated harnesses may not — prefer
  handlers, services, and timers.
- kv values cap at 256KB; put caches and datasets in `storage.sqlite()`.
- `storage.migrate` is append-only by statement index.
- Settings saves do NOT auto-reload the plugin; `bb plugin reload <id>`.
- Descriptors without `default` produce `| undefined` values.
- Thread events are observe-only; there are exactly three
  (`thread.created`, `thread.idle`, `thread.failed`).
- Service throw of NeedsConfigurationError changes plugin status; schedule
  throws only set the schedule's last_error. Name-matching means no import
  is needed for the error class.
- Schedules only fire while the plugin is loaded (rows are durable, the
  runner is not).
- CLI `run(argv)` argv excludes the command name; core bb command names
  are reserved; readonly-sandboxed agent threads cannot reach the bb CLI
  (no loopback network).
- Mention `search` is 2s-time-boxed; mention `resolve` runs at send time
  and a throw blocks the send.
- Agent tool changes apply on the next session start, not mid-session;
  cross-plugin tool-name collisions drop the later registration.
- rpc/realtime payloads must survive JSON.stringify.
- Handler stats shown by `bb plugin list` persist across reloads (reset on
  remove).
- The frontend Tailwind pass emits default-theme utilities only — style
  with host token classes, no custom `@theme` colors, no hand-set oklch.
- `onDispose` hooks run LIFO; stale `bb` handles from before a reload throw
  on use.
- Backend `@bb/plugin-sdk` imports must be type-only (erased at load);
  runtime imports there would fail outside a checkout. The scaffold
  tsconfig typechecks both `server.ts` and `app.tsx`.
