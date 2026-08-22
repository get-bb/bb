---
name: bb-plugin-authoring
description: Write, build, and install bb plugins. Use whenever the task is to create a bb plugin, extend bb itself, or add a bb CLI command, agent tool, background service, settings, panel, mention provider, or other bb surface via a plugin. Covers the entire backend BbPluginApi and the frontend @get-bb/plugin-sdk/app contract with working patterns.
---

# Authoring bb plugins

A bb plugin is a TypeScript package running in-process inside the bb server.
Its backend entry default-exports a factory that receives the full plugin API
(`bb`); an optional frontend entry registers React UI inside the bb app; an
optional host entry is bundled and runs as a supervised Node worker on targeted
enrolled hosts. Plugins are full-trust code in every runtime.

Plugins are on by default. Builtin plugins ship with bb; a few sit behind
their own product gates. `bb plugin list` shows each plugin's status.

## Quickstart

```
bb plugin new hello            # scaffolds ./bb-plugin-hello (add --app for a frontend entry)
cd bb-plugin-hello
bb plugin install .            # registers the directory in place (--yes to skip the prompt)
bb plugin dev                  # rebuild app/host bundles + reload on every save
```

The manifest is `package.json`:

```json
{
  "name": "bb-plugin-hello",
  "version": "0.1.0",
  "type": "module",
  "engines": { "bb": ">=0.9", "bbPluginSdk": ">=0.4.3" },
  "bb": {
    "name": "Hello",
    "description": "A friendly example plugin.",
    "branding": { "icon": "Zap" },
    "server": "./server.ts",
    "app": "./app.tsx",
    "host": "./host.ts",
    "skills": ["skills"]
  }
}
```

- `bb.server` (required) — backend entry. Path installs load it as
  TypeScript directly (no build step); `bb plugin build` also emits a
  self-contained `dist/server.js` + `server.meta.json` that git/npm installs
  prefer when its SDK major matches, so consumers never need npm or
  node_modules. `bb.app` (optional) — frontend entry compiled by
  `bb plugin build` into minified `dist/app.js` + `app.css` + `app.meta.json`
  (`bb plugin dev` keeps them readable); path and git installs build it
  automatically at install time. Git installs also
  run `npm install --omit=dev` first (so a git plugin may use third-party
  packages) and keep node_modules, since bundling cannot inline data files read
  at runtime. So every package your source imports that bb does not shim
  belongs in `dependencies`: a build-required package left in
  `devDependencies` makes the plugin uninstallable from git, and unbuildable
  after any install that omits dev deps — including the packaged CLI's own,
  which runs npm under `NODE_ENV=production`. `devDependencies` is for types
  and tooling only.
- `bb.host` (optional, singular) — full-trust Node 22 ESM entry bundled into
  `dist/host.js` + source map + `host.meta.json`. Its owning server entry calls
  it through typed host RPC. The daemon downloads it lazily, verifies its
  digest, and reuses one worker per plugin generation. Pure JavaScript
  dependencies are bundled; host code may use Node APIs such as
  `child_process`, `fs`, and `fetch`.
  Installing or updating a git plugin needs `npm` on PATH; checking for
  updates does not, because a check reads the manifest and never builds. Path
  installs build from dependencies you have already installed.
- Building yourself (CI, or verifying a build without a running bb): add
  `bb-app` to `devDependencies` and set `"build": "bb plugin build"`.
  `bb plugin build` needs no server, and depending on `bb-app@X` builds
  against exactly that release's shim configuration. bb downloads its build
  toolchain on first use, so cache `<dataDir>/plugins/toolchain-*` in CI.
- `bb.skills` (optional) — relocates the auto-imported skills directories
  (default `skills/`; `[]` opts out). Every `skills/<name>/SKILL.md` is
  injected into agent threads as the plugin skills tier.
- `bb.themes` (optional) — contributes palettes to Settings → Appearance and
  `bb theme list`. Each entry is
  `{ id, name, description?, css: "./themes/name.css", codeTheme? }`;
  `codeTheme` is `{ dark?, light? }` where each side is a bundled Shiki /
  Pierre name or a plugin-relative VS Code theme `.json` file. bb namespaces
  its selectable id as `plugin:<plugin-id>:<id>`. Only loaded plugins
  contribute.
- `bb.name` and `bb.description` (required) — non-empty human-facing plugin
  identity. The top-level package `name` remains the package identity and
  source of the plugin id.
- `bb.branding` (required) — declare `bb.branding.icon` as either the plugin's
  canonical BB icon name, such as `Zap`, or a plugin-relative compact SVG path
  such as `./assets/icon.svg`. BB validates and hash-serves path-shaped SVGs,
  then renders them as CSS masks so their shape inherits the surrounding text
  color; SVG colors are ignored. BB reuses this icon on roomy surfaces when no
  logo override is declared. Add `logo.light` only for
  intentionally different rich/full-size identity artwork; optional
  `logo.dark` is preferred in dark mode. Logo paths are explicit
  plugin-relative `.svg`, `.png`, or `.webp` files: nulls, empty strings,
  missing/escaping files, unsupported extensions, and a dark logo without a
  light logo fail the manifest. There is no root logo auto-detection. Logo-only
  manifests remain supported for compatibility, so at least an icon or light
  logo is required. BB uses a declared logo where space permits, such as roomy
  Settings rows and cards.
  Compact sidebar, menu, action, mention, and panel-title surfaces prefer the
  plugin-owned icon asset, then a named manifest icon, then a contribution's
  local `icon` hint, then Zap. Branding changes are picked up on
  `bb plugin reload`. Named inline icons use `currentColor`; compact SVG assets
  should contain only the intended transparent glyph shape. Do not duplicate
  the same artwork across `icon` and `logo`; reserve logos for intentionally
  different branded artwork and provide a dark variant when needed.
- `engines.bb` — optional semver range checked against the bb app version.
- `engines.bbPluginSdk` — optional semver range for the plugin SDK surface
  (currently `0.4.3`; the scaffold writes `">=0.4.3"`). bb reads it as a floor,
  not a ceiling: a later SDK in the same major still loads the plugin, so a
  caret range keeps working after the SDK moves forward. Absent means a legacy
  manifest. Managed (`git:`/`npm:`) installs **refuse** a plugin that needs a
  newer SDK than the host provides, or one pinned to a different major; path
  installs surface it as `incompatible` at load.
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
- `bb plugin build` stamps authoritative metadata into every declared
  artifact's `dist/*.meta.json`: `sdkMajor`, `sdkVersion`,
  `artifactFormatVersion` (currently `1`), `pluginId`, `pluginVersion`, and
  `builtWith: { bbVersion, pluginSdkVersion }`. Managed installs reject
  artifacts whose `pluginId`/`pluginVersion` disagree with the package
  manifest, or whose SDK major does not match the host.
- Default to `bb-plugin-hello` for the package name. Scoped names such as
  `@acme/bb-plugin-hello` are also supported. The plugin id is the final
  package-name component minus the `bb-plugin-` prefix, so both forms use
  `hello`; it namespaces routes, storage, settings, and CLI commands. Builtin
  ids such as
  `automations`, `connect`, `custom-instructions`, `inline-vis`, and `secrets`
  cannot use a non-`builtin:` source — use `builtin:<name>` instead.

Backend API imports normally stay type-only;
the root runtime exports are `defineRpcContract`, supplied by BB for shared
schema contracts, and the numeric `PLUGIN_CLI_OUTPUT_MAX_BYTES` ceiling:
`import { defineRpcContract, type BbPluginApi } from
"@get-bb/plugin-sdk"`. Validator imports such as Zod are normal plugin runtime
dependencies (and are bundled by `bb plugin build`).

On-disk state per plugin: `<dataDir>/plugins/<id>/data.db` (its SQLite),
`secrets/` (secret settings + HTTP token), `logs/plugin.log` (JSONL,
rotated at 5MB). Settings edits never auto-reload — `bb plugin reload <id>`
after configuring.

## Looking up the exact API

This skill is a guide, not the contract. For an exact signature or a symbol it
does not cover:

1. **`bb plugin types`**, run in the plugin directory (or given its path),
   syncs that plugin's SDK surface to the running bb — no server needed. For a
   plugin that depends on the npm package it repins the exact
   `@get-bb/plugin-sdk` devDependency to this bb's SDK version (run
   `npm install` after); for an older plugin that still vendors `types/*.d.ts`
   it rewrites those declarations. Either way a cloned or older plugin can be
   thousands of lines behind. `--check` reports a mismatch without writing;
   `bb plugin build` and `bb plugin dev` keep things in step too.
2. **Read the bundled declarations** — the authoritative surface, ~13,000
   lines of readable declarations with doc comments:
   - plugins scaffolded by a current bb depend on the npm package, so after
     `npm install` read
     `node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts`
     (`bb-plugin-sdk-app.d.ts` for frontend symbols and
     `bb-plugin-sdk-host.d.ts` for the host entry);
   - plugins scaffolded before that still carry the root declaration in
     `types/bb-plugin-sdk.d.ts` (plus `types/bb-plugin-sdk-app.d.ts` for an
     app), which the plugin's `tsconfig.json` maps
     `@get-bb/plugin-sdk` onto. Read whichever the plugin in front of you has.
     That layout still works for existing entries, but migrate before adding
     `bb.host` so the `/host` and `/testing/host` subpaths are present; `bb
plugin migrate` converts such a plugin to the npm package (it prints the plan
     and asks first, and needs `--yes` when stdin is not a terminal). Never
     migrate a plugin the user did not ask you to migrate.
3. **`git clone --depth 1 https://github.com/get-bb/bb`** for host behavior or
   a reference implementation: `packages/plugin-sdk/src/`,
   `apps/server/src/services/plugins/`, `plugins/`.

Never answer an API question from a built bundle — `dist/*.js` and the bb app's
own JavaScript are minified. If you are grepping minified JavaScript, go back
to step 1.

## Distributing a plugin

Users can install third-party plugins directly from a local path, npm package,
or Git repository:

```sh
bb plugin install ./bb-plugin-notes
bb plugin install npm:bb-plugin-notes@^1.0.0
bb plugin install https://github.com/acme/bb-plugin-notes
bb plugin install git:https://github.com/acme/bb-plugin-notes.git@main
bb plugin install git:https://github.com/acme/bb-plugin-notes.git@^1.2.0
```

A bare HTTP(S) repository URL tracks its default branch. Use the `git:` form
with an explicit branch, tag, or commit when that tracking intent matters.

### Releasing a git plugin with semver tags

Tag each release `vX.Y.Z` and users can install a range instead of a ref:
bb reads the repository's tags, installs the highest release the range allows,
and `bb plugin update` moves them to later releases in the same range.
Prereleases stay out unless the range names one. Give each plugin of a
multi-plugin repository its own tag prefix — `notes/v1.2.3` — and users add
`--tag-prefix notes/`.

bb records the tag it installed together with the commit that tag pointed at,
and refuses the plugin if that tag is ever moved to another commit. Publish a
fix as a new version rather than retagging.

### Several plugins in one repository

Keep each plugin in its own directory with its own `package.json`, then index
the directories in a `.bb/plugins.json` collection manifest at the repository
root:

```json
{
  "$schema": "https://getbb.app/schemas/plugins.schema.json",
  "schemaVersion": 1,
  "name": "acme-plugins",
  "plugins": [
    { "name": "notes", "source": "./plugins/notes" },
    { "name": "status", "source": "./plugins/status" }
  ]
}
```

Each `source` is a repository-relative directory that starts with `./`. The
file is an index only — it never overrides a plugin's identity, branding,
entry points, or engine ranges. Users install one plugin at a time:

```sh
bb plugin install git:https://github.com/acme/bb-plugins.git@main --plugin notes
bb plugin install git:https://github.com/acme/bb-plugins.git@main --subdirectory plugins/notes
bb plugin install path:. --plugin notes
```

`--subdirectory` works without a collection manifest; `--plugin` resolves an
entry name from it. If the repository is not itself a plugin, an install with
neither flag fails and lists the entry names.

### Publishing your own marketplace

A marketplace is one `marketplace.json` file. It lists plugins with their
store branding and their npm or git source; it never hosts plugin code, and
installing an entry runs the same install pipeline a direct install runs.

```json
{
  "$schema": "https://getbb.app/schemas/marketplace.schema.json",
  "schemaVersion": 1,
  "name": "acme-plugins",
  "displayName": "Acme Plugins",
  "description": "Plugins the Acme team maintains.",
  "plugins": [
    {
      "id": "notes",
      "displayName": "Notes",
      "description": "Keep notes beside a thread.",
      "icon": { "url": "./icons/notes.svg" },
      "tags": ["notes", "interface"],
      "author": { "name": "Acme", "github": "acme", "url": "https://acme.dev" },
      "engines": { "bb": ">=0.0.34" },
      "source": {
        "git": {
          "url": "https://github.com/acme/bb-plugins.git",
          "subdir": "plugins/notes",
          "range": "^1.0.0",
          "tagPrefix": "notes/"
        }
      }
    }
  ]
}
```

The schema is strict: an unknown field rejects the whole document, and the
last catalog bb validated keeps serving. `name` is the marketplace's identity
and must be unique on the user's machine; `bb-community` is reserved. `engines`
may narrow a plugin manifest's ranges and never widen them. Icons are `.svg`,
`.png`, or `.webp`, either an absolute https URL or a path relative to the
manifest — bb fetches and validates them server-side and serves them from its
own origin.

Host it three ways, and users add whichever fits:

```sh
bb marketplace add https://plugins.acme.dev/marketplace.json
bb marketplace add git:github.com/acme/bb-marketplace@main
bb marketplace add path:/work/acme-marketplace
```

An https marketplace is re-read with a conditional request; a git one is
cloned into a throwaway checkout each refresh, with `marketplace.json` and any
relative icons read from the repository root. Prefer git tag ranges over
pinned refs so a release reaches users without a catalog change. Before
installing from a marketplace that is not `bb-community`, bb resolves and shows
the true source — including the exact release tag and commit a range lands
on — so keep your listed URL, subdirectory, and range honest.

BB's own official plugins are separate: inclusion in the `bb-community`
marketplace is a BB release decision, not part of the plugin authoring
workflow, and the bundled official plugins ship inside the app itself and
install from that local copy with no network fetch.

## The backend factory

```ts
import type { BbPluginApi } from "@get-bb/plugin-sdk";

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
instruction providers or mention providers are rejected.
Listeners are different: `bb.events.on`, settings `onChange`, and `onDispose`
are additive, so registering multiple listeners is supported.

### bb.log

`bb.log.debug|info|warn|error(message: string)` — goes to the server log
(prefixed `[plugin:<id>]`) and to the per-plugin JSONL file behind
`bb plugin logs <id> [-n N] [-f]`.

### bb.settings

`bb.settings.define(descriptors)` declares plain-data descriptors (rendered
in Extensions → Plugins and editable via `bb plugin config <id> set <key>
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

For a plugin with a singular `bb.host` entry, define one runtime contract
shared by the server and host modules:

```ts
// contract.ts
import {
  defineRpcContract,
  type ExperimentalHostSignals,
} from "@get-bb/plugin-sdk";
import { z } from "zod";

export const hostContract = defineRpcContract({
  setEnabled: {
    input: z.object({ enabled: z.boolean() }).strict(),
    output: z.object({ enabled: z.boolean() }).strict(),
  },
});

export const hostSignals = {
  changed: {
    payload: z.object({ reason: z.string() }).strict(),
  },
} satisfies ExperimentalHostSignals;
```

The host entry default-exports its implementation:

```ts
// host.ts
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract, hostSignals } from "./contract.js";

export default experimental_defineHostEntry({
  contract: hostContract,
  experimental_signals: hostSignals,
  handlers: {
    setEnabled: async ({ enabled }, context) => {
      await setEnabled(enabled, context.signal);
      await context.experimental_emitSignal("changed", {
        reason: "setting-applied",
      });
      return { enabled };
    },
  },
  dispose: async () => closeChildren(),
});
```

The server factory calls only its own host entry:

```ts
const host = bb.hosts.experimental_client({
  contract: hostContract,
  experimental_signals: hostSignals,
});
const result = await host.call(
  "setEnabled",
  { enabled: true },
  { hostId, signal },
);
const unsubscribeWorkerExit = host.experimental_onWorkerExit(({ hostId }) => {
  // Reassert durable desired state; the next call starts a fresh worker.
});
const unsubscribeChanged = host.experimental_onSignal(
  "changed",
  ({ hostId, payload }) => {
    // Invalidate or reread server state for this host.
  },
);
```

Create the client and register signal handlers in the factory, but call host
methods only after registration completes — from an RPC/event handler,
background service, or timer. Candidate-time calls are rejected because that
generation is not active or fetchable yet.

`context.signal` aborts one call. `context.lifecycle.signal` aborts the whole
worker process on idle eviction, reload, disable, uninstall, or daemon
shutdown. Close timers, sockets, and child processes from the lifecycle signal
and `dispose`.
`context.experimental_paths.dataDir` is persistent and scoped to this plugin on
the targeted daemon; `tempDir` is deleted with the worker process.
`context.experimental_watch(options, listener)` uses the daemon's native file
watcher. Deliveries are coalesced and serialized while the listener is busy;
on `rescan-required`, reread current state instead of trusting prior events.
Subscriptions are disposed with the worker and can also be disposed directly.
Active calls and native watches automatically keep the worker running. For
independent background work, acquire a lease during a handler with
`context.experimental_retainWorker()` and dispose it when that work stops.
Lease disposal is idempotent.

Host signals are schema-validated, private to the plugin that owns the host
entry, and ephemeral. Use them as invalidations or progress notifications, not
as durable state; the server callback receives the authenticated `hostId`.
V1 calls still target only an explicit enrolled host. If a method operates on
an environment or directory, resolve it with `bb.sdk` and put the needed id or
absolute path in that method's typed input. Core does not infer an environment,
cwd, or lock for host RPC.

The worker is lazy and reusable; there is no short-/long-lived manifest flag.
After five minutes with no active call, native watch, or retained lease, the
daemon gracefully stops it. A later call starts it again. This idle stop does
not emit `experimental_onWorkerExit`. A crash fails in-flight calls, emits
`experimental_onWorkerExit` to the active server generation, and a later call
starts a fresh worker. Graceful reload, disable, uninstall, and daemon shutdown
do not emit it. The event is ephemeral, so long-lived plugins must also
reconcile when their target host reconnects. On reconnect, the daemon keeps
workers whose generation is still active and disposes generations disabled or
replaced while it was offline. There is no global worker-count limit. Host code
receives the normalized user `PATH` without daemon-owned `BB_*` variables.

These single-worker, idle-eviction, retention, and call-timeout rules describe
the host RPC consumer only. Another daemon subsystem may attach the same
`bb.host` artifact through a different bootstrap and own a separate process
lifecycle.

Host production code may import public `@get-bb/plugin-sdk` entrypoints, Node
APIs, and ordinary third-party dependencies. It must not import private
monorepo packages such as `@bb/domain`, `@bb/host-workspace`, or any other
`@bb/*` package; the host artifact build rejects those imports anywhere in its
dependency graph, including type-only imports and relative paths that resolve
into a private package. Keep shared contract types plugin-local and validate
them at the RPC boundary.

Keep `@get-bb/plugin-sdk` in exact `devDependencies`, not production
dependencies. The host builder supplies its small runtime helpers and bundles
them into the self-contained artifact, including for managed Git installs that
omit dev dependencies. The daemon never resolves the SDK or private BB
packages from the plugin at runtime.

Pure JavaScript dependencies are bundled. For external tools, use
`child_process` to probe or invoke tools on `PATH`. bb V1 provides no
privileged package installer; a plugin that invokes a system installer owns
user consent, elevation, platform-specific behavior, and recovery.

The rest of `bb.hosts` controls shared loopback port exposure.

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
the plugin's own dispose hooks run. Plugins do not receive daemon streaming or
socket primitives. Add streaming only for a use case that cannot use bounded
calls, pagination, and lossy invalidation signals.

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

**Area map.** Every area below is reachable from `bb.sdk`. This lists the
methods, not their arguments — read the bundled `bb-plugin-sdk.d.ts` for exact
signatures (see "Looking up the exact API").

| Area             | Methods                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `threads`        | `list` `get` `search` `spawn` `fork` `send` `update` `delete` `stop` `compact` `wait` `open` `output` `timeline` `conversationOutline` `promptHistory` `archive` `archiveAll` `unarchive` `pin` `unpin` `reorderPinned` `markRead` `markUnread` `childSummary` `paneAction` `timelineTurnSummaryDetails` `storageFiles` `storageLocation` `storagePaths` `cancelPlan` `clearGoal` `defaultExecutionOptions`; sub-areas `events` (`list` `wait`), `interactions` (`get` `list` `cancel` `resolve` `respond`), `queuedMessages` (`create` `list` `update` `delete` `send` `reorder` `setGroupBoundary`), `tabs` (`get` `update`) |
| `threadSections` | `list` `create` `update` `delete`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `projects`       | `list` `get` `create` `update` `delete` `reorder` `paths` `files` `fileContent` `branches` `commands` `defaultExecutionOptions` `promptHistory`; sub-areas `attachments` (`upload` `read` `copy`), `sources` (`add` `update` `delete`)                                                                                                                                                                                                                                                                                                                                                                                         |
| `environments`   | `get` `update` `status` `paths` `commit` `archiveThreads` `diff` `diffFile` `diffFiles` `diffBranches` `diffPatch` `pullRequest` `markPullRequestDraft` `markPullRequestReady` `mergePullRequest` `squashMerge`                                                                                                                                                                                                                                                                                                                                                                                                                |
| `hosts`          | `list` `get` `update` `delete` `directory` `pathsExist` `pickFolder` `cloneDefaultPath` `createJoinCode` `retryUpdate` `providerCliStatus` `installProviderCli`                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `files`          | `read` `write` `list` `listPaths` `mkdir` `move` `remove` `createPreview`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `terminals`      | `list` `create` `get` `input` `output` `resize` `rename` `restart` `close`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `providers`      | `list` `models`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `skills`         | `list` `listFiles` `getContent` `update` `remove`; sub-area `registry` (`search` `get` `detail` `install` `repositoryStars`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `plugins`        | `list` `install` `remove` `enable` `disable` `reload` `token` `callRpc` `getSource` `getSettings` `updateSettings` `checkUpdates` `listUpdateResults` `applyUpdate`; sub-area `catalog` (`search` `status` `install`)                                                                                                                                                                                                                                                                                                                                                                                                          |
| `theme`          | `get` `catalog` `set`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `status`         | `get`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `system`         | `version` `config` `reloadConfig` `attention` `usageLimits` `executionOptions` `providerStates` `transcribeVoice` `updateGeneralSettings` `updateKeyboardSettings` `updateExperiments` `cliSkillsStatus` `installCliSkills`                                                                                                                                                                                                                                                                                                                                                                                                    |
| `guide`          | `render` (the `bb guide` text; local, no request)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

Prefer your own `bb.settings` and `bb.storage` over `sdk.system` and
`sdk.plugins` for your plugin's own configuration. The `system` and `plugins`
areas write app-wide state that the user owns.

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

Read and edit existing threads with the same area — you do not need a
sidebar panel or a spawned thread to reach them:

```ts
const { threads } = await bb.sdk.threads.list({ projectId, limit: 50 });
const thread = await bb.sdk.threads.get({ threadId });
const timeline = await bb.sdk.threads.timeline({ threadId });
await bb.sdk.threads.update({ threadId, title: "Fix the flaky test" });
```

`threads.list` filters on `projectId`, `parentThreadId`, `sourceThreadId`,
`sectionId`, `originKind`, `originPluginId`, `archived`, `unsectioned`,
`hasParent`, and `includeHidden`, and it pages with `limit` and `offset`.
`threads.update` writes `title`, `sectionId`, `parentThreadId`, `model`,
`reasoningLevel`, and `visibility`. Use `threads.timeline` (or
`threads.output` for the last assistant text) to read a thread's messages.
For raw history, `threads.events.list` defaults to ascending order and supports
exclusive `afterSeq` / `beforeSeq` cursors, `order: "asc" | "desc"`, and a
non-empty typed `types` array. Combine `order: "desc"` with `beforeSeq` to page
backward from the newest matching events without reading unrelated payloads.

Use `visibility: "hidden"` for background workers. Hidden threads stay
out of sidebar organization and do not contribute unread/pending favicon
attention. They otherwise retain ordinary
list, search, prompt-history, section, lifecycle, parent-operation, direct-open,
and direct-ID behavior. A thread you spawn with a `parentThreadId` inherits the
parent's visibility when you omit `visibility`, and a hidden child still
reports its turns and blockers to its parent. This is an organization contract, not a security
boundary: plugins are full-trust server code.

Hidden worker threads need explicit runtime cleanup. Stop each hidden thread
promptly after its final result, including error paths. Stop releases an active,
idle, or stuck runtime and preserves the thread for a later resume. Archive
first when the worker no longer belongs in active lists. Use a `finally`
block so a plugin failure cannot retain the agent process:

```ts
const worker = await bb.sdk.threads.spawn({
  projectId,
  environment: { type: "project-default" },
  prompt: "Review this change.",
  visibility: "hidden",
});

try {
  await bb.sdk.threads.wait({ threadId: worker.id, status: "idle" });
  return await bb.sdk.threads.output({ threadId: worker.id });
} finally {
  await bb.sdk.threads.archive({ threadId: worker.id });
  await bb.sdk.threads.stop({ threadId: worker.id });
}
```

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

`thread.created` fires on row creation, so the first user message is not
always in the timeline yet. To react to a thread's content, listen on
`thread.active` or `thread.idle`, then read the messages with
`bb.sdk.threads.timeline`. Because handlers are fire-and-forget, work you do
in a handler — including `bb.sdk.threads.update({ threadId, title })` —
cannot delay or interrupt the thread's turn.

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
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
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
import { useRpc } from "@get-bb/plugin-sdk/app";
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
`PLUGIN_CLI_OUTPUT_MAX_BYTES` from `@get-bb/plugin-sdk` (1,048,576 UTF-8 bytes).
The host rejects a larger result atomically as `plugin_cli_output_too_large`;
it never clips it. Page growing collections, cap verbose fields, and use
file/streaming commands for large content. Caveat: under the workspace
sandbox (Accept Edits / Approve for me), Claude's macOS sandbox permits
loopback, so `bb` CLI calls (including plugin commands) work sandboxed;
Linux and other provider sandboxes may still block loopback, in which case
those calls need escalation approval.

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
  // Optional experimental native timeline labels. Without these, BB shows
  // its normal tool name and arguments. Errors/interruptions keep that
  // standard rendering so the failing tool remains identifiable.
  experimental_statusLabels: {
    pending: "Searching bundled docs",
    completed: "Searched bundled docs",
  },
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

`experimental_statusLabels` is optional and supplies static, concise labels
keyed by BB's timeline row status (`pending`, `completed`). Each label is
limited to 80 characters; a longer label rejects the registration. BB snapshots the
labels into each plugin tool-call event; it is not a frontend bundle hook. A
status with no label — error, interrupted, or awaiting approval — falls back
to BB's standard `Running tool …` / `Ran tool …` wording, as does omitting the
field entirely.

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
hot-mutates a running provider session. Instructions follow the same rule: a
live provider session keeps the instructions it was constructed with, and
changed instructions apply when the session is next constructed.
Skill catalog changes follow the daemon's established runtime policy: a busy
environment keeps its current staged catalog until a safe relaunch. Side chats
evaluate `configure` with `sideChat: true`; returned tool, skill, and dynamic
instruction selections apply at those same boundaries. Independent side-chat
safety policy such as permission escalation is unchanged. The legacy
`contributeInstructions` provider remains excluded from side chats, so use
`configure` for side-chat-aware dynamic instructions.

### bb.providers.register — agent providers

A plugin can contribute a full agent provider: a picker entry whose threads
run on a **provider bridge** the plugin ships. The working reference is
`examples/plugins/echo-provider` — declaration, bridge, and conformance test
in one small package. (`bb.agents.experimental_registerProvider` is the older
name for the same call and still works.)

```ts
bb.providers.register({
  id: "echo-agent", // stable public id; thread rows persist it
  displayName: "Echo Agent", // 1-80 chars, shown in the picker
  icon: "./icons/echo.svg", // optional; same grammar as bb.branding.icon
  experimental_family: "echo", // optional grouping key for related providers
  // Copy core surfaces render (usage banners, pickers, the guide).
  experimental_strings: {
    signInHint: "Run `echo-agent login` on the machine to sign in.",
    expiredHint:
      "Your Echo session expired. Run `echo-agent login`, then reload.",
    installUrl: "https://example.com/echo-agent",
    brandPrefix: "Echo ", // optional; stripped from model display names
    planModeCopy: "Echo will plan without executing.", // optional
    iconTint: { light: "#334155", dark: "#CBD5E1" }, // optional
  },
  // Optional immutable JSON forwarded opaquely to this plugin's bridge.
  experimental_bridgeOptions: { launch: { command: "echo-agent" } },
  // "installed" hides the row until provider/health finds the executable.
  experimental_visibility: "always", // default
  capabilities: {
    // Sessionless support is declared here so bb can avoid unsupported host
    // probes and hide providers that never expose usage. A shared bridge that
    // declares usage may still return no windows or supported: false for one id.
    experimental_providerHealth: false,
    experimental_providerUsage: false,
    experimental_providerInstallation: false,
    supportsServiceTier: false,
    supportsNativeUserQuestion: false,
    fork: "none", // "none" | "tip" | "checkpoint"
    supportsManualCompaction: false,
    supportsThreadArchive: false, // bb mirrors archive/unarchive onto it
    supportsThreadRename: false, // bb forwards renames to it
    permissionModes: ["full"], // non-empty, no duplicates
    reasoningLevels: ["medium"], // coarse fallback ladder
  },
  // Labelled picker options; the coarse ladder above is labelled for you
  // when these are omitted. `model/list` is precise per model at runtime.
  experimental_reasoningLevels: [{ id: "medium", label: "Medium" }],
  experimental_serviceTiers: undefined, // e.g. [{ id: "fast", label: "Fast" }]
  composerActions: [], // skills typeahead is implicit; ["plan"] opts into plan mode
  // Cold-cache fallback models: shown only until the first model/list probe
  // completes, or when a probe fails transiently. Exactly one isDefault.
  experimental_models: { fallback: [] },
  // Daemon env vars the bridge may read. Provider processes are spawned with
  // inherited BB_* variables stripped; exactly these are forwarded.
  experimental_env: { passthrough: ["BB_ECHO_AGENT_EXECUTABLE"] },
  // Called by the server on EVERY session and turn command. The returned
  // JSON reaches the bridge as `options.providerOptions`; core never reads
  // it. This is where the provider's own knobs travel — read them from the
  // plugin's own `bb.settings.define` values in `ctx.settings` (secrets are
  // omitted). `ctx.promptMode` is "plan" when the prompt entered plan mode.
  experimental_deriveProviderOptions(ctx) {
    return {
      verbose: ctx.settings.verbose === true,
      plan: ctx.promptMode === "plan",
    };
  },
});
```

**The icon.** `icon` takes the same two shapes as `bb.branding.icon`: a named
host glyph (`"Zap"`) or a plugin-relative SVG path (`"./icons/echo.svg"`). A
path is served to clients as a `logoUrl` and drawn through `<img>`, so its
`currentColor` cannot follow the bb theme; a glyph name carries no bytes, so
there is no `logoUrl` at all. For a monochrome mark, ship an `app.tsx` too and
register the same artwork with
`app.slots.experimental_providerIcon({ providerId, icon })` — it renders
inline and inherits the theme. Example:

```tsx
// app.tsx
import { definePluginApp } from "@get-bb/plugin-sdk/app";

function EchoIcon({ className }: { className?: string }) {
  return (
    <svg fill="currentColor" viewBox="0 0 24 24" className={className}>
      <path d="…" />
    </svg>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_providerIcon({ providerId: "echo", icon: EchoIcon });
});
```

(The four first-party provider plugins ship no `app.tsx`: bb vendors their
marks itself, so an icon-only bundle would only add fetches at boot.)

Ids are flat and collision-rejected: the first live registration of an id
wins and a later one from another plugin fails that plugin's load; no id is
reserved ahead of time. Registrations replace wholesale on reload like every
other surface. Disabling the plugin removes the provider (open threads show a
provider-unavailable state instead of erroring). The provider picker lists
providers in plugin install order (bundled first-party plugins first); the
user reorders them and picks a default in Settings → Providers
(`bb settings general providerOrder '["my-agent","codex"]'` and
`bb settings general defaultProviderId my-agent`).

`experimental_bridgeOptions` must be a plain JSON object no larger than 64
KiB. It is validated and frozen at registration, then carried on every bridge
request as provider-scoped static options. Use it for immutable launch facts
shared by all hosts, not user settings or machine-local state. It participates
in bridge process identity, so changing it causes the next runtime to use a
new bridge process. `experimental_visibility: "installed"` makes the provider
host-dependent: BB asks that provider's bridge for `provider/health` and lists
it only when the status is not `not_installed`. Such a declaration must support
health; bridge failures hide only that provider.

**The bridge.** A provider bridge ships inside the plugin's `bb.host`
artifact — the same artifact a host RPC entry ships in, and a plugin may have
both. Export it by name:

```ts
// host.ts (bb.host)
import { experimental_defineProviderBridge } from "@get-bb/plugin-sdk/provider-bridge";

export const experimental_providerBridge = experimental_defineProviderBridge({
  handleLine(line) {
    /* one JSON-RPC line from the runtime */
  },
  // Optional; called once before the first line, with this plugin's
  // persistent dataDir and this process's own tempDir.
  start({ pluginId, dataDir, tempDir }) {},
  onClose() {}, // stdin closed: the runtime is gone
  onSigterm() {},
});
```

Do NOT start the bridge yourself: the daemon owns the process boundary (argv,
plugin-scoped directories, bounded stdin framing, signals) and imports this
export out of the artifact. Importing the module must start nothing, which is
also what lets your conformance test drive `handleLine` in-process.

Everything a bridge compiles against is published at
`@get-bb/plugin-sdk/provider-bridge` — protocol schemas including the
`thread/delta` grammar, and the bridge kit — so add `@get-bb/plugin-sdk` to
`dependencies` (not just `devDependencies`). A `bb.host` artifact cannot
import bb's private `@bb/*` workspace packages; an installed plugin could
not resolve them.

The bridge speaks the canonical Provider Bridge Protocol — line-delimited
JSON-RPC 2.0 over stdio, documented in `docs/provider-bridge-protocol.md`.
Minimum correct surface: the `initialize` handshake
(`{protocolVersion, capabilities}`, protocol version 2 — the runtime rejects
any other version at spawn), `thread/start` / `thread/resume` answering
`{providerThreadId}` after a `thread/identity` notification and then a
`session.reset` delta (every session construction is a provider id-space
boundary), `turn/start` driving the delta grammar as batched `thread/delta`
notifications (`input.accepted` → `turn.open` → item/message deltas →
`turn.boundary`), `thread/stop` honoring both intents (`release` must
fabricate nothing), and reply hygiene: unknown method → `-32601`, invalid
params → `-32602` with the issues, never a silent drop. The bridge emits
parsed semantic deltas keyed by provider-native ids (tool-call ids, stream
keys, parent refs); the runtime's delta assembler — never the bridge —
mints every bb turn and item id and constructs the canonical timeline
events.

**Conformance.** Ship a test that drives
`@bb/provider-bridge-protocol/conformance` against your bridge in-process:
export the bridge surface, wire `runBridgeConformance` with a
transport whose `send` calls it and whose `takeMessages` drains captured
stdout, and assert all eleven scenarios pass (see
`examples/plugins/echo-provider/provider-bridge.conformance.test.ts`).

**Delivery.** On install/reload the server builds `dist/host.js` and records
its digest. Thread commands for the provider carry `{pluginId, digest}` to the
host daemon, which downloads the bytes from the server, verifies the digest
before caching them, and runs the artifact with its own node — it never
executes unverified bytes. It is one cache and one route with the host RPC
worker, because it is one artifact.
Trust model: installation trust, exactly like every other plugin surface. A
bridge runs only for an installed, enabled plugin, and only on hosts whose
server instructs it.

### bb.ui — host-rendered UI (no frontend bundle needed)

```ts
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

`app.tsx` default-exports `definePluginApp` from `@get-bb/plugin-sdk/app`.
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
  experimental_FileLink as FileLink,
  experimental_UrlLink as UrlLink,
  useComposer,
  useComposerView,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner"; // shimmed to the host toaster
import { Button } from "@/components/ui/button"; // vendored source YOU own
import { Dialog, DialogContent } from "@/components/ui/dialog";

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "editor-enhancement",
    mount({ pluginId, generation, signal }) {
      const onKeyDown = (event: KeyboardEvent) => {
        // Ordinary trusted, same-origin DOM behavior.
      };
      document.addEventListener("keydown", onKeyDown, { signal });
      return () => document.removeEventListener("keydown", onKeyDown);
    },
  });
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
    experimental_fixedTabs: [
      {
        panelId: "board",
        id: "navigation",
        title: "Navigation",
        icon: "PanelRight",
        component: BoardNavigation,
        layout: "flush",
      },
    ],
    experimental_sidebarAccessory: OpenIssueCount,
  });
  app.slots.threadPanelAction({
    id: "issue",
    title: "Open issue",
    component: IssuePanel,
    run: async ({ threadId, openPanel }) => {
      openPanel({ title: `Issue for ${threadId}` });
    },
  });
  app.slots.experimental_newThreadPanelAction({
    id: "template",
    title: "Apply template",
    component: TemplatePanel,
    run: ({ projectId, openPanel }) => {
      openPanel({ title: `Template for ${projectId ?? "projectless"}` });
    },
  });
  app.composer.customize({
    id: "prompt-tools",
    actions: [{ id: "improve", component: ImprovePromptAction }],
    plusMenu: [
      {
        id: "append-checklist",
        label: "Append checklist",
        run: ({ composer }) =>
          composer.updateText(
            (current) => `${current}\n\n- Verify behavior\n- Run checks`,
          ),
      },
    ],
    banners: [{ id: "workflow", component: WorkflowBanner }],
    richText: {
      effects: [
        {
          id: "todo",
          className: "plugin-todo-highlight",
          match: (text) =>
            Array.from(text.matchAll(/\bTODO\b/g), (match) => ({
              from: match.index,
              to: match.index + match[0].length,
            })),
        },
      ],
    },
  });
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
  app.slots.experimental_threadList({
    id: "inbox",
    title: "Inbox",
    description: "One flat list, newest thread on top.",
    component: InboxList,
  });
});
```

### A control in the thread header

`app.slots.experimental_threadHeaderAction` renders a component in the thread
header's action row. It replaced the older backend-only
`bb.ui.registerThreadAction`, so a control that needs to draw live state (a
count, a cluster, a status) is now the only shape:

```tsx
app.slots.experimental_threadHeaderAction({
  id: "subagents",
  title: "Subagents",
  component: ({ threadId, projectId, isCompactViewport }) => { ... },
});
```

The row is a 48px chrome row with 28px controls: render ONE inline control, and
put anything taller in a portalled popover. The host clamps your footprint, so
an oversized control is clipped rather than allowed to break the header. `title`
names the host's wrapper region — your icon-only button still needs its own
accessible name. A split layout renders one header
per pane, so your component mounts once per visible thread — keep per-thread
state in the component, never in a module-level singleton.

A common pairing with a replaced sidebar: hide child threads from the list and
surface them here instead, filtering `experimental_useSidebarThreads()` by
`parentThreadId === threadId`.

### Replacing the sidebar thread list

`app.slots.experimental_threadList` is the one **exclusive** slot: only one
list fills the sidebar's scroll area. Registering activates the replacement
while the plugin is enabled. If multiple plugins register one, the first in
deterministic slot order is active by default; removing it reveals the next.
The user can pin BB's list or a specific provider under
**Settings → Appearance → Sidebar**. The choice is per client.

Your component gets the scrolling list and nothing else. The New-thread button,
the search field, the plugin nav rows, and the footer stay host-rendered —
other plugins live in two of those, so a replaced list must not remove them.
Put your own controls at the top of your scroll area instead.

If the chosen plugin is disabled, uninstalled, or its component throws, bb
renders its own list again (plus a toast on a crash), so the sidebar is never
empty.

The component receives:

```ts
interface PluginThreadListProps {
  activeThreadId: string | null;
  activeProjectId: string | null;
  isCompactViewport: boolean;
  /** Closes the mobile drawer and clears the host search field. Always call it
      after opening a thread, or the sidebar stays in search mode. */
  onNavigate: () => void;
  /** The host search field's text; "" when the field is closed. The host owns
      that field — filter by this rather than shipping a second one. */
  searchQuery: string;
  /** BB's bound thread list. Render it to delegate conditionally without
      re-entering plugin replacement resolution. */
  experimental_Original: ComponentType;
}
```

**Reading and acting on threads.** Two hooks back a replaced list:

```tsx
const { status, threads, projects } = experimental_useSidebarThreads();
const actions = experimental_useSidebarThreadActions();

// threads: PluginSidebarThread[] — id, title, parentThreadId, originKind,
// providerId, activity counts, isUnread/isPinned, environment.branchName,
// host ({ id, name } — the machine, useful when a thread has no branch),
// timestamps, and
// `indicator` (bb's resolved status kind) + `indicatorLabel` (its a11y string).
// Draw your own glyph for `indicator`; the SDK ships no status component.
// Treat an unknown indicator value as "none" — bb adds kinds over time.

// Pull requests are per row and opt-in — a lookup hits the git host, so it is
// deliberately NOT on the thread payload every sidebar loads:
const { pullRequest } = experimental_useSidebarThreadPullRequest(thread.id);
// → { number, title, url, state, attention } | null

actions.open(id, { split: true }); // bb's split placement rules
actions.openNewThread({ projectId }); // also sets the composer's project
actions.setPinned(id, true);
actions.setRead(id, false);
actions.rename(id, "New title"); // silent; for inline editing
actions.archive(id); // archives children too, closes their panes
actions.requestDelete(id); // opens bb's delete confirmation
```

Destructive actions deliberately route through the host's own flow, so there
is no silent `delete`: deletion is recursive, and only bb can show the
confirmation that counts the child threads.

Unit-test a list with `renderSlot(...)` from `@get-bb/plugin-sdk/testing/app`:
seed rows with the `sidebarThreads` option and assert against
`inspection.sidebarActionCalls`.

**Splits.** Rows can drag out to the split area:

```tsx
const { splitProps, isAvailable, layout } =
  experimental_useSidebarThreadSplit(thread.id);

<a {...splitProps} onClick={...}>
  {title}
  {/* layout is data: draw a mini-map, a tint, or nothing */}
</a>;
```

The host owns the gesture rules, including the one that matters if your list
has its own drag-to-reorder: a split drag engages only once the pointer leaves
the sidebar.

**Your row, your menu.** This API ships no components. Build your own context
menu from `experimental_useSidebarThreadActions` — it exposes everything bb's
own menu does, including `requestDelete`, which opens bb's confirmation.

**Keyboard support is a DOM contract.** bb's thread shortcuts find rows by
query selector, not by React state. Put both attributes on each row's anchor or
the surface-specific numbered shortcuts, `thread.next`, and `thread.previous`
silently stop working:

```tsx
<a data-sidebar-thread-shortcut-target="" data-sidebar-thread-id={thread.id}>
```

### The provider directory

`experimental_useProviders()` returns `{ status, providers }` — every
registered agent provider in picker order, as the same `ProviderInfo` the
host's composer reads (`id`, `displayName`, `logoUrl`, `available`,
`capabilities`, `composerActions`, and the declared `strings`,
`reasoningLevels`, `serviceTiers`). It reads the host's own cached roster, so
it costs no extra request. Use it whenever a surface shows a thread's or
automation's provider: never vendor provider names or copy in a plugin.

```tsx
const { providers } = experimental_useProviders();
const name =
  providers.find((provider) => provider.id === thread.providerId)
    ?.displayName ?? thread.providerId;
```

`status` is `"loading"` until the roster arrives and `"error"` when the request
failed; `providers` is empty in both cases, so fall back to the id. The
backend counterpart is `bb.sdk.providers.list()`. Keep the hook in the plugin
entry (`app.tsx`) and pass names down as props, so view components stay pure
and testable outside the plugin runtime.

### Trusted frontend content scripts

`app.contentScripts.register({ id, mount })` runs ordinary
bundled JavaScript/TypeScript in the bb app shell without a React slot. It is
full-trust, same-origin page code — **not a security sandbox**. It can access
the app DOM and any authenticated client state available to ordinary page
code, so install only plugins you trust. bb does not use `eval`, `Function`,
or persisted source strings: the existing `bb.app` build emits a normal CSP-
compatible ESM bundle.

The host mounts scripts in registration order after the bundle loads and
`definePluginApp` setup validates. `mount` receives
`{ pluginId, generation, signal, experimental_setThreadRowStatus? }`:
`generation` is a monotonic per-window mount attempt number, and `signal`
aborts before cleanup starts. The optional experimental setter targets an
explicit thread row with `{ icon, label, tone? }` or clears it with `null`.
Use `tone: "running"` for the host's animated running treatment. The host
scopes statuses to the calling plugin and automatically clears them when that
frontend generation deactivates; feature-detect the setter for compatibility
with older bb clients.

A script may return nothing, a disposer, or a promise of either; async mount
setup is time-boxed to 10 seconds. Keep long-running work outside the returned
promise, observe `signal`, and catch failures in work the host does not await.

A replacement bundle and setup validate before lifecycle cutover. The host
then aborts and disposes the prior generation before mounting candidate scripts,
so listeners and observers never overlap. If a mount throws or rejects, the
host aborts that candidate, disposes already-mounted candidate scripts in
reverse registration order, and publishes none of its slots or CSS. Import or
setup failure also deactivates stale UI because the corresponding backend may
already have been replaced. Disable, stop, removal, and app-window teardown
follow the same abort-then-reverse-dispose path; every returned disposer is
called at most once. Each desktop window, browser tab, and remote client owns
an independent instance.

Synchronous and awaited asynchronous mount/dispose failures are contained and
logged; they cannot stop sibling plugins from activating. The current
window's last load/setup/mount/dispose failure appears on the plugin Settings
detail page. The host cannot catch a detached promise that plugin code creates
and never returns, so detached work must handle its own errors.

Prefer the existing imported `app.css` pipeline for static styles. Its lifetime
follows the plugin UI and content scripts that use it: the host keeps the
stylesheet active while a slot, panel header/accessory, or plugin portal is
rendered and throughout an active content-script generation, then releases it
after the final consumer. Imported `app.css` is therefore not an app-wide CSS
hook. Put app-wide selectable palette CSS in manifest `bb.themes` entries;
theme CSS has an independent app-theme lifetime.

Styling or decorating existing app-shell DOM belongs in a content script. A
content script may create DOM or `<style>` nodes when behavior genuinely
requires it, but its abort handler/disposer must remove every node, observer,
listener, timer, class, and style it owns. The context deliberately has no
route/project/thread snapshot yet; use stable SDK hooks inside React slots
rather than polling or installing global navigation observers. Complete
cleanup-safe example: `examples/plugins/content-script`.

Slot props contracts (versioned, additive-only):

- `homepageSection` → `{ projectId: string | null }` (project in view on
  the compose surface). Registration: `{ id, title, component }`.
- `settingsSection` → `{}` (deliberately no props in V1). Rendered on the
  plugin detail page below the host-rendered declarative settings
  form for running, needs-configuration, and degraded plugins. Registration:
  `{ id, title?, description?, component }`; `title` is an optional host-rendered
  section heading and `description` is optional supporting copy rendered with
  that heading. Use the existing hooks (`useRpc`, `useRealtime`,
  `useRealtimeConnectionState`, `useSettings`, `useBbNavigate`, `useBbContext`)
  for data. Enabled plugins appear in the
  settings sidebar when they declare settings descriptors OR register
  settings sections.
- `navPanel` → `{ subPath: string }` — owns the whole route at
  `/plugins/<pluginId>/<path>/*` and gets its own sidebar entry. `subPath`
  is the route remainder after the panel root (`""` at the root), so deep
  links like `/plugins/notes/notes/work/ideas.md` land with
  `subPath: "work/ideas.md"`. Navigate within the panel via
  `useBbNavigate().toPluginPanel(path, { subPath, replace? })` — browser
  back/forward then walks panel-internal history (prefer this over hash
  routing).
  Registration:
  `{ id, title, icon, path, component, experimental_fixedTabs?, experimental_sidebarAccessory?, headerContent? }`.
  BB automatically wraps every plugin page in the same host-owned App panel
  used by New thread and thread pages. The page component supplies only its
  main body; it must not mount a second panel layout or register Browser and
  Terminal itself. BB owns the desktop split, compact drawer, header/panel
  toggle, resizing, tab strip, persistence, and the shared `panel.toggle`,
  `panel.newTab`, and `terminal.open` keyboard commands.

  New tab is a transient host launcher. On a plugin page it offers Browser
  (when the desktop browser is available) and Terminal; it does not offer
  workspace file search because a generic plugin page has no implicit project,
  environment, or working directory. The Terminal row includes a compact
  connected-machine selector, initially resolving the primary machine and then
  the first connected fallback. Changing the selector does not launch
  anything; activating Start terminal uses the selected machine. The selection
  is page-session UI state, not plugin storage.

  Browser and Terminal tabs are normal host content tabs. Closing the final
  content tab closes an otherwise empty panel; if fixed tabs remain, BB falls
  back to the first one instead. Hydration closes an open panel when no durable
  tab survived.

  `experimental_fixedTabs` declares ordered, non-closable page views in that
  same host tab strip:
  `{ id, panelId, title, icon, component, layout?, experimental_target? }`.
  BB opens the
  first fixed tab on the page's first wide-layout visit, but remembers a later
  user close. One tab is active per visible split pane, so multiple fixed-tab
  components can be mounted concurrently. A component mounts only while its
  tab is active in a visible pane; closing the panel unmounts it. It receives
  the same `{ subPath }` as the main page. `layout: "padded"` (the default) gives it
  host padding and scrolling; `layout: "flush"` gives it the full panel content
  region so it can own both. Fixed tabs add content to the shared panel; they
  do not replace its native chrome, Browser, Terminal, or keyboard commands.
  Experimental: see `docs/api_to_audit.md`.

  Every registration's `panelId` must exactly match its containing nav panel's
  `id`; the registration is also the stable reference for selecting that
  plugin-owned tab. A targetable tab declares
  `experimental_target: { validate(value): value is Target }`; BB checks JSON
  safety before calling the owner validator. From any component of the same
  plugin on that page, call
  `experimental_useAppPanel().openFixedTab({ surface: { kind: "current" }, tab,
target? })`. Inside the fixed-tab component,
  `experimental_useFixedTabTarget(tab)` returns `{ sequence, target, clear }`
  after validation. The per-tab target survives inactive-tab, closed-panel,
  and route remounts for the current app session; call `clear()` when the tab
  returns to its untargeted state. Selection persists through the host's
  ordinary panel state, while targets remain memory-only and disappear on app
  refresh. Invalid, unavailable, untargeted, or other-plugin references return
  false without changing valid panel state.

  `experimental_sidebarAccessory` is a no-props, presentational component at
  the trailing edge of the sidebar row. It can own SDK hooks for a live count
  or short status without lifting state into the host sidebar. The host does
  not mount it on compact viewports; on wider viewports it clips the component
  to one line, 4rem wide by 1.25rem high, and ellipsizes ordinary long text.
  It shares the trailing action column and fades out for the host options
  button on row hover or keyboard focus without unmounting. Do not render
  controls or portalled content there. A throw hides only the accessory.
  Experimental: see `docs/api_to_audit.md`.
  The host renders your compact plugin icon + `title` into the SHARED app
  header (the same title bar as Settings pages) with your optional
  `headerContent` component as the header actions on the right — so do NOT
  repeat the title inside your component. The component owns the full-bleed
  body below with zero host padding; add your own padding and scrolling when
  the design needs them. `headerContent` is plugin code inside the host title bar and is
  contained separately: a throw hides the header content without breaking the
  title bar or the panel body. For a classic page, use an outer scroll region
  with `p-4 md:p-5` and wrap its content in a
  `mx-auto w-full max-w-3xl space-y-4` div.

- `threadPanelAction` → an entry in the thread right panel's new-tab
  Actions list (next to "Start side chat" / "Start terminal"), labeled
  `title` with your compact plugin icon. This slot is only offered for an
  existing thread; it never renders on the root New thread screen, and its
  `threadId` stays required. Registration:
  `{ id, title, icon?, component, layout?, run? }`. Activating it calls
  `run({ threadId, openPanel })` — do anything there (rpc, toast), and/or
  call `openPanel({ title?, params? })` to open a closable panel tab
  rendering `component` with `{ threadId: string, params: JsonValue | null }`.
  `openPanel` returns `boolean` — true when the host accepted the open, false
  when it declined (non-JSON `params`, unavailable action, or a surface with
  no side panel). A decline is a return value, never a throw, and matches
  `messageAction`'s `openPanel` and `useBbNavigate().openThreadPanel`, so one
  open routine can serve every action kind. Because `run` is declared
  `void | Promise<void>`, call `openPanel` from a braced body
  (`run: ({ openPanel }) => { openPanel(); }`), not a concise arrow.
  Omitting `run` opens a tab immediately with defaults. Write parameters are
  typed as the recursively JSON-safe `JsonValue` exported by both
  `@get-bb/plugin-sdk` and `@get-bb/plugin-sdk/app`; they persist with the tab across reloads (null when
  none was passed); identical action+params re-opens focus the existing
  tab (title refreshed), different params open sibling tabs. The tab pill
  shows your compact plugin icon + the tab title. Errors thrown from `run`
  (sync or async) are contained and logged, never breaking the launcher.
  `layout` frames the tab content: `"padded"` (default) wraps `component`
  in the panel's scroll container with standard padding — right for
  document-like content; `"flush"` gives it the full tab area (no padding,
  definite height, no host scrolling) — right for app-like content that
  owns its layout, such as `ThreadChat`.
- `experimental_newThreadPanelAction` → the root New thread counterpart to
  `threadPanelAction`. It appears in that screen's right-panel Actions list
  and never appears beside an existing thread. Registration has the same
  `{ id, title, icon?, component, layout?, run? }` shape, but activating it
  calls `run({ projectId, openPanel })` and its component receives
  `{ projectId: string | null, params: JsonValue | null }`; `projectId` is
  null in projectless compose. Panel opening, JSON params, layout, persistence,
  deduplication, the `boolean` return, and error containment otherwise match
  `threadPanelAction`.
  Experimental: see `docs/api_to_audit.md`.
- Removed pre-1.0: `composerAccessory` was the legacy composer footer. Migrate
  controls to `app.composer.customize({ actions })` or `plusMenu`, larger
  content to `banners`, and legacy `{ projectId, threadId }` prop reads to
  `useComposerView().scope`.
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
  detail page in Tools, or do anything else (rpc, toast). Errors from `run`
  (sync or async) are contained and logged,
  never breaking the sidebar. `title` is the tooltip + accessible label;
  `icon` is a BB icon-name hint (unknown names fall back to a generic bolt).
- `fileOpener` → `{ path: string, source, experimental_Original }` — register as a viewer/editor
  for file extensions: `{ id, title, extensions: ["md"], component }`.
  Matching files use the first applicable opener in deterministic slot order
  by default. Users can pin BB's preview or a specific opener per extension
  under Settings → "File openers", and
  right-clicking a file link in rendered markdown offers a one-off
  "Open with …" choice; matching files opened in the right panel then
  render your component in a plugin tab instead of the built-in preview —
  this includes links clicked in rendered markdown, the file picker, and
  `bb thread open`. `source` is
  `{ kind: "workspace" | "host" | "thread-storage", threadId, environmentId,
projectId }` (nullable fields) and `path` follows the source (workspace:
  worktree-relative; host: absolute; thread-storage: storage-relative).
  `experimental_Original` is BB's preview bound to this file; render it to
  delegate conditionally without re-entering plugin replacement resolution.
  Applies only to live file content — git-ref snapshots and deleted files
  always use the built-in preview, and a removed/disabled opener degrades
  back to it. Pair with `bb.sdk.files` (rpc from your server) to load and
  CAS-save the content.
- `experimental_sourceCodeRenderer` / `experimental_diffRenderer` →
  replace bb's source or diff renderer everywhere it draws supplied content:
  the native file preview, timeline file diffs, the environment diff panel's
  file bodies, and every plugin calling the host components. Registration:
  `{ id, title, description?, component }`. Like `experimental_threadList`
  each slot is **exclusive** — one renderer at a time, first in slot order
  wins, and a missing, disabled, or crashing replacement falls back to bb's
  renderer. Installing and enabling the plugin activates it, and the user can
  pin bb's renderer or a specific provider under
  **Settings → Appearance** ("Source code" / "Diffs"), per client. There are no
  scope or extension filters on the registration, so conditional behavior
  belongs in the component. Source props:
  `{ content, path, overflow, highlightedLines, experimental_Original }`;
  diff props:
  `{ patch, path, view, overflow, showLineNumbers, experimental_fullFileContents,
experimental_Original }`. `experimental_fullFileContents` is either
  `{ old: { path, content }, new: { path, content } }` or `null`; a replacement
  can use those complete UTF-8 sides to implement context expansion.
  Every value is already resolved. Render `experimental_Original` (bb's
  renderer, bound to this call) to delegate without re-entering resolution —
  behind a plugin setting, by language, over a size threshold:

  ```tsx
  app.slots.experimental_diffRenderer({
    id: "compact",
    title: "Compact diffs",
    component: ({ patch, path, experimental_Original: Original }) =>
      patch.length > 20_000 ? (
        <Original />
      ) : (
        <MyDiff patch={patch} path={path} />
      ),
  });
  ```

  Experimental: see `docs/api_to_audit.md`.

- `messageDirective` → `{ attributes, source, message,
openWorkspaceFile }` — register a leaf
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
  the path. To open one of the same plugin's registered `threadPanelAction`
  components, call
  `useBbNavigate().openThreadPanel({ actionId, title?, params? })`.
  `params` is typed as `JsonValue`; use normal plugin navigation as the
  fallback when it returns false.
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
- `messageAction` → an action on chat messages: an icon button in the
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
  panel — same semantics and boolean return as
  `useBbNavigate().openThreadPanel`. Errors from `run` (sync or
  async) are contained and
  logged, never breaking the timeline.
- `commandPaletteAction` → a row in bb's quick palette (Mod+Shift+P), listed
  under "Plugins" beside bb's own commands. Host-rendered chrome, no plugin
  component — registration: `{ id, title, isAvailable?, run }`. Both callbacks
  receive `{ threadId, projectId, openPanel }`, where `threadId` and
  `projectId` are null on surfaces without one and `openPanel` matches
  `messageAction`'s. `isAvailable` is called while the palette is open — keep
  it cheap and synchronous — and hides the row when it returns false; a row
  that needs a thread should use it, because the palette opens anywhere and
  `openPanel` declines (returning false) unless a thread view is focused.
  Errors from either callback are contained and logged, never breaking the
  palette. Write self-identifying titles ("Linear: open issue for this
  thread"): the palette matches the query against the title.
- `experimental_providerIcon` → the React component bb draws as one agent
  provider's icon. Registration: `{ providerId, icon }`, where `providerId` is
  the provider's id (`"codex"`, `"acp-cursor"`) — not the plugin id — and
  `icon` is a component receiving only `className` (host sizing plus the
  provider color class). Use it for a theme-aware mark: a file logo
  (`bb.branding.icon`, or a path-shaped provider declaration `icon`) is drawn
  through `<img>`, a separate document where `currentColor` resolves to black
  and is invisible on dark themes, so keep files for intentionally colored
  logos and register a component for anything that should follow the theme.
  A component beats the file logo for that provider; disabling the plugin
  falls back to it. One registration per provider id per plugin; if two
  plugins claim one provider id the host keeps the first by plugin id and
  warns. See the `app.tsx` example under "The icon" above.

Host components:

- `ThreadChat` — bb's complete chat surface for an existing thread, rendered
  wherever plugin React runs (nav panels, thread-panel tabs, homepage and
  settings sections). This is the deliberate exception to the
  no-host-components rule: a stable product capability, not a UI kit. Props:
  `{ threadId, variant?, layout?, focusRequest?, permissionPolicy?,
className?, leadingContent?, messageActions? }` —
  `variant` is `"full"` (standard chat controls, default), `"compact"`
  (side-panel presentation), or `"timeline"` (transcript without a
  composer); `layout` is `"contained"` (fills and scrolls within the
  parent, default) or `"document"` (grows with page content);
  `focusRequest` is a change-detected nonce that focuses the composer;
  `permissionPolicy` is `"inherit"` (default — sends run with the thread's
  own resolved permission mode and the picker renders as a dimmed label, so
  a plugin surface can never widen permissions) or `"editable"` (the
  instance gets a live picker, letting the user set a mode for this thread
  independently of the one it was forked from);
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
- `experimental_ProviderModelPicker` — bb's controlled provider, model, and
  reasoning picker. Props:
  `{ value: { providerId, model, reasoningLevel, serviceTier? }, onChange,
routing?, allowProviderChange?, align?, disabled?, className? }`, where `routing` is
  `{ kind: "host", hostId }` or `{ kind: "environment", environmentId }`.
  It uses the same live catalog, defaults, capability
  reconciliation, retired-model handling, search, and provider branding as
  bb's composers. Provider switches wait for the target provider's verified
  catalog, then emit one coherent value with its default model and resolved
  reasoning without closing the picker; `serviceTier` is retained only when
  that provider supports it.
  Failed or empty catalogs leave `value` unchanged. Alias it on import for JSX:

  ```tsx
  import { experimental_ProviderModelPicker as ProviderModelPicker } from "@get-bb/plugin-sdk/app";

  const [selection, setSelection] = useState({
    providerId: "codex",
    model: "gpt-5.5",
    reasoningLevel: "high" as const,
    serviceTier: "default" as const,
  });

  <ProviderModelPicker value={selection} onChange={setSelection} />;
  ```

  `allowProviderChange={false}` hides the provider tabs while leaving model,
  reasoning, and service-tier controls available for the fixed `providerId`.
  This is independent of routing: one environment can run several providers.
  `align` optionally sets the popover to `"start"`, `"center"`, or `"end"`;
  it defaults to `"start"`.

  Omit `routing` for primary-machine discovery. Route by host for a selected
  machine or by environment when the catalog depends on an existing workspace.
  This is intended for settings and other compact forms that need an execution
  preference without a composer; do not fetch and reconcile provider catalogs
  again in plugin RPC. The built-in Tasks presets and Automations editor are
  reference consumers: both persist the coherent value and use it at spawn.
  Experimental: see `docs/api_to_audit.md`.

- `experimental_PermissionModePicker` — bb's controlled permission-mode
  picker. Props:
  `{ providerId, value, onChange, routing?, align?, disabled?, className? }`.
  The host resolves the provider's supported modes and the routed machine's
  permission ceiling with the same policy as the composer; it emits a corrected
  mode when a provider or routing change makes `value` invalid. A provisional
  or failed lookup never changes `value`. `routing` has the same host/environment
  shape as `experimental_ProviderModelPicker`. `align` accepts `"start"`,
  `"center"`, or `"end"` and defaults to `"end"`:

  ```tsx
  import { experimental_PermissionModePicker as PermissionModePicker } from "@get-bb/plugin-sdk/app";

  <PermissionModePicker
    providerId={selection.providerId}
    value={permissionMode}
    onChange={setPermissionMode}
    routing={{ kind: "environment", environmentId }}
  />;
  ```

  Use it beside the provider/model picker in settings and compact execution
  forms. Do not pass a plugin-computed option list or reconstruct provider
  capabilities. Tasks presets and Automations are the reference consumers.
  Experimental: see `docs/api_to_audit.md`.

- `experimental_SourceCode` — bb's source viewer. Props:
  `{ content, path, overflow?, highlightedLines?, className? }` — `path`
  drives language detection, `overflow` is `"scroll"` (default) or `"wrap"`,
  and `highlightedLines` is a 1-based inclusive `{ start, end }` (default
  null). bb owns syntax highlighting, gutters, and the live code theme.
- `experimental_Diff` — bb's diff viewer. Props:
  `{ patch, path, view?, overflow?, showLineNumbers?, experimental_fullFileContents?,
className? }` —
  `patch` is a unified patch for exactly ONE file and `view` is `"unified"`
  (default) or `"split"`. bb normalizes the patch, so a GitHub REST patch or
  a bare `@@` hunk works without synthesizing a `diff --git` header
  yourself; unparseable content degrades to plain monospace text.
  `experimental_fullFileContents` is
  `{ old: { path, content }, new: { path, content } }`; when supplied and
  consistent with the patch, bb enables expand-context controls between
  hunks. The caller owns loading those complete UTF-8 sides and omits the prop
  while it has only the patch. Reference: `plugins/github/app.tsx`.

  Alias both on import — JSX reads a lowercase-initial name as an intrinsic
  element:

  ```tsx
  import { experimental_Diff as Diff } from "@get-bb/plugin-sdk/app";

  <Diff patch={file.patch} path={file.path} />;
  ```

  Highlighting uses the host's shared worker pool from React context. Thread
  panels and plugin nav panels have one; homepage and settings sections do
  not, so code there renders unhighlighted rather than broken.
  Experimental: see `docs/api_to_audit.md`.

- `Markdown` — bb's chat-message markdown renderer (same typography,
  spacing, and code styling as timeline messages). Props:
  `{ content, className? }`. Use it wherever plugin UI quotes or previews
  message content (e.g. a reply header) so it reads like the rest of the
  chat instead of a differently-styled bundled renderer. Renderer options
  beyond content/className stay host-internal.
- `experimental_UrlLink` — a real anchor whose ordinary HTTP(S) activation
  follows the current client's in-app/external-browser preference. It keeps
  internal BB routes in SPA history, preserves modifier clicks, copying,
  accessibility, and explicit anchor props, and leaves unsupported schemes and
  explicit targets to browser behavior. A `_blank` or named target preserves
  supplied `rel` tokens but adds `noopener noreferrer` unless `rel` explicitly
  contains `opener`. Use `useBbNavigate().experimental_openUrl(url)` for
  buttons, menus, and effects; its boolean reports whether the current app
  accepted the intent, not whether a later OS launch completed.
- `experimental_FileLink` — a real anchor for an explicit live file target:
  `{ kind: "workspace", environmentId, path }`,
  `{ kind: "host", hostId, path }` (absolute), or
  `{ kind: "thread-storage", threadId, path }`. Ordinary activation opens the
  current surface's shared BB preview. Its lazy context menu offers the
  built-in preview, matching plugin `fileOpener`s, the preferred external
  target, available client apps, and copy actions. Valid targets expose an
  encoded, scheme-safe href; traversal paths, ill-formed Unicode, and other
  malformed runtime targets are inert in both the app and SDK test harness.
  Optional `location` is a one-based line/column or line range. For buttons and
  effects use
  `useBbNavigate().experimental_openFilePreview({ target, location })` or
  `.experimental_openFileExternally({ target, location })`; the boolean means
  host acceptance, not completed I/O. Every identity is explicit—never invent
  an environment id or turn a project id into a workspace target. The testing
  harness records both calls in `navigateCalls` and gates them with the
  `openFilePreview` / `openFileExternally` behavior options.
- `experimental_useAppPanel` — returns the generic current-surface fixed-tab
  controller. `openFixedTab({ surface: { kind: "current" }, tab, target? })`
  accepts a plugin's own eligible fixed-tab registration, validates any target
  through that registration's `experimental_target` contract, opens the shared
  panel, and returns host acceptance. The controller does not interpret target
  shapes. Targeted fixed tabs use `experimental_useFixedTabTarget(tab)` to read
  current-session state and call `clear()` when returning to an untargeted
  state. The frontend harness records accepted calls in
  `experimental_fixedTabOpenCalls`, gates them with
  `experimental_openFixedTab`, and seeds state with
  `experimental_fixedTabTarget`.
- `experimental_NewThreadComposer` — bb's complete compose surface for
  CREATING a thread (the create-side counterpart to `ThreadChat`): prompt
  editor with @-mentions and expand, `+` attachments,
  provider/model/reasoning picker, voice, submit, and the row beneath with
  project, environment, "Branch from:", and permission mode. Never
  hand-roll a textarea + "Start thread" button. Props:
  `{ onSubmit, defaultProjectId?, defaultProviderId?, defaultModel?,
defaultReasoningLevel?, defaultServiceTier?, defaultPermissionMode?,
defaultEnvironment?, initialPrompt?, placeholder?, layout?, focusRequest?,
className?, draftKey? }` — the `default*` props are SEEDS, not controlled
  values: the user can change every one, and each takes precedence over the
  project's remembered defaults when provided. They are value-compared each
  render; changing any of them after mount re-seeds every selection
  (including ones the user touched), so switching between two saved records
  in one mounted composer reloads that record's values. `initialPrompt`
  seeds the draft only while it is still empty; `layout` is `"contained"`
  (default) or `"document"` like `ThreadChat`; `focusRequest` is a
  change-detected nonce that focuses the editor; `draftKey` picks where the
  draft persists (default: a key scoped to your plugin).

  Store-then-restore: because `onSubmit`'s `NewThreadRequest` fields map
  1:1 onto the `default*` props, a plugin that saves a request (e.g. an
  editable rule or template) can re-open it later with
  `defaultProviderId={saved.providerId}` / `defaultModel={saved.model}` /
  `defaultReasoningLevel={saved.reasoningLevel}` /
  `defaultServiceTier={saved.serviceTier}` /
  `defaultPermissionMode={saved.permissionMode}` /
  `defaultEnvironment={saved.environment}` (plus `defaultProjectId` and
  `initialPrompt`), and an untouched resubmit reproduces an equivalent
  request — the composer never silently resets a saved configuration to
  project defaults. Limits (documented on `defaultEnvironment`): a
  `project-default` environment seeds nothing, and a seeded host/worktree
  that no longer exists falls back to the composer's default environment.

  Projectless threads: the project picker always offers "Don't work in a
  project". That choice submits BB's personal-project id in `projectId` (not
  `null`) and a host environment with `workspace: { type: "personal" }`.
  Forward both fields unchanged to `threads.spawn`. If you need metadata for
  the selected project, call `bb.sdk.projects.list({ includePersonal: true })`
  because the ordinary list omits the personal project.

  The composer resolves selections; YOUR PLUGIN creates the thread. On
  submit it calls `onSubmit(request)` with a JSON-serializable
  `NewThreadRequest`
  `{ projectId, providerId, model, reasoningLevel, permissionMode,
serviceTier?, executionInputSources, environment, input }`. Forward it
  verbatim to your backend rpc and hand it to `bb.sdk.threads.spawn`,
  adding `sectionId` / `parentThreadId` / `title` / `visibility` yourself —
  `spawn` fills in `origin: "plugin"` and `originPluginId`, so threads
  created this way stay attributed to your plugin. The draft clears when
  `onSubmit` resolves and is KEPT if it throws, so a failed create never
  loses what the user typed.

  Alias it on import — JSX reads a lowercase-initial name as an intrinsic
  element, so `<experimental_NewThreadComposer />` does not compile:

  ```tsx
  // app.tsx
  import { experimental_NewThreadComposer as NewThreadComposer } from "@get-bb/plugin-sdk/app";

  <NewThreadComposer
    defaultProjectId={projectId}
    onSubmit={async (request) => {
      await rpc.call("createThread", { request, sectionId });
    }}
  />;
  ```

  ```ts
  // server.ts
  async createThread({ request, sectionId }) {
    const thread = await bb.sdk.threads.spawn({
      ...request,
      ...(sectionId ? { sectionId } : {}),
    });
    return { threadId: thread.id };
  }
  ```

  Experimental: the `experimental_` prefix will drop once the entry in
  `docs/api_to_audit.md` is audited. Give it real width — the control row
  does not fit in a ~420px column.

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
- `useBbNavigate()` → `{ toThread(id), toProject(id), toPluginPanel(path,
{ subPath?, replace? }?), toCompose({ initialPrompt?, focusPrompt? }?),
openThreadPanel({ actionId, title?, params? }), experimental_openUrl(url) }`.
  `toCompose` opens the root compose screen; pass `initialPrompt` to seed the
  composer draft and `focusPrompt: true` to focus it. The panel
  opener opens one of the current plugin's registered `threadPanelAction` tabs
  in the current thread surface and returns whether the host accepted it; it
  returns false on surfaces without a thread side panel.
  `experimental_openUrl` owns HTTP(S) only and returns false for schemes BB
  leaves to normal anchor behavior.
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
  `setTextEffect({ className })` paints the whole editable draft with a class
  from the plugin stylesheet (`null` clears it); `setInputLock(locked)` makes
  the editor read-only and busy and auto-releases when the customization
  unmounts or changes scope;
  `insertMention({ provider, id, label })` inserts an @-mention pill bound
  to one of YOUR `bb.ui.registerMentionProvider` providers, resolved to
  fresh context at send time; `focus()` focuses the caret; `scope` reports
  where writes land (`{ kind: "thread", threadId }` inside a thread
  context, `{ kind: "new-thread", projectId }` from nav panels and
  homepage sections — those seed the composer the user lands on next).
- `useComposerView()` → reactive `{ scope, layout, draft, run }` for the
  composer instance that mounted an action or banner. `layout` is
  `"expanded" | "compact" | "zen"`; `draft` is
  `{ text, isEmpty, attachmentCount }`; `run` is
  `{ isRunning, isSubmitting }`.

```tsx
const composer = useComposer();
composer.updateText((current) => `${current}\n\nPlease summarize this.`);
```

Composer customizations:

- Register with `app.composer.customize({ id, scopes?, actions?, plusMenu?,
banners?, richText? })`. Omitted `scopes` means all thread, queued-message,
  side-chat, and new-thread composers.
- `actions` and `banners` are plugin React components. Calls to
  `useComposer()` and `useComposerView()` inside them are bound to the composer
  that mounted the component. Actions render before native voice/submit and
  are unavailable in compact layout; banners render above the composer.
- `plusMenu` rows are host-rendered so keyboard navigation, focus restoration,
  and mobile layout remain correct. Each `ComposerPlusMenuItem` supplies
  `id`, `label`, optional `icon`, `description`, and `disabled`, plus
  `run({ composer, view })`.
- `richText.effects` rules return plain-text `{ from, to }` ranges and a class
  name from plugin CSS. Decorations are paint-only and never mutate the draft.
  `richText.onDraftChange(draft, view)` observes the debounced
  `ComposerStructuredDraft`, including mention ranges.
- Use a vendored BB prompt icon-button recipe for native-matching action chrome
  and provide an accessible label. Each component/callback is isolated so one
  failing customization does not degrade the native composer. Complete
  reference: `examples/plugins/composer-customization`.

UI components — **vendored shadcn source you own** (the shadcn model; the
old host-provided component kit is REMOVED — `@get-bb/plugin-sdk/app` exports
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
- Also never bundled, for size rather than singleton reasons: `clsx`,
  `tailwind-merge`, and `class-variance-authority`. Your app bundle uses the
  host's installed copies (tailwind-merge ^3, clsx ^2, cva ^0.7), so keep
  your declared ranges inside those majors. `zod` is NOT shimmed (exposing
  its namespace would bloat the host's boot payload) — it bundles from your
  `node_modules` in both `app.tsx` and `server.ts`, so keep it in
  `dependencies`.
- Source and diffs: use the host components
  `experimental_SourceCode` / `experimental_Diff` (see "Host components"),
  NOT a direct
  `@pierre/diffs` import. The shim stays for compatibility, but hand-rolled
  Pierre usage means owning patch normalization and the code theme yourself,
  and it opts you out of any installed renderer replacement.
- Everything else bundles from YOUR `node_modules` (hugeicons, lucide,
  non-portal radix, zod, form/calendar/chart libs): run `npm install`
  after adding components (`bb plugin new` runs the first one; `shadcn add`
  installs each item's declared deps). Consumers never need npm — ship your
  built `dist/`.
- Styling: Tailwind classes compile against the host theme's live CSS
  variables (`bg-background`, `text-muted-foreground`, `rounded-lg`, and
  `animate-in`/`fade-in-0` via tw-animate-css) — derive colors from theme
  tokens, never hardcoded grays.
- The old bb extras (`EmptyState`, `Markdown`, `PageBody`, `Spinner`) are
  gone — write your own (each is a few lines; see
  `plugins/github/components/` for reference implementations).

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

### Unit tests with `@get-bb/plugin-sdk/testing`

`@get-bb/plugin-sdk/testing` is the official vitest harness for workspace and
standalone plugins. The packed package ships runtime JavaScript and portable
declarations for all three testing entrypoints. A current scaffold already declares
`@get-bb/plugin-sdk` as an exact devDependency, so the harness is on disk after
`npm install`; an older plugin that still vendors `types/` must add that
devDependency (or run `bb plugin migrate`) before tests can import the harness.
Either way, install its optional peers too: `better-sqlite3` for backend tests;
React, React DOM, Testing Library, and jsdom for frontend tests.

The fake plugin host's `bb` satisfies `BbPluginApi` with host-faithful
semantics: real better-sqlite3 temporary storage (never mock the db), the kv
256KB cap, schema-RPC validation/error/strict-JSON behavior, additive events,
keyed registration failures, atomic reload, conditional agent configuration,
request input, typed host-call validation/signal delivery, and `threads.spawn`
plugin attribution.

Backend (`server.ts`) — `createFakePluginHost()`:

```ts
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

const { bb, harness } = createFakePluginHost({
  pluginId: "my-plugin",
  settings: { apiToken: "tok" }, // pre-seeded stored values (secrets included)
  sdk: { threads: { spawn: async () => ({ id: "th_1" }) } },
  experimental_callHostRpc: async ({ method, input, target, signal }) => {
    return { ok: true }; // validated against the method's output schema
  },
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
await harness.behavior.experimental_emitHostSignal(
  "changed",
  { reason: "test" },
  { kind: "host", hostId: "host-test" },
);
await harness.behavior.experimental_emitHostWorkerExit("host-test");
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
`harness.realtimeSignals`, `harness.experimental_hostRpcCalls`,
`harness.needsConfigurationMessages`, and
`harness.registrations` (http routes, rpc methods, services, schedules, cli,
agent tools/configure provider, mention providers). Pass
`agentSkillIds` to `createFakePluginHost` to declare the manifest skill names
available to the configure driver.

Host entry (`host.ts`) — `@get-bb/plugin-sdk/testing/host`:

```ts
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import hostEntry from "./host.js";

const harness = experimental_createHostEntryHarness(hostEntry);

const result = await harness.experimental_call("setEnabled", { enabled: true });
await harness.experimental_dispose();
```

This harness applies the real contract schemas, request/lifecycle
cancellation, JSON round-tripping, and the host result-size limit. Use injected
child-process adapters for feature tests. Worker startup, crashes, artifact
verification, and reconnect behavior belong in daemon integration tests, not
this in-process harness.

Frontend (`app.tsx`) — `@get-bb/plugin-sdk/testing/app` (vitest + jsdom):

```tsx
// @vitest-environment jsdom
import {
  loadPluginApp,
  mountPluginContentScripts,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";

// The thunk matters: app.tsx binds the plugin runtime at module load, so
// loadPluginApp installs the test runtime BEFORE importing it. (For static
// imports, call installTestPluginRuntime() in a vitest setup file instead.)
const app = await loadPluginApp(() => import("./app"));
const contentScripts = await mountPluginContentScripts(app, {
  pluginId: "my-plugin",
  generation: 1,
});

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
    openUrl: (url) => url.startsWith("https://"),
  },
);
await slot.findByText("…"); // Testing Library queries
await slot.behavior.setRealtimeConnectionState("connected");
await slot.behavior.setComposerScope(
  { kind: "queued-message", threadId: "t1", queuedMessageId: "q1" },
  "queued draft",
);
slot.inspection.rpcCalls;
slot.inspection.navigateCalls;
slot.inspection.composer; // text, visuals, quotes, mentions, and focus activity
slot.lifecycle.unmount();
await contentScripts.lifecycle.dispose();
```

`loadPluginApp` validates registrations with the host's own rules (slot id
patterns, settingsSection optional title, navPanel path,
fileOpener extensions, and content-script ids/mount functions) and returns
them typed with defaults filled. `mountPluginContentScripts` mirrors ordered
mount, abort-before-cleanup, reverse rollback, exact-once disposal, and
per-window instances. Working examples:
`examples/plugins/slack-bot/server.test.ts` (webhook → kv → recorded spawn →
`thread.idle` reply), `plugins/docs/app.test.tsx` (nav
panel list over rpc + create/open navigation assertions).

Fidelity boundaries: HTTP auth is recorded but not enforced; services and
schedules run only when driven (no restart timers or cron sweep); storage is
process-local and secrets stay in memory; `bb.sdk` is always bound and
unstubbed calls throw; cross-plugin collisions are outside one fake host. The
frontend harness validates registrations and JSON/composer behavior but does
not reproduce BB layout/CSS, persistence, routing, crash boundaries, or
multi-plugin arbitration. Use a live loop for those host boundaries.

### Live loop against a running bb

- `bb plugin dev` is the loop: save → rebuild declared `bb.app` and `bb.host`
  artifacts → reload; open app pages pick new UI up live and
  host workers move to the new generation on their next call. Build/reload
  failures print and keep watching. The dev loop writes readable (unminified)
  `dist/app.js` + `app.css`; `bb plugin build` and installs minify them.
- `bb plugin list` shows status, services, schedules (with last_error),
  handler stats, and the CLI command; `bb plugin logs <id> -f` follows
  `bb.log` output. Add `--json` to any plugin command for machine output.
- Exercise wire surfaces directly: `curl -X POST -H "content-type:
application/json" -d '{}' <server>/api/v1/plugins/<id>/rpc/<method>`,
  `bb <command> …` for the CLI, `bb plugin run <id> …` as the explicit form.
- Keep pure logic in plain functions/modules so it is unit-testable without
  a bb server; the factory file should mostly wire registrations.

BB Official plugins in `plugins/` (a bb checkout):

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
  loopback network (Claude's macOS sandbox permits it; Linux and other
  providers may not).
- Mention `search` is 2s-time-boxed; mention `resolve` runs at send time
  and a throw blocks the send.
- Agent tool and instruction changes apply on the next session start, not
  mid-session; cross-plugin tool-name collisions drop the later registration.
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
- The declarations you read are pinned to one SDK version, not a live view:
  new plugins get them from the exact `@get-bb/plugin-sdk` devDependency, older
  ones from a vendored `types/*.d.ts` copy. Run `bb plugin types` before
  trusting either — it repins the devDependency or rewrites `types/` as
  appropriate — and never fall back to a minified `dist/` bundle — see
  "Looking up the exact API". `bb plugin migrate` moves an older plugin off the
  vendored copy, but only when the user asks for it.
