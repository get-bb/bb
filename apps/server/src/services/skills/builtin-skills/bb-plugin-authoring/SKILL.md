---
name: bb-plugin-authoring
description: Write, build, and install bb plugins. Use whenever the task is to create a bb plugin, extend bb itself, or add a bb CLI command, agent tool, background service, settings, panel, mention provider, or other bb surface via a plugin. Covers the entire backend BbPluginApi and the frontend @bb/plugin-sdk/app contract with working patterns.
---

# Authoring bb plugins

A bb plugin is a TypeScript package running in-process inside the bb server.
Its backend entry default-exports a factory that receives the full plugin API
(`bb`); an optional frontend entry registers React UI inside the bb app.
Plugins are full-trust code: they can read all local bb data.

User-installed plugins are gated behind the "Plugins" experiment (Settings →
Experiments). Builtin plugins ship with bb and can remain available under their
own product gates. `bb plugin list` tells you if plugins are disabled.

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
  "engines": { "bb": ">=0.9", "bbPluginSdk": "^0.2.0" },
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
- `bb.themes` (optional) — contributes palettes to Settings → Appearance and
  `bb theme list`. Each entry is
  `{ id, name, description?, css: "./themes/name.css" }`; bb namespaces its
  selectable id as `plugin:<plugin-id>:<id>`. Only loaded plugins contribute.
- Logo (optional, convention over configuration) — a `logo.svg`, `logo.png`,
  or `logo.webp` at the plugin root (that precedence) is auto-detected and
  shown wherever bb renders your plugin's contributions: the sidebar entry,
  the panel title bar, composer command/mention menus, thread action
  buttons, and Settings → Plugins. `bb.logo: "./assets/mark.svg"` relocates
  it (svg/png/webp only; anything else fails the manifest). An optional
  dark-theme variant — `logo-dark.svg` / `logo-dark.png` / `logo-dark.webp`
  at the root (same precedence), or `bb.logoDark` (same rules) — is
  preferred whenever the app is in dark mode, falling back to the light
  logo. Without a logo, manifest-level `bb.icon` is the plugin's canonical app
  icon across every host-rendered plugin surface; a contribution's own `icon`
  hint is the fallback when the manifest omits one. Unknown hints use a generic
  icon. Picked up on `bb plugin reload`. Inline icons
  must use `currentColor` for their stroke/fill and take their color from semantic
  text-token classes; never hardcode gray or palette values. An SVG loaded
  through `<img>` cannot inherit `currentColor`, so omit the logo and use a
  named `icon` hint when a monochrome glyph should match the surrounding bb
  chrome. Reserve logo assets for intentionally branded artwork (and provide
  a dark variant when needed).
- `engines.bb` — optional semver range checked against the bb app version.
- `engines.bbPluginSdk` — optional semver range for the plugin SDK surface
  (currently `0.2.0`; the scaffold writes `"^0.2.0"`). Absent means a legacy
  manifest. Managed (`git:`/`npm:`) installs **refuse** a mismatch against
  the running SDK; path installs surface it as `incompatible` at load.
  Compatible updates (`bb plugin outdated` / `bb plugin update`) only select
  candidates that satisfy these ranges; newer incompatible releases are
  reported as blocked rather than applied. Dev builds (bb `0.0.0`) skip
  enforcing `engines.bb` and annotate that on check results.
- **Manual updates:** `bb plugin outdated` checks tracking sources and
  `bb plugin update` applies compatible candidates (reinstall of an already
  installed managed plugin is refused). A failed activation **rolls back** to
  the previous state snapshot and records the failure for the user. Keep
  `engines.*` honest and ship load-safe factories so an update never strands
  users.
- `bb plugin build` stamps authoritative metadata into both
  `dist/server.meta.json` and `dist/app.meta.json`: `sdkMajor`, `sdkVersion`,
  `artifactFormatVersion` (currently `1`), `pluginId`, `pluginVersion`, and
  `builtWith: { bbVersion, pluginSdkVersion }`. Managed installs reject
  artifacts whose `pluginId`/`pluginVersion` disagree with the package
  manifest, or whose SDK major does not match the host.
- The plugin id is the package name minus the `bb-plugin-` prefix
  (`bb-plugin-hello` → `hello`); it namespaces routes, storage, settings,
  and CLI commands. Ids reserved by builtins (`automations`, `connect`,
  `custom-instructions`, `inline-vis`, `memory`, `secrets`) cannot be
  installed from a non-`builtin:` source — use `builtin:<name>` instead.

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

## Publishing to a marketplace

A marketplace is a directory (local path or git repo) whose root has
`marketplace.json`. Catalog schema version is currently **1**:

```json
{
  "schemaVersion": 1,
  "name": "my-market",
  "displayName": "My Market",
  "plugins": [
    {
      "id": "notes",
      "displayName": "Notes",
      "description": "Local notes",
      "source": { "npm": { "package": "bb-plugin-notes", "range": "^1.0.0" } },
      "category": "productivity",
      "installation": { "engines": { "bb": ">=0.9", "bbPluginSdk": "^0.2.0" } }
    }
  ]
}
```

- **source** — one of `npm` (`package`, optional `registry` / `range`), `git`
  (`url`, `ref`, optional `subdir`), or `path` (relative path **only** for
  local path marketplaces; remote/git catalogs cannot list path entries).
- **category** (optional) — free-form string; `bb plugin search` matches it.
- **installation.engines** (optional) — catalog-level `bb` / `bbPluginSdk`
  ranges. These **can narrow but never widen** the plugin package manifest's
  `engines.bb` / `engines.bbPluginSdk`: the catalog range must be a semver
  subset of the manifest range, or install is refused.

Users add your catalog with `bb plugin marketplace add <source>` (trust prompt
for remotes; add installs nothing), then `bb plugin search` / `bb plugin install
<entry>[@<marketplace>]`. See `bb guide plugins` for CLI details.

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
  apiKey: { type: "string", label: "API key", secret: true }, // 0600 file, never in db or frontend
  teamKey: { type: "string", label: "Team", default: "" },
  mode: {
    type: "select",
    label: "Mode",
    options: ["fast", "slow"],
    default: "fast",
  },
  verbose: { type: "boolean", label: "Verbose", default: false },
  project: { type: "project", label: "Project" }, // project picker, stores a proj_* id
});
const { apiKey, teamKey } = await settings.get(); // load-safe; re-read inside handlers for freshness
settings.onChange((next, prev) => {
  /* fires after a settings save */
});
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

### bb.server

Read-only facts about the running server. `bb.server.loopbackBaseUrl` is the
server's own loopback base URL (e.g. `http://127.0.0.1:38886`), which serves
the SPA + `/api` + `/ws` — for plugins that proxy or relay traffic back to
the server itself (the builtin connect plugin's tunnel is the canonical
user). **Bind-gated** like `bb.sdk`: reading it before the server is
listening throws, so prefer reading it from handlers, services, and timers.

### bb.hosts

Control-plane declarations for host-local daemon behavior. Use
`bb.hosts.declareSharedPorts(hostId, ports)` to replace this plugin's
desired loopback port set for one host. `ports` contains integers from 1–65535;
the server deduplicates and sorts them, owns the generation, and delivers the
resulting set to the daemon. The call fails with an actionable error if the
host has no bb connect machine enrollment.

Call `await bb.hosts.ensureSharedPortTunnel(hostId)` to lazily assign and read
the host's `{ label, baseDomain }` for constructing public URLs. The enrolled
daemon derives both from its trusted gate; plugins cannot choose a domain or
send tunnel identity toward a credential-bearing daemon connection.

Declarations are load-scoped: reload, disable, or shutdown clears them after
the plugin's own dispose hooks run. This is a control-plane API only; plugins
do not receive daemon streaming or socket primitives.

```ts
const tunnel = await bb.hosts.ensureSharedPortTunnel(hostId);
bb.hosts.declareSharedPorts(hostId, [3000, 4173]);
const url = `https://${tunnel.label}--3000.${tunnel.baseDomain}`;
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
  environment: { type: "project-default" }, // server resolves the project's default environment
  prompt: "Work on this issue…", // prompt XOR input — exactly one
  title: "ENG-42: fix the flaky test",
});
```

`threads.spawn` takes `prompt` (a string) or `input` (structured prompt
inputs) — never both. Attribution is auto-filled: `origin: "plugin"` and
`originPluginId: <your id>` unless you set them. `bb.sdk.threads.send({
threadId, mode: "auto", input: [...] })` starts a turn on an idle thread or
queues/steers a running one.

`bb.sdk.files` reads and writes files on a connected host (not just the
server machine — this is the right primitive when the user's files may live
on another host, and its `rootPath` confinement + compare-and-swap guard make
it the right save path even locally):

```ts
const file = await bb.sdk.files.read({ path: "/home/me/notes/todo.md" });
// → { content, contentEncoding, sha256, sizeBytes, modifiedAtMs?, ... }

const saved = await bb.sdk.files.write({
  path: "/home/me/notes/todo.md",
  rootPath: "/home/me/notes", // optional: confine writes beneath this root
  content: "# Todo\n",
  expectedSha256: file.sha256, // CAS guard; omit for unconditional, null for create-only
  mode: 0o600, // optional POSIX mode for a newly created file; existing mode is preserved
});
if (saved.outcome === "conflict") {
  // File changed since the read (saved.currentSha256, null = deleted) —
  // re-read and merge instead of clobbering.
}
```

`hostId` is optional everywhere (defaults to the primary/local host).
`bb.sdk.files.list({ path, query?, limit? })` is a recursive fuzzy file
listing under a directory. Writes cap at 25 MB and return
`{ outcome: "written", sha256, sizeBytes }`.

For filesystem-backed products that need a tree or mutations,
`bb.sdk.files.listPaths({ path, includeFiles, includeDirectories, ... })`
returns recursive relative paths with their kind. `mkdir`, `move`, and `remove`
apply the same optional `hostId` routing and `rootPath` confinement as
read/write. Mutations are not automatically retried; `move` refuses to replace
an existing destination, and `remove` requires `recursive: true` for non-empty
directories.

`bb.sdk.files.createPreview({ hostId?, rootPath, ttlMs? })` returns a temporary
path-shaped `baseUrl`. Append individually encoded relative path segments to
serve browser assets from that confined host root. This is the preferred
transport for plugin images and sandboxed HTML with sibling-relative assets;
preview URLs expire and never reveal the host id or absolute root.

### bb.on — thread lifecycle events

```ts
bb.on("thread.created", ({ thread }) => { ... });
bb.on("thread.idle", ({ thread, lastAssistantText }) => { ... });   // lastAssistantText: string | null
bb.on("thread.failed", ({ thread, error }) => { ... });             // error: string | null
bb.on("thread.deleted", ({ thread }) => { ... });
```

Exactly four events. Observe-only: handlers run fire-and-forget after the
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
    const filter =
      typeof (input as { filter?: unknown })?.filter === "string"
        ? (input as { filter: string }).filter
        : undefined;
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
    while (!signal.aborted) {
      await doWork();
      await sleep(60_000, signal);
    }
  },
});
bb.background.schedule("sync", "*/5 * * * *", async () => {
  await syncNow();
});
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
if (!initial.apiKey)
  bb.status.needsConfiguration(
    "Set apiKey with `bb plugin config <id>`, then reload.",
  );
```

### bb.cli — an agent-facing `bb` subcommand

One top-level command per plugin (a second `register` replaces the first).
Users and agents run `bb <name> …` like any core command; the bb CLI
proxies it to the server, where `run` executes.

```ts
bb.cli.register({
  name: "weather", // lowercase [a-z0-9-]+; core names (thread, plugin, …) are reserved
  summary: "Weather lookups",
  commands: [
    // help/skill metadata only; parsing argv is yours
    {
      name: "today",
      summary: "Today's weather",
      usage: "bb weather today <city>",
    },
  ],
  async run(argv, ctx) {
    // argv EXCLUDES the command name: `bb weather today sf` → argv = ["today", "sf"]
    // ctx: { cwd?, threadId?, projectId? } — whatever the invoking CLI knew
    return { exitCode: 0, stdout: "sunny" }; // { exitCode, stdout?, stderr? }
  },
});
```

Agents discover plugin commands through the server-generated
`plugin-commands` skill, which lists each command's `summary` and the
`commands` usage lines — fill both in. Caveat: in a `readonly`-sandboxed
thread the sandbox blocks loopback network, so `bb` CLI calls (including
plugin commands) fail there; agent flows that need the CLI want
workspace-write.

### bb.interactions — replace the composer with a blocking plugin form

Use `bb.interactions.request({ threadId, rendererId, title, payload, timeoutMs? },
{ signal? })` when plugin backend code must wait for sensitive or structured
user input. The promise resolves to `{ outcome: "submitted", value }` or
`{ outcome: "cancelled", reason }`. Payloads and responses are JSON values
capped at 64 KiB; response values are delivered only to the waiting plugin
invocation and are never persisted. Pair `rendererId` with a frontend
`pendingInteraction` slot. Pass a CLI handler's `ctx.signal` so disconnecting
the caller cancels the request.

### bb.agents — native tools and dynamic instructions

To give agents standing knowledge (conventions, workflows), ship a
`skills/` directory. For schema'd capabilities, register a native tool.
For a short, per-resolution instruction block (e.g. "the user is viewing
bb remotely — share tunnel URLs"), use `contributeInstructions`:

```ts
import { z } from "zod"; // runtime import — declare zod as a plugin dependency
bb.agents.registerTool({
  name: "docs_search", // [a-zA-Z0-9_-]+, unique ACROSS plugins
  description: "Search the bundled docs.",
  instructions: "Prefer docs_search over guessing conventions.", // optional, appended to thread instructions
  parameters: z.object({ query: z.string().min(1) }),
  async execute({ query }, { threadId, projectId, signal }) {
    return excerpts.join("\n"); // or { content: [{ type: "text", text }], isError? }
  },
});

// Dynamic section evaluated at thread.start / turn.submit (sync, fast).
// Return null to contribute nothing for that resolution. Re-registering
// replaces this plugin's previous provider. Output is capped at 4096
// characters; a throw is logged and contributes nothing. Side-chat
// threads never receive plugin instructions.
bb.agents.contributeInstructions(({ threadId, projectId }) => {
  if (!shouldAdviseRemoteUrls()) return null;
  return "The user is viewing bb remotely — share tunnel URLs, not localhost.";
});
```

`parameters` is a zod schema (zod 4; validated per call — bad model args
become a tool error, not a plugin crash) or a plain JSON-schema object
(execute then receives raw `unknown`). Tool-set changes apply on the NEXT
session start, not mid-session. Name collisions: within a plugin the later
registration replaces the earlier; across plugins the earlier plugin wins
and yours is dropped with the reason in your status detail.

`contributeInstructions` is **synchronous** and runs on the thread-start
path — keep it cheap. Prefer `skills/` for standing knowledge; use this
only when the text must reflect live plugin state at resolution time.

### bb.ui — host-rendered UI (no frontend bundle needed)

```ts
bb.ui.registerThreadAction({
  id: "summarize",
  title: "Summarize thread",
  icon: "ListChecks",
  confirm: "Ask the agent for a summary?", // optional confirm dialog
  async run({ threadId, projectId }) {
    return { toast: { kind: "success", message: "Requested." } }; // throw → automatic error toast
  },
});

bb.ui.registerMentionProvider({
  id: "issue",
  label: "Issues",
  triggers: ["@", "#"], // optional; defaults to ["@"]. Valid: @ # $ ! ~
  search({ trigger, query, projectId, threadId }) {
    // 2s time box, failure = empty list
    return [{ id: "42", title: "ENG-42 Fix flake", subtitle: "Todo" }];
  },
  resolve(itemId) {
    // once per unique item AT SEND TIME
    return { context: "# ENG-42…" }; // attached as agent-only context; throwing BLOCKS the send
  },
});
```

Thread actions render in the thread header; mention items render under
`label` in the menu for each registered trigger. All handlers run server-side.
There is deliberately no plugin slash-command surface: the composer's `/`
menu lists skills, so a plugin capability that crafts a prompt for the agent
ships as a `skills/` entry instead.

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
import {
  definePluginApp,
  useRpc,
  useRealtime,
  useSettings,
  useBbContext,
  useBbNavigate,
} from "@bb/plugin-sdk/app";
import { toast } from "sonner"; // shimmed to the host toaster
import { Button } from "@/components/ui/button"; // vendored source YOU own
import { Dialog, DialogContent } from "@/components/ui/dialog";

export default definePluginApp((app) => {
  app.slots.homepageSection({
    id: "issues",
    title: "Open issues",
    component: IssuesSection,
  });
  app.slots.settingsSection({
    id: "settings",
    title: "Connection",
    component: SettingsSection,
  });
  app.slots.navPanel({
    id: "board",
    title: "Board",
    icon: "Columns",
    path: "board",
    component: Board,
  });
  app.slots.threadPanelAction({
    id: "issue",
    title: "Open issue",
    component: IssuePanel,
    run: async ({ threadId, openPanel }) =>
      openPanel({ title: `Issue for ${threadId}` }),
  });
  app.slots.composerAccessory({ id: "hint", component: Hint });
  app.slots.pendingInteraction({
    id: "credentials",
    component: CredentialForm,
  });
  app.slots.sidebarFooterAction({
    id: "remote",
    title: "Remote access",
    icon: "Smartphone",
    run: ({ openSettings }) => openSettings(),
  });
  app.slots.messageDirective({ id: "inline-vis", component: InlineVis });
});
```

Slot props contracts (versioned, additive-only):

- `homepageSection` → `{ projectId: string | null }` (project in view on
  the compose surface). Registration: `{ id, title, component }`.
- `settingsSection` → `{}` (deliberately no props in V1). Rendered on
  `/settings/plugins/<pluginId>` below the host-rendered declarative settings
  form for running, needs-configuration, and degraded plugins. Registration:
  `{ id, title?, component }`; `title` is an optional host-rendered section
  heading. Use the existing hooks (`useRpc`, `useRealtime`, `useSettings`,
  `useBbNavigate`, `useBbContext`) for data. Enabled plugins appear in the
  settings sidebar when they declare settings descriptors OR register
  settings sections. Slot-derived sidebar entries work for builtin plugin
  frontends even when the user-installed Plugins experiment is off; the
  Settings → Plugins management bucket remains experiment-gated.
- `navPanel` → `{ subPath: string }` — owns the whole route at
  `/plugins/<pluginId>/<path>/*` and gets its own sidebar entry. `subPath`
  is the route remainder after the panel root (`""` at the root), so deep
  links like `/plugins/notes/notes/work/ideas.md` land with
  `subPath: "work/ideas.md"`. Navigate within the panel via
  `useBbNavigate().toPluginPanel(path, { subPath, replace? })` — browser
  back/forward then walks panel-internal history (prefer this over hash
  routing).
  Registration: `{ id, title, icon, path, component, chrome?, headerContent? }`.
  The host renders your plugin logo + `title` into the SHARED app header
  (the same chrome as Settings pages) with your optional
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
- `threadPanelAction` → an entry in the thread right panel's new-tab
  Actions list (next to "Start side chat" / "Start terminal"), labeled
  `title` with your plugin logo. Registration:
  `{ id, title, icon?, component, run? }`. Activating it calls
  `run({ threadId, openPanel })` — do anything there (rpc, toast), and/or
  call `openPanel({ title?, params? })` to open a closable panel tab
  rendering `component` with `{ threadId: string, params: unknown }`.
  Omitting `run` opens a tab immediately with defaults. `params` must be
  JSON-serializable — it persists with the tab across reloads (null when
  none was passed); identical action+params re-opens focus the existing
  tab (title refreshed), different params open sibling tabs. The tab pill
  shows your plugin logo + the tab title. Errors thrown from `run` (sync
  or async) are contained and logged, never breaking the launcher.
- `composerAccessory` → `{ projectId: string | null, threadId: string | null }`
  — rendered in the composer footer. Registration: `{ id, component }`.
- `pendingInteraction` → `{ interaction, submit, cancel }` — replaces the
  thread composer only while a matching plugin interaction is pending.
  Registration: `{ id, component }`; `id` must equal the backend request's
  `rendererId`. `interaction` contains metadata plus the JSON `payload`;
  `submit(value)` returns the JSON value to the waiting backend invocation,
  while `cancel()` settles it without a value. Keep sensitive field values in
  component state only.
- `sidebarFooterAction` → host-rendered icon button in the app sidebar footer
  (next to Settings / bug report). No plugin component — the host paints
  the chrome so icons stay consistent. Registration:
  `{ id, title, icon, run }`. Activating it calls
  `run({ openSettings })` — use `openSettings()` to open this plugin's
  Settings detail page (`/settings/plugins/<pluginId>`), or do anything else
  (rpc, toast). Errors from `run` (sync or async) are contained and logged,
  never breaking the sidebar. `title` is the tooltip + accessible label;
  `icon` is a BB icon-name hint (unknown names fall back to a generic bolt).
- `fileOpener` → `{ path: string, source }` — register as a viewer/editor
  for file extensions: `{ id, title, extensions: ["md"], component }`.
  Users set the per-extension default under Settings → "File openers", and
  right-clicking a file link in rendered markdown offers a one-off
  "Open with …" choice; matching files opened in the right panel then
  render your component in a plugin tab instead of the built-in preview —
  this includes links clicked in rendered markdown, the file picker, and
  `bb thread open`. `source` is
  `{ kind: "workspace" | "host" | "thread-storage", threadId, environmentId,
projectId }` (nullable fields) and `path` follows the source (workspace:
  worktree-relative; host: absolute; thread-storage: storage-relative).
  Applies only to live file content — git-ref snapshots and deleted files
  always use the built-in preview, and a removed/disabled opener degrades
  back to it. Pair with `bb.sdk.files` (rpc from your server) to load and
  CAS-save the content.
- `messageDirective` → `{ attributes, source, message,
openWorkspaceFile, openThreadPanel }` — register a leaf
  assistant-message directive. Registration:
  `{ id, component }` where `id` is lowercase kebab-case beginning with a
  letter (e.g. `inline-vis` matches `::inline-vis{file="demo.html"}`).
  Props: `attributes` is a `Readonly<Record<string, string>>` of untrusted
  parsed key/values (validate your own fields); `source` is the original
  directive text (useful for diagnostics); `message` is
  `{ id, threadId, turnId, projectId }` for the enclosing assistant (or
  nested agent) message. `openWorkspaceFile` is either
  `(path: string) => boolean` or `null`; pass it a worktree-relative path to
  open that file in the host's workspace viewer. It is `null` when the message
  surface has no workspace viewer, and it returns whether the host accepted
  the path. `openThreadPanel` is either
  `({ actionId, title?, params? }) => boolean` or `null`; it opens one of the
  same plugin's registered `threadPanelAction` components in the enclosing
  thread side panel. `params` must be JSON-serializable, and the return value
  reports whether the host accepted the action. Use a normal plugin navigation
  action as the fallback when the callback is `null` or returns `false`.
  **Host behavior / fallbacks:** only assistant and
  nested agent Markdown activate directives — user messages, file previews,
  and other Markdown surfaces stay plain. Directives inside inline code or
  fenced code blocks stay literal. Incomplete streaming directives stay
  literal until the closing syntax arrives. Unknown, disabled, malformed,
  conflicting, or crashing directives fall back to rendering the original
  `source` (the component ErrorBoundary still isolates a throw). Treat
  attributes as attacker-controlled even though the model emitted them;
  load workspace data through `bb.sdk.files` with root/host confinement
  rather than trusting paths. Reference implementation:
  `plugins/inline-vis` (the sidebar's path-shaped, sandboxed worktree
  iframe preview, including relative assets and normal web loading).

Hooks:

- `useRpc()` → `{ call(method, input?) }` — calls your `bb.rpc` methods;
  untyped (`Promise<unknown>`) in V1, narrow the result yourself.
- `useRealtime(channel, handler)` — fires for this plugin's
  `bb.realtime.publish(channel, …)` signals while mounted.
- `useSettings()` → `{ values, isLoading }` — effective non-secret values
  (secret settings are excluded; read them server-side only).
- `useBbContext()` → `{ projectId, threadId }` from the current route.
- `useBbNavigate()` → `{ toThread(id), toProject(id), toPluginPanel(path, { subPath?, replace? }?), toCompose({ initialPrompt?, focusPrompt? }?) }`. `toCompose` opens the root compose screen; pass `initialPrompt` to seed the composer draft and `focusPrompt: true` to focus it (the "Create via chat" pattern — drop the user into chat with a prefilled prompt).
- `useComposer()` → programmatic access to the chat composer draft (the
  same one the built-in "Add to chat" affordances write to):
  `addQuote(text)` appends the text as a `> ` blockquote block and focuses
  the composer — the "reference this selection in chat" primitive;
  `insertMention({ provider, id, label })` inserts an @-mention pill bound
  to one of YOUR `bb.ui.registerMentionProvider` providers, resolved to
  fresh context at send time; `focus()` focuses the caret; `scope` reports
  where writes land (`{ kind: "thread", threadId }` inside a thread
  context, `{ kind: "new-thread", projectId }` from nav panels and
  homepage sections — those seed the composer the user lands on next).

UI components — **vendored shadcn source you own** (the shadcn model; the
old host-provided component kit is REMOVED — `@bb/plugin-sdk/app` exports
only `definePluginApp` + the hooks):

- Builtin plugins in this repo import shared UI from `@bb/shared-ui` (the
  single source of truth the app also consumes and the registry generates
  from); external and example plugins still vendor source through the registry.
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
  `-tooltip`, `-navigation-menu`), `sonner`, `vaul`, `@pierre/diffs` (+
  `/react`). Your vendored overlays therefore share the host's
  dismissable-layer/focus/scroll-lock world — stacking against host
  overlays behaves correctly.
- Syntax-highlighted diffs: `parsePatchFiles` from `@pierre/diffs` +
  `FileDiff` from `@pierre/diffs/react` render patches exactly like the
  app's own diff panel (the host provides the highlighting worker pool via
  React context on every plugin surface; add `@pierre/diffs` to
  devDependencies for types). Synthesize a `diff --git a/<p> b/<p>` header
  when your patch source (e.g. the GitHub REST API) omits it — see
  `examples/plugins/github/app.tsx`.
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
(and other plugins) stay alive. For `messageDirective`, a throw falls back
to the original directive source text instead of blanking the message.

The `run` pattern (threadPanelAction): `run` is the place to resolve
server state before deciding what to open — e.g. call a backend rpc, then
`openPanel({ title: issue.title, params: { issueId: issue.id } })`, or
`toast.error("No linked issue")` and open nothing. The panel component
should treat `params` as untrusted input (it round-trips through
persistence) and re-fetch fresh data by id rather than embedding whole
payloads in params.

Styling: Tailwind classes compile against the host theme's live CSS
variables — use host token classes (`bg-card`, `text-foreground`,
`text-muted-foreground`, `border-border`, `text-destructive`, …). Never
define custom `@theme` colors and never hand-set `oklch(...)`/gray
literals: the build's Tailwind pass emits default-theme utilities only, and
hardcoded colors break custom palettes.

## Testing a plugin

### Unit tests with `@bb/plugin-sdk/testing`

In a bb checkout (workspace/in-repo plugins), `@bb/plugin-sdk/testing` is
the official vitest harness: a fake plugin host whose `bb` satisfies
`BbPluginApi` with host-faithful semantics — real better-sqlite3 `:memory:`
storage (never mock the db), the kv 256KB cap, the same registration
name-validation and error messages, rpc/cli JSON round-tripping, and
`threads.spawn` plugin attribution. It is NOT part of the bundled `.d.ts`
that `bb plugin new` scaffolds ship (V1 is workspace consumers only), so
standalone plugins outside a checkout cannot import it yet.

Backend (`server.ts`) — `createFakePluginHost()`:

```ts
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@bb/plugin-sdk/testing";
import plugin from "./server";

const { bb, harness } = createFakePluginHost({
  pluginId: "my-plugin",
  settings: { apiToken: "tok" }, // pre-seeded stored values (secrets included)
  sdk: { threads: { spawn: async () => ({ id: "th_1" }) } },
});
await plugin(bb);

await harness.callRpc("list", { q: "x" }); // JSON round-trip like the wire
await harness.fetchHttp("POST", "/events", { body }); // real Hono context; auth not enforced
await harness.runCli(["search", "x"]); // { exitCode, stdout, stderr }
const svc = harness.runService("watcher"); // start now; svc.controller.abort(); await svc.done
await harness.runSchedule("sync"); // no timers, no cron sweep
await harness.setSettings({ apiToken: "next" }); // validates + fires onChange like a host save
await harness.emitThreadEvent("thread.idle", {
  thread: makeThreadResponse({ id: "th_1" }), // complete ThreadResponse fixture
  lastAssistantText: "done",
});
await harness.callAgentTool("lookup_doc", { query: "x" }); // parse (zod) + execute
await harness.dispose(); // abort services, hooks LIFO, close sqlite; stale bb throws
```

Inspect: `harness.sdk.calls` / `harness.sdk.callsTo("threads.spawn")` (every
`bb.sdk` call is recorded; unstubbed methods throw naming the path to stub —
`harness.sdk.stub("projects.list", fn)` adds one late), `harness.logEntries`,
`harness.realtimeSignals`, `harness.needsConfigurationMessages`, and
`harness.registrations` (http routes, rpc methods, services, schedules, cli,
agent tools, thread actions, mention providers).

Frontend (`app.tsx`) — `@bb/plugin-sdk/testing/app` (vitest + jsdom):

```tsx
// @vitest-environment jsdom
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";

// The thunk matters: app.tsx binds the plugin runtime at module load, so
// loadPluginApp installs the test runtime BEFORE importing it. (For static
// imports, call installTestPluginRuntime() in a vitest setup file instead.)
const app = await loadPluginApp(() => import("./app"));

const slot = renderSlot(
  app.navPanels[0]!,
  { subPath: "" },
  {
    rpc: {
      listNotes: () => ({ root: "/notes", notes: [], error: null }),
    }, // method → handler, calls logged
    settings: { greeting: "hi" }, // useSettings() values
    context: { projectId: "p1", threadId: null }, // useBbContext()
  },
);
await slot.findByText("…"); // Testing Library queries
slot.rpcCalls;
slot.navigateCalls;
slot.composer.quotes; // recorded hook activity
```

`loadPluginApp` validates registrations with the host's own rules (slot id
patterns, settingsSection optional title, navPanel path, chrome,
fileOpener extensions) and returns them typed with defaults filled. Working examples:
`examples/plugins/slack-bot/server.test.ts` (webhook → kv → recorded spawn →
`thread.idle` reply), `examples/plugins/simple-notes/app.test.tsx` (nav
panel list over rpc + create/open navigation assertions).

### Live loop against a running bb

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
  in a single navPanel (with `headerContent`), subPath-based sub-navigation,
  vendored Tabs/Select/DropdownMenu/Badge/Skeleton + sonner toast
  throughout, background sync service, rpc + realtime, project setting, a
  `bb github` CLI command, and agent-spawn buttons.
- `simple-notes` — multi-host Docs vaults over `bb.sdk.files`, with a Tiptap
  markdown WYSIWYG, nested navigation, images and sandboxed HTML, CLI/HTTP
  operations, autosave with CAS conflicts, native local-vault watching with
  remote polling fallback, a markdown `fileOpener`, message directives, and
  side-panel-only `useComposer()` quote/mention actions.
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
- Thread events are observe-only; there are exactly four
  (`thread.created`, `thread.idle`, `thread.failed`, `thread.deleted`).
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
