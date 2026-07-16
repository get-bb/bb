---
kind: instruction
title: bb Guide — Plugins
summary: Command reference for installing, configuring, running, and authoring bb plugins and their contributed CLI commands.
intent: Provide complete plugin command documentation plus an authoring walkthrough for agents and humans building bb plugins.
editingNotes: Keep flags accurate against the CLI implementation (apps/cli/src/commands/plugin.ts) and the server plugin service; a CLI test asserts every `bb plugin` subcommand appears in this chapter. The full authoring reference is the bb-plugin-authoring builtin skill.
---
Plugin commands

A bb plugin is a TypeScript package that extends the bb server in-process:
background services, cron schedules, HTTP/RPC endpoints, thread lifecycle
handlers, settings, storage — and `bb` CLI subcommands that agents and humans
run like any other command. Plugins are full-trust code inside the server.

User-installed plugins are an experiment, off by default: enable "Plugins" under
Settings → Experiments first. Builtin plugins (`builtin:<name>`) ship with bb and
can remain available even when the experiment is off. Plugin state lives under
`<bb-data-dir>/plugins/<id>/` (per-plugin SQLite file, secrets, logs).

The builtin Custom instructions plugin adds a multiline editor under Settings
→ Custom instructions. Saved text is persisted on this bb host and included in
agent task instructions; blank text contributes nothing.

The builtin Workflows plugin runs durable provider-independent JavaScript
orchestration. It is disabled on fresh installations; enable `workflows` under
Settings → Plugins or run `bb plugin enable workflows` before using:

  bb workflows validate (--script '<javascript>'|--source '<javascript>'|
                        --file <path>|--name <name>)
  bb workflows run (--script '<javascript>'|--source '<javascript>'|
                   --file <path>|--name <name>)
                   [--args '<json>'] [--resume <run-id>]
  bb workflows status <run-id>
  bb workflows history <run-id> [--cursor <call-index>] [--limit <1-100>]
  bb workflows list [--limit <1-50>]
  bb workflows stop <run-id>

Commands must run from a BB project thread. Workflows has seven plugin
settings, configurable with `bb plugin config workflows set <key> <value>`:
`maxActiveRuns` (default 4, range 1–32), `maxConcurrentAgents` (8, 1–64),
`maxAgentCalls` (100, 1–1000), `workerStallTimeoutMs` (1800000,
60000–86400000), `totalRunTimeoutMs` (86400000, 60000–604800000),
`retentionDays` (30, 1–3650), and `maxNotificationBytes` (16384,
1024–262144). `maxActiveRuns` applies live; the other six are snapshotted for
each new run. Settings changes do not require a plugin reload.

`status` is a bounded polling summary, and `list` returns only compact run
summaries. Detailed run and call records are paged JSONL: redirect `history`
into `$BB_THREAD_STORAGE` before inspecting it, and continue with the final
page record's `nextCursor`. The invoking shell writes
that file on the thread's execution host, so this works the same on local and
remote hosts without granting the plugin arbitrary filesystem access. Use `bb
provider list --environment "$BB_ENVIRONMENT_ID" --json` and then `bb provider
models <provider-id> --environment "$BB_ENVIRONMENT_ID" --json` before writing
an explicit selection; never guess ACP model IDs.

The Memory plugin is an opt-in install, bundled with the app:
`bb plugin install memory`. Once installed, it injects a compact global and
current-project memory index into agent context and progressively discloses
full records through CLI-only commands. Because its store works across
providers, we recommend disabling provider-native memory under Settings →
Providers to avoid duplicate or conflicting stores. Settings → Memory lists
every global and project memory and supports version-checked edits and soft
deletion.

  bb memory catalog [--scope project|global|all] [--json]
  bb memory search <query> [--scope project|global|all] [--json]
  bb memory get <id> [--scope project|global|all] [--json]
  bb memory add --scope project|global --name <name> --summary <text>
                --details <text> --reason <text> [--kind <kind>]
                [--tag <tag>]... [--importance <0-100>] [--pinned] [--json]
  bb memory update <id> --expected-version <n> [fields...] [--json]
  bb memory forget <id> --expected-version <n> --reason <text> [--json]
  bb memory history <id> [--scope project|global|all] [--json]

Project writes use the invoking CLI's current project. Global writes require
the explicit `--scope global` flag.

The Tasks plugin is an opt-in install from the default BB Official marketplace:
`bb plugin install tasks@bb-official`. It adds a task tracker, agent delegation,
and the `bb tasks` command. Common agent operations are:

  bb tasks show <key-or-id> [--json]
  bb tasks list [--project <prefix-or-id>] [filters...] [--json]
  bb tasks comment <key-or-id> (--body <markdown> | --body-file <path>) [--json]
  bb tasks attachment get <attachment-id> --out <path> [--json]
  bb tasks attach <key-or-id> [--json]
  bb tasks update <key-or-id> --status in_review [--json]

Run `bb tasks --help` for project, folder, task, label, attachment, and demo-data
commands, plus preset management, delegation, and attached-thread inspection.
Delegated threads are attached automatically; use `bb tasks attach` only when
work started outside Tasks.

The builtin Secrets plugin provides a secure credential form and guarded
dotenv reconciliation:

  bb secret request <NAME...> --write-env <path>
                    [--purpose <text>] [--describe <NAME> <text>]...

The command blocks until the user submits or cancels the form. Secret values
never appear in command arguments, model-visible output, or persisted
interaction data; success prints only the path, variable names, and
added/updated/unchanged counts.

  bb plugin search <query>       Search BB's official plugins (bundled with
                                 the app)
  bb plugin install <entry>      Install a bundled official plugin by name
                                 (github, docs, memory, tasks), a local
                                 path, builtin:<name>,
                                 git:<url>@<ref>, or
                                 npm:<package>[@<version|tag|range>]
                                 (npm: needs npm on PATH; installs prompt —
                                 pass --yes to skip). Managed git:/npm:
                                 installs refuse engines.bb / engines.bbPluginSdk
                                 mismatches, manifest/artifact identity
                                 mismatches, and ids reserved by bundled plugins
                                 Omitted npm specs, ranges, dist-tags, and git
                                 branches track; exact npm versions, git tags,
                                 and git commits are pinned
  bb plugin outdated             Check installed plugins for compatible
                                 updates (table; --json for raw results).
                                 Columns: installed, latest compatible,
                                 blocked newer (incompatible releases not
                                 selected), status. Dev builds (bb 0.0.0)
                                 annotate that engines.bb is not enforced
  bb plugin update <id> | --all  Apply compatible updates for one plugin or
                                 every tracking plugin with an update. Same
                                 full-trust confirmation as
                                 install (--yes skips; non-TTY refuses without
                                 --yes). Use outdated to preview; pinned
                                 installs stay put
  bb plugin list                 Status, services, schedules, handler timings
  bb plugin source <id> [--json] Show requested/resolved source, engine ranges,
                                 install time, and recent activation history
  bb plugin enable|disable <id>  Load or unload an installed plugin
  bb plugin reload [id]          Re-run factories against current sources
  bb plugin config <id> [set <key> <value> | unset <key>]
                                 Show or change a plugin's declared settings
  bb plugin logs <id> [-n N] [-f]  Print (or follow) a plugin's bb.log output
  bb plugin run <id> [args...]   Run the plugin's CLI command explicitly
  bb plugin token <id> [--rotate]  Print the token for auth:"token" HTTP
                                 routes; --rotate generates a new token,
                                 invalidating the old one
  bb plugin remove <id>          Uninstall (managed git:/npm: files deleted;
                                 builtin removals are remembered)
  bb plugin new <name> [--app]   Scaffold a new plugin (no server required;
                                 --app adds a frontend entry, app.tsx, plus a
                                 typecheck-only tsconfig.json)
  bb plugin build [path]         Compile the plugin into dist/ — the backend
                                 bundle (server.js, server.meta.json) and,
                                 when bb.app is declared, the frontend bundle
                                 (app.js, app.css, app.meta.json). Each
                                 *.meta.json is stamped with SDK major/version,
                                 artifactFormatVersion, pluginId, pluginVersion,
                                 and builtWith (bb + plugin SDK versions); no
                                 server required
  bb plugin dev [path]           Watch a plugin's sources (default: cwd) and
                                 on every change rebuild its frontend bundle
                                 (if it declares bb.app) and reload the
                                 plugin; Ctrl+C to stop

BB Official plugins

BB's official plugins — GitHub, Docs, Memory, and Tasks — ship bundled inside
the app itself. They appear in Settings → Plugins → Browse and install with
one click from the local bundled copy: no network, no download, no separate
release. Install from the CLI by bare name (`bb plugin install github`,
`bb plugin install docs`, `bb plugin install memory`, or
`bb plugin install tasks`). Installed official plugins are pinned to the
bundled copy and update automatically when the BB app updates.

For direct git:/npm: installs, updates are manual: `bb plugin outdated`
checks tracking sources and `bb plugin update` applies compatible candidates.
Reinstalling an already-installed managed plugin is refused — use
`bb plugin update`. A failed activation restores the pre-update snapshot and
leaves the latest failure visible as needing attention. Exact npm versions,
git tags and commits, path sources, and bundled official plugins are pinned;
npm ranges/omitted specs/dist-tags and git branches track compatible updates.

`bb plugin search <query>` matches id, display name, description, and
category across the bundled official plugins (status: installed / compatible
/ requires newer bb). Install an official plugin by its bare name. Direct
`path:`, `npm:`, `git:`, and `builtin:` sources—and path-like
syntax—continue to bypass official-plugin resolution.

Frontend builds are automatic once installed: path installs and git installs
without a prebuilt app compile dist/ at install time (a build failure fails the
install), provided their imported dependencies are already available. Git and
npm plugins may also ship a metadata-validated prebuilt app; npm packages must
do so or the install is refused. The server rebuilds source-built apps after a
bb upgrade.

The backend half is prebuilt too: when a builtin/official/git/npm install
ships a dist/server.js built for the running SDK major, the server loads it
instead of the TypeScript source. Path installs always load server.ts from
source, so `bb plugin dev`/reload see edits immediately.

`bb plugin dev` is the edit loop: it requires the directory to already be
installed as a plugin (`bb plugin install .` first), ignores dist/,
node_modules/, and .git/, batches saves, and prints one line per cycle. A
build or reload failure prints the error and keeps watching (a failed build
skips that cycle's reload). Reloads reach open app pages live — changed
frontend bundles re-import and their UI slots remount without a page
refresh.

Frontend entries (app.tsx) default-export `definePluginApp` from
`@bb/plugin-sdk/app` and register UI slots: homepageSection (root compose),
settingsSection (per-plugin settings page below the host-rendered settings
form; no props in V1, optional host-rendered title; builtin slot entries work
with the Plugins experiment off while the Settings → Plugins management
bucket stays experiment-gated),
navPanel (own sidebar entry + /plugins/<id>/<path>/* route; the remainder
arrives as the component's subPath prop for panel-internal deep links; the
host always renders the shared plugin title bar and the component owns a
zero-padding full-bleed body, including its scrolling),
threadPanelAction
(an entry in the thread right panel's new-tab Actions list whose run() can
open closable panel tabs with recursive `JsonValue` params; restored
components read `JsonValue | null`), composerAccessory (prompt box
footer), pendingInteraction (temporarily replace a thread composer with a
plugin form), fileOpener (register as a per-extension file viewer/editor;
users pick defaults under Settings → File openers and can right-click a
file link for a one-off choice), and messageDirective (replace a leaf
`::name{k="v"}` block inside assistant / nested-agent Markdown with a plugin
component; unknown, disabled, incomplete, code-fenced, or crashing
directives fall back to the original source; components receive a nullable
openWorkspaceFile(path) callback for opening a worktree-relative file in the
host workspace viewer and a nullable
openThreadPanel({ actionId, title?, params? }) callback for opening one of the
same plugin's thread-panel actions). Hooks:
useRpc, useRealtime, useSettings (secrets excluded), useBbContext,
useBbNavigate, and useComposer (read/replace/update/clear scoped composer
text, quote selections, insert mention pills, and focus the composer;
plain-text edits preserve attachments and reconcile only inline mentions
overlapped by the edit). Define RPC methods with `defineRpcContract`
and Standard Schema-compatible input/output validators (Zod works directly),
register via `bb.rpc.register(contract, handlers)`, then use a type-only
backend contract import with `useRpc<typeof contract>()` for exact frontend
method/input/result inference. The server validates both schemas and rejects
non-JSON results (including cyclic and non-finite values) with structured
error codes. Components are vendored shadcn source the plugin owns (the
shadcn model): `bb plugin new --app` pre-vendors a starter set into
components/ui/ and `npx shadcn add @bb/<name>` pulls more from the BB
component registry (the full stock shadcn set, version-matched to the
running BB via the pinned ref in components.json). `import { toast } from
"sonner"` reaches the host toaster; react, the portaling radix families,
sonner, vaul, and @pierre/diffs (the app's syntax-highlighted diff
renderer) are runtime-shimmed (never bundled), everything else
bundles from the plugin's node_modules (`npm install` for authors; BB installs
release packages with their declared production dependencies). A crashing slot collapses to a
"plugin <id> crashed" chip without
touching the rest of the app. Installed plugins and their declared settings
(same data as `bb plugin config`) also appear under Settings → Plugins.

Plugin CLI commands: a plugin can register one top-level subcommand (for
example `bb github …`). Unknown `bb` commands are looked up against installed
plugins and proxied to the server, so plugin commands work exactly like core
commands; core command names always win. Inside agent threads the generated
`plugin-commands` skill lists the available plugin commands.

Settings changes do not auto-reload a plugin — run `bb plugin reload <id>`
after configuring. Add --json to plugin commands for machine-readable output.

Authoring a plugin

The loop: `bb plugin new <name>` scaffolds `./bb-plugin-<name>` (add --app
for a frontend entry); `bb plugin install .` registers it; `bb plugin dev`
watches and reloads on every save. The manifest is package.json: required
`bb.name` and `bb.description` human identity, required `bb.branding` with at
least `icon` or `logo.light`, `bb.server`
(backend entry, loaded as TypeScript — no build step), optional `bb.app`
(frontend entry), optional `bb.skills` (static skill directories auto-imported
into agent threads unless filtered by `bb.agents.configure`; default
`skills/`), `engines.bb` (supported bb range),
and optional `engines.bbPluginSdk` (supported plugin SDK range; scaffold
writes `"^0.3.0"` for SDK 0.3.0). The plugin id is the package name minus
`bb-plugin-`.

Plugins can contribute palettes with `bb.themes`: an array of
`{ id, name, description?, css }`, where `css` is a plugin-relative `.css`
file. Loaded plugin palettes appear in Settings → Appearance and `bb theme
list`; their selectable id is `plugin:<plugin-id>:<theme-id>`. Disabling or
removing the owning plugin makes bb fall back to the default palette.

Branding is explicit: `bb.branding.logo.light` points to the plugin's rich
identity artwork and optional `bb.branding.logo.dark` is preferred in dark
mode. Paths must be plugin-relative `.svg`, `.png`, or `.webp` files. Root logo
files are not auto-detected, and a dark logo requires a light logo.
`bb.branding.icon` is the compact host icon-name identity. Compact chrome uses
it first, then a contribution's distinct local icon hint, then Zap. Roomy
Settings rows and cards use the image logo where available. At least the icon
or light logo is required. BB rejects nulls, empty strings, missing/escaping
assets, and unsupported extensions. Reload the plugin to pick up branding
changes.

The backend entry default-exports a factory receiving the full plugin API:

  import type { BbPluginApi } from "@bb/plugin-sdk";
  export default async function plugin(bb: BbPluginApi) { ... }

The import is type-only and erased at load; the scaffold ships the full API
as bundled .d.ts in types/ (tsconfig maps @bb/plugin-sdk to them), so
`npm install && npx tsc --noEmit` typechecks anywhere — no bb checkout
needed. Confused, or need a symbol the types don't explain? Clone the repo:
https://github.com/ymichael/bb. The API in
one line each — bb.log (plugin-scoped logger behind `bb plugin logs`);
bb.settings.define (declarative settings incl. secrets, editable via
`bb plugin config`); bb.storage.kv (JSON rows ≤256KB) and
bb.storage.database()+migrate (the plugin's own database); bb.sdk (the full
bb SDK — handlers/services only, not the factory; spawned threads are
attributed to the plugin); bb.events.on (observe thread.created/idle/failed/deleted);
bb.http.route (routes under /api/v1/plugins/<id>/http/* with
local/token/none auth); defineRpcContract + bb.rpc.register (Standard
Schema-validated frontend data plane with inferred backend handlers and
type-only frontend method/input/result inference);
bb.realtime.publish (ephemeral signals to open app pages);
bb.background.service (long-lived, AbortSignal, restart w/ backoff) and
bb.background.schedule (durable cron rows); bb.cli.register (a top-level
`bb <name>` command agents run through bash); bb.agents.registerTool
(static native tools with zod or JSON-schema parameters) and
bb.agents.configure (one synchronous per-resolution callback selecting this
plugin's own tool/skill ids and optional dynamic instructions; tools apply on
the next provider session start/resume, while busy skill runtimes defer catalog
changes); bb.ui.registerThreadAction /
registerMentionProvider (host-rendered UI — no
frontend bundle needed); bb.status.needsConfiguration (report
"unconfigured" instead of crashing); bb.onDispose (LIFO cleanup on
reload/disable/shutdown).

Frontend entries register React slots (homepageSection, settingsSection,
navPanel, threadPanelAction, composerAccessory, fileOpener,
messageDirective) via
definePluginApp, use the hooks
listed above, and render vendored components; styling is Tailwind against
the host theme's tokens only (semantic classes like bg-background and
tw-animate-css utilities compile in plugin builds).

For the complete authoring reference — exact signatures, working snippets
for every surface, the reload lifecycle, testing tips, and gotchas — use
the built-in `bb-plugin-authoring` skill (agents: it loads on demand;
humans: apps/server/src/services/skills/builtin-skills/bb-plugin-authoring/
in a checkout). The builtin `inline-vis` plugin renders
`::inline-vis{file="demo.html" height="480"}` through the sidebar's
path-shaped, sandboxed worktree HTML iframe preview; `height` is optional.
Its card header includes an open-in-sidebar action for the source HTML file.
The `official-plugins/` directory contains the BB Official GitHub, Docs,
Memory, and Tasks plugins. The remaining `examples/plugins/` reference plugins cover slack-bot
(webhook bot), agent-enrichment (agent surfaces), and small-ux-pack
(host-rendered UI).
