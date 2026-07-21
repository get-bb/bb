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
  "engines": { "bb": ">=0.9", "bbPluginSdk": "^0.4.0" },
  "bb": {
    "name": "Hello",
    "description": "A friendly example plugin.",
    "branding": { "icon": "Zap" },
    "server": "./server.ts",
    "app": "./app.tsx",
    "skills": ["skills"]
  }
}
```

- `bb.server` (required) — backend entry. Path installs load it as
  TypeScript directly (no build step); `bb plugin build` also emits a
  self-contained `dist/server.js` + `server.meta.json` that git/npm installs
  prefer when its SDK major matches, so consumers never need npm or
  node_modules. `bb.app` (optional) — frontend entry compiled by
  `bb plugin build` into `dist/app.js` + `app.css` + `app.meta.json`; path
  installs and git installs without a prebuilt app build it automatically at
  install time when their imported dependencies are already available. Git
  plugins may instead ship a metadata-validated prebuilt app.
- `bb.skills` (optional) — relocates the auto-imported skills directories
  (default `skills/`; `[]` opts out). Every `skills/<name>/SKILL.md` is
  injected into agent threads as the plugin skills tier.
- `bb.themes` (optional) — contributes palettes to Settings → Appearance and
  `bb theme list`. Each entry is
  `{ id, name, description?, css: "./themes/name.css" }`; bb namespaces its
  selectable id as `plugin:<plugin-id>:<id>`. Only loaded plugins contribute.
- `bb.name` and `bb.description` (required) — non-empty human-facing plugin
  identity. The top-level package `name` remains the package identity and
  source of the plugin id.
- `bb.branding` (required) — declare at least `icon` or `logo.light`. `icon`
  is the compact host icon-name identity. `logo.light` is the rich/full-size
  identity artwork; optional `logo.dark` is preferred in dark mode. Logo paths
  are explicit plugin-relative `.svg`, `.png`, or `.webp` files: nulls, empty
  strings, missing/escaping files, unsupported extensions, and a dark logo
  without a light logo fail the manifest. There is no root logo auto-detection.
  BB uses the logo where space permits, such as roomy Settings rows and cards.
  Compact sidebar, menu, action, mention, and panel-title surfaces use the
  manifest icon, then a contribution's distinct local `icon` hint, then the
  generic Zap icon. Branding changes are picked up on `bb plugin reload`.
  Inline icons must use `currentColor` for their stroke/fill and take their
  color from semantic text-token classes; never hardcode gray or palette
  values. An SVG loaded
  through `<img>` cannot inherit `currentColor`, so omit the logo and use a
  named `branding.icon` hint when a monochrome glyph should match the surrounding
  bb chrome. Reserve logo assets for intentionally branded artwork (and provide
  a dark variant when needed).
- `engines.bb` — optional semver range checked against the bb app version.
- `engines.bbPluginSdk` — optional semver range for the plugin SDK surface
  (currently `0.4.0`; the scaffold writes `"^0.4.0"`). Absent means a legacy
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
  `custom-instructions`, `inline-vis`, `secrets`) cannot be
  installed from a non-`builtin:` source — use `builtin:<name>` instead.

The scaffold ships the full API as bundled type declarations in `types/`
(`bb-plugin-sdk.d.ts`, plus `bb-plugin-sdk-app.d.ts` for `--app`); its
`tsconfig.json` maps `@bb/plugin-sdk` to them, so `npm install && npx tsc
--noEmit` typechecks anywhere — no bb checkout required. Those `.d.ts` files
are the authoritative, exhaustive surface: read them (or the source at
<https://github.com/ymichael/bb>, cloned) when you need an exact signature or
a symbol this skill doesn't cover. Backend API imports normally stay type-only;
the root runtime exports are `defineRpcContract`, supplied by BB for shared
schema contracts, and the numeric `PLUGIN_CLI_OUTPUT_MAX_BYTES` ceiling:
`import { defineRpcContract, type BbPluginApi } from
"@bb/plugin-sdk"`. Validator imports such as Zod are normal plugin runtime
dependencies (and are bundled by `bb plugin build`).

On-disk state per plugin: `<dataDir>/plugins/<id>/data.db` (its SQLite),
`secrets/` (secret settings + HTTP token), `logs/plugin.log` (JSONL,
rotated at 5MB). Settings edits never auto-reload — `bb plugin reload <id>`
after configuring.

## Distributing a plugin

Users can install third-party plugins directly from a local path, npm package,
or Git repository:

```sh
bb plugin install ./bb-plugin-notes
bb plugin install npm:bb-plugin-notes@^1.0.0
bb plugin install git:https://github.com/acme/bb-plugin-notes.git@main
```

BB has one maintained set of official plugins; users cannot add third-party
catalogs. Official-plugin inclusion is a BB release decision, not part of the
plugin authoring workflow: official plugins ship bundled inside the app itself
and install from that local copy — no network fetch, no separate publish
pipeline.

## The backend factory

```ts
import type { BbPluginApi } from "@bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  // Register surfaces here. Load-safe: settings, storage, http, rpc,
  // realtime, background, cli, agents, ui, events, status, onDispose.
  // bb.sdk works here in the real server, but prefer it in handlers/services
  // (bind-gated — see below).
}
```

The factory runs at load/reload/enable (time-boxed 30s). A throwing initial
factory puts the plugin in `error` status with the message as the detail; a
throwing reload candidate leaves the prior registration set running and
reports the reload failure in its detail. `bb.pluginId` is the plugin's own id.

Keyed registrations must be unique within one factory execution: duplicate
settings, routes, rpc methods, services, schedules, CLI registrations, tools,
instruction providers, thread actions, or mention providers are rejected.
Listeners are different: `bb.events.on`, settings `onChange`, and `onDispose`
are additive, so registering multiple listeners is supported.

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
  caches and datasets go in the plugin database.
- `bb.storage.database()` — the plugin's own better-sqlite3 database at
  `<dataDir>/plugins/<id>/data.db` (WAL, busy_timeout 5000). Handles are
  host-tracked and closed on reload; a closed handle throws.
- `bb.storage.migrate(db, statements)` — statement index = migration id;
  unapplied statements run in one transaction. **Append-only**: never
  reorder or edit shipped statements, only push new ones.

```ts
const db = bb.storage.database();
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

`bb.sdk.projects.list()` preserves the ordinary-project-only default. Plugins
that need the singleton personal project use
`bb.sdk.projects.list({ includePersonal: true })`.

```ts
const thread = await bb.sdk.threads.spawn({
  projectId,
  environment: { type: "project-default" }, // server resolves the project's default environment
  prompt: "Work on this issue…", // prompt XOR input — exactly one
  title: "ENG-42: fix the flaky test",
  visibility: "hidden", // optional background worker; visible is the default
});
```

`threads.spawn` takes `prompt` (a string) or `input` (structured prompt
inputs) — never both. Attribution is auto-filled: `origin: "plugin"` and
`originPluginId: <your id>` unless you set them. `bb.sdk.threads.send({
threadId, mode: "auto", input: [...] })` starts a turn on an idle thread or
queues/steers a running one.

Use `visibility: "hidden"` for background workers. Hidden threads stay
out of sidebar organization and do not contribute unread/pending favicon
attention or native parent notifications. They otherwise retain ordinary
list, search, prompt-history, section, lifecycle, parent-operation, direct-open,
and direct-ID behavior. This is an organization contract, not a security
boundary: plugins are full-trust server code.

SDK realtime observation stays separate from plugin lifecycle events:
`bb.sdk.subscribe({ event, callback, ...selector })` returns an unsubscribe
function. Do not use `bb.events.on` for SDK entity-change subscriptions.

`bb.sdk.terminals` is the canonical terminal area. `list` and `create` take an
explicit discriminated `scope`: `{ kind: "thread", threadId }`,
`{ kind: "environment", environmentId }`, or
`{ kind: "host_path", hostId, cwd }`. The host is always explicit; there is no
primary-host default. Existing-session operations are terminal-ID-only:
`get`, `input`, `resize`, `output`, `rename`, `restart`, and `close`.
`restart` closes the old session and creates a shell with the same scope, size,
and title; it returns a new terminal ID and does not replay the original command.

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

Project prompt attachments use a separate server-managed byte surface. Upload
bytes available to the SDK caller with
`bb.sdk.projects.attachments.upload({ projectId, clientFile, filename?,
mimeType? })`; `clientFile` accepts `Uint8Array`, `ArrayBuffer`, `Blob`, or a
File-like value (bare bytes/Blob require `filename`). The SDK sends multipart
bytes and returns the stable uploaded-attachment DTO whose relative `path` can
be used in `localFile`/`localImage` prompt input. Read an existing attachment
with `bb.sdk.projects.attachments.read({ projectId, path })`. Image MIME types
cap at 10 MB and other files at 25 MB. There is no attachment list or
per-attachment remove operation.

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

### bb.events.on — thread lifecycle events

```ts
bb.events.on("thread.created", ({ thread }) => { ... });
bb.events.on("thread.active", ({ thread }) => { ... });
bb.events.on("thread.idle", ({ thread, lastAssistantText }) => { ... });   // lastAssistantText: string | null
bb.events.on("thread.failed", ({ thread, error }) => { ... });             // error: string | null
bb.events.on("thread.archived", ({ thread }) => { ... });
bb.events.on("thread.deleted", ({ thread }) => { ... });
```

Exactly six events. `thread.active` fires when an applied lifecycle
transition enters the running `active` state. `thread.archived` fires after a
thread is archived, including cascade archives (archiving a parent archives
its children too, each with its own event). Observe-only handlers run
fire-and-forget after the transition and can never block or veto it. `thread`
is the same DTO `GET /api/v1/threads/:id` serves. Errors are caught, logged,
and counted in the plugin's handler stats (`bb plugin list`).

Lifecycle events are broadcast to all loaded plugins regardless of sidebar
visibility.

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

Define method names plus runtime input/output schemas once, then register
handlers against that contract. Schemas use validator-neutral Standard Schema
v1, which Zod 4 implements directly. The host validates input before invoking
the handler and output before serialization; handler parameters and return
values are inferred from the schemas.

```ts
import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk";
import { z } from "zod";

export const rpcContract = defineRpcContract({
  listIssues: {
    input: z.object({ filter: z.string().optional() }).strict(),
    output: z.object({ issues: z.array(z.object({ id: z.string() })) }),
  },
  status: {
    input: z.null(), // null input lets the frontend omit the argument
    output: z.object({ ready: z.boolean() }),
  },
});

export default function plugin(bb: BbPluginApi) {
  bb.rpc.register(rpcContract, {
    listIssues({ filter }) {
      return { issues: listCachedIssues(filter) };
    },
    status() {
      return { ready: true };
    },
  });
}
```

In `app.tsx`, import only the backend contract's type. The backend module and
its dependencies are erased from the frontend bundle:

```tsx
import { useRpc } from "@bb/plugin-sdk/app";
import type { rpcContract } from "./server";

function IssuesButton() {
  const rpc = useRpc<typeof rpcContract>();

  async function loadIssues() {
    const { issues } = await rpc.call("listIssues", { filter: "open" });
    return issues;
  }

  return <button onClick={() => void loadIssues()}>Load issues</button>;
}
```

The wire envelope is `{ ok: true, result }` or `{ ok: false, error }`.
Failures use stable codes: `invalid_json`, `invalid_input`, `handler_error`,
`invalid_output`, `non_json_result`, and `unknown_method`; validation failures
also carry normalized `{ message, path? }[]` issues. Unknown methods return
404, invalid JSON/input returns 400, and handler/output/serialization failures
return 500. Results must be strict JSON values: cyclic objects, bigint,
undefined/functions, class instances, symbol keys, and non-finite numbers are
rejected rather than coerced or silently dropped.

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

One top-level command per plugin; a second `register` in one factory
execution is rejected.
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
`commands` usage lines — fill both in. Combined stdout and stderr must fit
`PLUGIN_CLI_OUTPUT_MAX_BYTES` from `@bb/plugin-sdk` (1,048,576 UTF-8 bytes).
The host rejects a larger result atomically as `plugin_cli_output_too_large`;
it never clips it. Page growing collections, cap verbose fields, and use
file/streaming commands for large content. Caveat: under the workspace
sandbox (Accept Edits / Approve for me) some provider sandboxes block
loopback network for sandboxed commands, so `bb` CLI calls (including
plugin commands) may need escalation approval or a Full Access thread.

**Multi-machine rule: `run` executes on the server, so a path argument names
a file on the INVOKING machine, not on `run`'s filesystem.** Never open a
`ctx.cwd`-relative or user-supplied path with `node:fs` — on an enrolled
remote machine that silently reads or writes the wrong host's disk. Instead
resolve the invoking host (`ctx.threadId` → `bb.sdk.threads.get` →
`environmentId` → `bb.sdk.environments.get(...).hostId`, with an explicit
`--machine`-style flag as the no-thread escape hatch; `undefined` targets the
server's own host) and do all such file I/O through `bb.sdk.files` with that
`hostId`. Reference implementations: the docs plugin's pull/push sync and the
tasks plugin's attachment commands. `node:fs` remains correct for genuinely
server-local data such as files under the plugin's own data directory.

### bb.ui.requestInput — replace the composer with a blocking plugin form

Use `bb.ui.requestInput({ threadId, rendererId, title, payload, timeoutMs? },
{ signal? })` when plugin backend code must wait for sensitive or structured
user input. The promise resolves to `{ outcome: "submitted", value }` or
`{ outcome: "cancelled", reason }`. Payloads and responses are JSON values
capped at 64 KiB; response values are delivered only to the waiting plugin
invocation and are never persisted. Pair `rendererId` with a frontend
`pendingInteraction` slot. Pass a CLI handler's `ctx.signal` so disconnecting
the caller cancels the request.

### bb.agents — native tools and conditional session configuration

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

// All tools and manifest skills are static registrations. configure() only
// selects this plugin's own ids when BB resolves a thread/session config.
bb.agents.configure((context) => ({
  tools: context.provider.id === "codex" ? ["docs_search"] : [],
  skills: context.project.kind === "standard" ? ["repo-conventions"] : [],
  instructions: `Docs selection resolved for ${context.project.name}.`,
}));

// Dynamic section evaluated at thread.start / turn.submit (sync, fast).
// Return null to contribute nothing for that resolution. Duplicate factory
// registrations are rejected. Output is capped at 4096
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
session start, not mid-session. Name collisions: within one factory execution
duplicate registrations are rejected; across plugins the earlier plugin wins
and yours is dropped with the reason in your status detail.

`contributeInstructions` is **synchronous** and runs on the thread-start
path — keep it cheap. Prefer `skills/` for standing knowledge; use this
only when the text must reflect live plugin state at resolution time.

Ordering is standard BB instructions, selected tools' static snippets,
`contributeInstructions` output, `configure` dynamic instructions, data-dir
user instructions, then workspace instructions. Tool snippets are rejected at
registration above 4096 characters; each legacy/dynamic callback contribution
is truncated to 4096 characters.

`configure` is also synchronous and may be registered only once per factory
execution. Its context has required, plain-data `thread`, `project`,
`environment`, `host`, and `provider: { id, model }` objects, plus `sideChat`
and `origin: { kind, pluginId }`; genuinely absent values are `null`, not
omitted. `tools` names and `skills` frontmatter names may select only this
plugin's static registrations. A `tools` entry may instead be
`{ name, parameters }` to override the parameter schema advertised to the
provider for that resolution only — `parameters` must be a JSON-serializable
JSON-schema object with root `type: "object"`, at most 128 KiB serialized, and
should only narrow what the registered schema accepts, since execution-side
validation still runs the registered parameters. Unknown or duplicate ids,
malformed output, an invalid override, more than 256 ids in either array, or a
throwing callback fail closed for that plugin only. Dynamic `instructions` are
truncated to 4096 characters.

Resolution happens for `thread.start` and `turn.submit`. A selected tool set
takes effect only when the provider session is next started/resumed; BB never
hot-mutates a running provider session. Instructions apply to the next turn.
Skill catalog changes follow the daemon's established runtime policy: a busy
environment keeps its current staged catalog until a safe relaunch. Side chats
evaluate `configure` with `sideChat: true`; returned tool, skill, and dynamic
instruction selections apply at those same boundaries. Independent side-chat
safety policy such as permission escalation is unchanged. The legacy
`contributeInstructions` provider remains excluded from side chats, so use
`configure` for side-chat-aware dynamic instructions.

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
reload the host first runs the factory against a candidate registration set.
If it throws, the complete previous set stays live. Once the candidate
succeeds, the host aborts old background services and awaits them (bounded),
runs dispose hooks LIFO (each isolated), drains in-flight http/rpc/event
handlers, closes every `storage.database()` handle, invalidates the old `bb`
handle, and replaces the registration set wholesale. Disable/shutdown perform
the same cleanup without a replacement. A
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
  useRealtimeConnectionState,
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
    description: "Configure the remote service used by this plugin.",
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
  `{ id, title?, description?, component }`; `title` is an optional host-rendered
  section heading and `description` is optional supporting copy rendered with
  that heading. Use the existing hooks (`useRpc`, `useRealtime`,
  `useRealtimeConnectionState`, `useSettings`, `useBbNavigate`, `useBbContext`)
  for data. Enabled plugins appear in the
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
  Registration: `{ id, title, icon, path, component, headerContent? }`.
  The host renders your compact plugin icon + `title` into the SHARED app
  header (the same title bar as Settings pages) with your optional
  `headerContent` component as the header actions on the right — so do NOT
  repeat the title inside your component. The component owns the full-bleed
  body below with zero host padding; add your own padding and scrolling when
  the design needs them. `headerContent` is plugin code inside the host title bar and is
  contained separately: a throw hides the accessory without breaking the
  title bar or the panel body. For a classic page, use an outer scroll region
  with `p-4 md:p-5` and wrap its content in a
  `mx-auto w-full max-w-3xl space-y-4` div.
- `threadPanelAction` → an entry in the thread right panel's new-tab
  Actions list (next to "Start side chat" / "Start terminal"), labeled
  `title` with your compact plugin icon. Registration:
  `{ id, title, icon?, component, layout?, run? }`. Activating it calls
  `run({ threadId, openPanel })` — do anything there (rpc, toast), and/or
  call `openPanel({ title?, params? })` to open a closable panel tab
  rendering `component` with `{ threadId: string, params: JsonValue | null }`.
  Omitting `run` opens a tab immediately with defaults. Write parameters are
  typed as the recursively JSON-safe `JsonValue` exported by both
  `@bb/plugin-sdk` and `@bb/plugin-sdk/app`; they persist with the tab across reloads (null when
  none was passed); identical action+params re-opens focus the existing
  tab (title refreshed), different params open sibling tabs. The tab pill
  shows your compact plugin icon + the tab title. Errors thrown from `run`
  (sync or async) are contained and logged, never breaking the launcher.
  `layout` frames the tab content: `"padded"` (default) wraps `component`
  in the panel's scroll container with standard padding — right for
  document-like content; `"flush"` gives it the full tab area (no padding,
  definite height, no host scrolling) — right for app-like content that
  owns its layout, such as `experimental_ThreadChat`.
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
  thread side panel. `params` is typed as `JsonValue`, and the return value
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
- `experimental_messageAction` → an action on chat messages: an icon button in the
  per-message action bar (user and assistant messages) and an entry in the
  assistant-message text-selection menu. Host-rendered chrome, no plugin
  component — registration: `{ id, title, icon?, run }`. Activating it calls
  `run(context)` with `{ threadId, message, selectedText?, openPanel }`:
  `message` is a narrow stable reference
  `{ id, threadId, role: "user" | "assistant", text, sourceSeqEnd }` (never
  an internal timeline row); `selectedText` is present only for
  selection-menu invocations and holds the exact highlighted text; and
  `openPanel({ actionId, title?, params? })` opens one of the same plugin's
  registered `threadPanelAction` components in the current thread's side
  panel — same semantics and boolean return as the message-directive
  `openThreadPanel`. Errors from `run` (sync or async) are contained and
  logged, never breaking the timeline.

Host components:

- `experimental_ThreadChat` — bb's complete chat surface for an existing thread, rendered
  wherever plugin React runs (nav panels, thread-panel tabs, homepage and
  settings sections). This is the deliberate exception to the
  no-host-components rule: a stable product capability, not a UI kit. Props:
  `{ threadId, variant?, layout?, focusRequest?, className?,
leadingContent?, messageActions? }` —
  `variant` is `"full"` (standard chat controls, default), `"compact"`
  (side-panel presentation), or `"timeline"` (transcript without a
  composer); `layout` is `"contained"` (fills and scrolls within the
  parent, default) or `"document"` (grows with page content);
  `focusRequest` is a change-detected nonce that focuses the composer;
  `leadingContent` is a `ReactNode` rendered above the conversation,
  scrolling with it; `messageActions` is a list of
  `ThreadChatMessageAction` entries `{ id, title, icon?, roles?, run }`
  rendered in this instance's per-message action bar after the native and
  slot-registered actions — `roles` limits the action to `"user"` and/or
  `"assistant"` messages (omitted = both), and `run(message)` receives the
  same narrow `ThreadChatMessageReference` as the `messageAction` slot;
  errors from `run` are contained and logged, never breaking the timeline.
  Unlike the global `messageAction` slot, these actions are scoped to the
  one `ThreadChat` instance that supplied them. The
  host owns timeline loading, streaming, drafts, send/queue/steer/stop,
  attachments, execution controls, pending interactions, and read tracking —
  do not proxy thread data through your own RPC or rebuild the composer.
- `experimental_Markdown` — bb's chat-message markdown renderer (same typography,
  spacing, and code styling as timeline messages). Props:
  `{ content, className? }`. Use it wherever plugin UI quotes or previews
  message content (e.g. a reply header) so it reads like the rest of the
  chat instead of a differently-styled bundled renderer. Renderer options
  beyond content/className stay host-internal.

Hooks:

- `useRpc<typeof rpcContract>()` → `{ call(method, input?) }` — exact method,
  input, and result inference from a type-only backend contract import.
- `useRealtime(channel, handler)` — fires for this plugin's
  `bb.realtime.publish(channel, …)` signals while mounted.
- `useRealtimeConnectionState()` — returns `"connecting"`, `"connected"`, or
  `"reconnecting"` for the same shared socket used by `useRealtime`. Reconcile
  durable server state on subsequent transitions to `connected` (not the first
  connection) because plugin signals are ephemeral and are not replayed.
- `useSettings()` → `{ values, isLoading }` — effective non-secret values
  (secret settings are excluded; read them server-side only).
- `useBbContext()` → `{ projectId, threadId }` from the current route.
- `useBbNavigate()` → `{ toThread(id), toProject(id), toPluginPanel(path, { subPath?, replace? }?), toCompose({ initialPrompt?, focusPrompt? }?) }`. `toCompose` opens the root compose screen; pass `initialPrompt` to seed the composer draft and `focusPrompt: true` to focus it (the "Create via chat" pattern — drop the user into chat with a prefilled prompt).
- `useComposer()` → programmatic access to the chat composer draft (the
  same one the built-in "Add to chat" affordances write to):
  `text` is the current plain text; `setText(next)` replaces it;
  `updateText(current => next)` receives the latest committed text; and
  `clear()` clears the text. These edits preserve attachments. Inline
  mentions outside the changed range are preserved and rebased, while a
  mention overlapped by replaced text is removed because its inline text no
  longer represents that pill. Text edits do not focus the composer;
  `addQuote(text)` appends the text as a `> ` blockquote block and focuses
  the composer — the "reference this selection in chat" primitive;
  `insertMention({ provider, id, label })` inserts an @-mention pill bound
  to one of YOUR `bb.ui.registerMentionProvider` providers, resolved to
  fresh context at send time; `focus()` focuses the caret; `scope` reports
  where writes land (`{ kind: "thread", threadId }` inside a thread
  context, `{ kind: "new-thread", projectId }` from nav panels and
  homepage sections — those seed the composer the user lands on next).

```tsx
const composer = useComposer();
composer.updateText((current) => `${current}\n\nPlease summarize this.`);
```

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
  `official-plugins/github/app.tsx`.
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
  `official-plugins/github/components/` for reference implementations).

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

`@bb/plugin-sdk/testing` is the official vitest harness for workspace and
standalone plugins. The packed package ships runtime JavaScript and portable
declarations for both testing subpaths. A scaffold still vendors the root/app
types, so add `@bb/plugin-sdk` as a devDependency when tests import the
testing harness (plus its optional peers: `better-sqlite3` for backend tests;
React, React DOM, Testing Library, and jsdom for frontend tests).

The fake plugin host's `bb` satisfies `BbPluginApi` with host-faithful
semantics: real better-sqlite3 temporary storage (never mock the db), the kv
256KB cap, schema-RPC validation/error/strict-JSON behavior, additive events,
keyed registration failures, atomic reload, conditional agent configuration,
request input, and `threads.spawn` plugin attribution.

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

await harness.behavior.callRpc("list", { q: "x" }); // JSON round-trip like the wire
await harness.behavior.fetchHttp("POST", "/events", { body }); // real Hono context; auth not enforced
await harness.behavior.runCli(["search", "x"]); // { exitCode, stdout, stderr }
const svc = harness.behavior.runService("watcher"); // start now; svc.controller.abort(); await svc.done
await harness.behavior.runSchedule("sync"); // no timers, no cron sweep
await harness.behavior.setSettings({ apiToken: "next" }); // validates + fires onChange like a host save
await harness.behavior.emitThreadEvent("thread.idle", {
  thread: makeThreadResponse({ id: "th_1" }), // complete ThreadResponse fixture
  lastAssistantText: "done",
});
await harness.behavior.callAgentTool("lookup_doc", { query: "x" }); // parse (zod) + execute
await harness.behavior.resolveAgentConfiguration(context); // validated tools/skills/instructions
await harness.lifecycle.dispose(); // abort services, hooks LIFO, close database; stale bb throws
```

New tests should use the named views: `harness.behavior` drives host inputs,
`harness.inspection` exposes observable state, and `harness.lifecycle` owns
atomic reload/disposal. Direct members remain aliases for compatibility.
`lifecycle.reload(factory)` preserves settings/KV/database state; a throwing
replacement leaves the current registrations and API live.

Inspect: `harness.inspection.sdk.calls` /
`harness.inspection.sdk.callsTo("threads.spawn")` (every
`bb.sdk` call is recorded; unstubbed methods throw naming the path to stub —
`harness.sdk.stub("projects.list", fn)` adds one late), `harness.logEntries`,
`harness.realtimeSignals`, `harness.needsConfigurationMessages`, and
`harness.registrations` (http routes, rpc methods, services, schedules, cli,
agent tools/configure provider, thread actions, mention providers). Pass
`agentSkillIds` to `createFakePluginHost` to declare the manifest skill names
available to the configure driver.

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
    realtimeConnectionState: "reconnecting", // useRealtimeConnectionState()
  },
);
await slot.findByText("…"); // Testing Library queries
await slot.behavior.setRealtimeConnectionState("connected");
slot.inspection.rpcCalls;
slot.inspection.navigateCalls;
slot.inspection.composer.quotes; // recorded hook activity
slot.lifecycle.unmount();
```

`loadPluginApp` validates registrations with the host's own rules (slot id
patterns, settingsSection optional title, navPanel path,
fileOpener extensions) and returns them typed with defaults filled. Working examples:
`examples/plugins/slack-bot/server.test.ts` (webhook → kv → recorded spawn →
`thread.idle` reply), `official-plugins/docs/app.test.tsx` (nav
panel list over rpc + create/open navigation assertions).

Fidelity boundaries: HTTP auth is recorded but not enforced; services and
schedules run only when driven (no restart timers or cron sweep); storage is
process-local and secrets stay in memory; `bb.sdk` is always bound and
unstubbed calls throw; cross-plugin collisions are outside one fake host. The
frontend harness validates registrations and JSON/composer behavior but does
not reproduce BB layout/CSS, persistence, routing, crash boundaries, or
multi-plugin arbitration. Use a live loop for those host boundaries.

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

BB Official plugins in `official-plugins/` (a bb checkout):

- `github` — a gh-CLI-backed issue/PR browser in a single navPanel (with
  `headerContent`), subPath-based sub-navigation, shared-ui
  Tabs/Select/DropdownMenu/Badge/Skeleton + sonner toast throughout (in-repo
  plugins import `@bb/shared-ui`; out-of-repo authors vendor the same
  components from the registry), background sync service, rpc + realtime,
  project setting, a `bb github` CLI command, and agent-spawn buttons.
- `docs` (stable plugin id `simple-notes`) — multi-host Docs vaults over
  `bb.sdk.files`, with a Tiptap
  markdown WYSIWYG, nested navigation, images and sandboxed HTML, CLI/HTTP
  operations, autosave with CAS conflicts, native local-vault watching with
  remote polling fallback, a markdown `fileOpener`, message directives, and
  side-panel-only `useComposer()` quote/mention actions.
- `memory` — provider-independent durable agent memory with global/project
  scopes, progressive disclosure, CLI commands, and a Settings editor.

Remaining reference examples in `examples/plugins/`:

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
- kv values cap at 256KB; put caches and datasets in `storage.database()`.
- `storage.migrate` is append-only by statement index.
- Settings saves do not reload healthy or degraded plugins; live `onChange`
  listeners receive those updates. A save automatically retries load when the
  plugin is `needs-configuration`; `bb plugin reload <id>` remains available
  for other recovery cases.
- Descriptors without `default` produce `| undefined` values.
- Thread events are observe-only; there are exactly six
  (`thread.created`, `thread.active`, `thread.idle`, `thread.failed`,
  `thread.archived`, `thread.deleted`).
- Service throw of NeedsConfigurationError changes plugin status; schedule
  throws only set the schedule's last_error. Name-matching means no import
  is needed for the error class.
- Schedules only fire while the plugin is loaded (rows are durable, the
  runner is not).
- CLI `run(argv)` argv excludes the command name; core bb command names
  are reserved; workspace-sandboxed agent threads (Accept Edits / Approve
  for me) may fail to reach the bb CLI when the provider sandbox blocks
  loopback network.
- Mention `search` is 2s-time-boxed; mention `resolve` runs at send time
  and a throw blocks the send.
- Agent tool changes apply on the next session start, not mid-session;
  cross-plugin tool-name collisions drop the later registration.
- RPC results must be strict JSON values and pass their output schema;
  realtime payloads must survive JSON.stringify.
- Handler stats shown by `bb plugin list` persist across reloads (reset on
  remove).
- The frontend Tailwind pass emits default-theme utilities only — style
  with host token classes, no custom `@theme` colors, no hand-set oklch.
- `onDispose` hooks run LIFO; stale `bb` handles from before a reload throw
  on use.
- Backend API imports normally remain type-only. The root runtime exports
  `defineRpcContract` plus `PLUGIN_CLI_OUTPUT_MAX_BYTES`; validator imports are
  plugin dependencies. The
  scaffold tsconfig typechecks both `server.ts` and `app.tsx`.
