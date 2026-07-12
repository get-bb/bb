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
can remain available even when the experiment is off; `connect` additionally
requires the "bb connect" experiment. Plugin state lives under
`<bb-data-dir>/plugins/<id>/` (per-plugin SQLite file, secrets, logs).

The builtin Custom instructions plugin adds a multiline editor under Settings
→ Custom instructions. Saved text is persisted on this bb host and included in
agent task instructions; blank text contributes nothing.

The builtin Memory plugin is disabled by default. Enable it with
`bb plugin enable memory`. Once enabled, it injects a compact global and
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

The builtin Secrets plugin provides a secure credential form and guarded
dotenv reconciliation:

  bb secret request <NAME...> --write-env <path>
                    [--purpose <text>] [--describe <NAME> <text>]...

The command blocks until the user submits or cancels the form. Secret values
never appear in command arguments, model-visible output, or persisted
interaction data; success prints only the path, variable names, and
added/updated/unchanged counts.

  bb plugin marketplace add <source> [--name <n>] [--yes]
  bb plugin marketplace list [--json]
  bb plugin marketplace update [name]
  bb plugin marketplace remove <name> [--keep-all|--uninstall-all]
                                 Add, inspect, refresh, or remove catalogs
  bb plugin search <query>       Search all configured marketplaces
  bb plugin install <entry>[@<marketplace>] [--version <range>]
                                 Install a unique marketplace entry (qualify
                                 with @marketplace when ambiguous; --version
                                 is marketplace-only), a local path, builtin:<name>,
                                 git:<url>@<ref>, or
                                 npm:<package>[@<version|tag|range>]
                                 (npm: needs npm on PATH; installs prompt —
                                 pass --yes to skip). Managed git:/npm:
                                 installs refuse engines.bb / engines.bbPluginSdk
                                 mismatches, manifest/artifact identity
                                 mismatches, and ids reserved by builtins
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
                                 every plugin with an update. [--dry-run]
                                 previews without changing plugins; [--latest]
                                 widens a pinned/range npm source to the
                                 newest compatible after confirmation (refused
                                 for pinned git refs — install a branch to
                                 track). Same full-trust confirmation as
                                 install (--yes skips; non-TTY refuses without
                                 --yes). Only tracking sources move; pinned
                                 installs stay put unless --latest applies
  bb plugin list                 Status, services, schedules, handler timings
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

Plugin marketplaces

A marketplace is a catalog (`marketplace.json`) that lists plugins others can
discover and install. Adding a marketplace registers and refreshes that catalog
only — it installs nothing. Catalog sources: a local directory (`path:` or a
filesystem path), `owner/repo[@ref]` (GitHub shorthand), or a git URL with an
optional `@ref`. Server routes live under `/api/v1/marketplaces`.

Trust model: every remote/git source requires an interactive trust confirmation
before add (catalogs can introduce full-trust plugin code later). Pass `--yes`
to skip; non-TTY refuses without `--yes`. Unmistakable local path forms
(`path:`, `./…`, or absolute paths) skip the prompt; ambiguous bare sources
are conservatively prompted. Trusting a marketplace does not install plugins —
install still prompts separately as full-trust server code.

Refresh vs plugin update: `bb plugin marketplace update [name]` re-fetches
catalog metadata (one marketplace, or all when name is omitted). It does not
upgrade installed plugins. Failed refresh keeps the last-known-good cached
catalog and records the error (list shows "refresh failed" state).
`bb plugin outdated` / `bb plugin update` move installed plugin artifacts for
tracking sources.

Removal dispositions: when plugins were installed from a marketplace, remove
asks keep-as-direct vs uninstall for each (`k` / `u` on a TTY). `--keep-all`
converts them to direct installs; `--uninstall-all` removes them. Non-interactive
remove without one of those flags fails when plugins are affected.

Search and install disambiguation: `bb plugin search <query>` matches id,
display name, description, and category across configured marketplaces (status:
installed / compatible / requires newer bb). Install a bare marketplace entry
name only when it is unique across catalogs; qualify as
`<entry>@<marketplace>` when ambiguous. `--version <range>` applies only to
marketplace installs (npm entries). Escape hatches that skip marketplace
resolution: `path:`, `npm:`, `git:`, `builtin:` prefixes (and path-like syntax).

Frontend builds are automatic once installed: path and git installs compile
dist/ at install time (a build failure fails the install), and the server
rebuilds them at load after a bb upgrade. npm packages must publish a
prebuilt dist/ (app.js + app.meta.json) or the install is refused.

The backend half is prebuilt too: when a builtin/git/npm install ships a
dist/server.js built for the running SDK major, the server loads it instead
of the TypeScript source — consumers never need npm or node_modules. Path
installs always load server.ts from source, so `bb plugin dev`/reload see
edits immediately.

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
arrives as the component's subPath prop for panel-internal deep links),
threadPanelAction
(an entry in the thread right panel's new-tab Actions list whose run() can
open closable panel tabs with JSON params), composerAccessory (prompt box
footer), pendingInteraction (temporarily replace a thread composer with a
plugin form), fileOpener (register as a per-extension file viewer/editor;
users pick defaults under Settings → File openers and can right-click a
file link for a one-off choice), and messageDirective (replace a leaf
`::name{k="v"}` block inside assistant / nested-agent Markdown with a plugin
component; unknown, disabled, incomplete, code-fenced, or crashing
directives fall back to the original source; components receive a nullable
openWorkspaceFile(path) callback for opening a worktree-relative file in the
host workspace viewer). Hooks:
useRpc, useRealtime, useSettings (secrets excluded), useBbContext,
useBbNavigate, and useComposer (quote selections / insert mention pills
into the chat composer draft). Components are vendored shadcn source the plugin owns (the
shadcn model): `bb plugin new --app` pre-vendors a starter set into
components/ui/ and `npx shadcn add @bb/<name>` pulls more from the BB
component registry (the full stock shadcn set, version-matched to the
running BB via the pinned ref in components.json). `import { toast } from
"sonner"` reaches the host toaster; react, the portaling radix families,
sonner, vaul, and @pierre/diffs (the app's syntax-highlighted diff
renderer) are runtime-shimmed (never bundled), everything else
bundles from the plugin's node_modules (`npm install` for authors;
consumers install prebuilt dist). A crashing slot collapses to a
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
watches and reloads on every save. The manifest is package.json: `bb.server`
(backend entry, loaded as TypeScript — no build step), optional `bb.app`
(frontend entry), optional `bb.skills` (skills directories auto-imported
into agent threads; default `skills/`), `engines.bb` (supported bb range),
and optional `engines.bbPluginSdk` (supported plugin SDK range; scaffold
writes `"^1.0.0"` for SDK 1.0.0). The plugin id is the package name minus
`bb-plugin-`.

Plugins can contribute palettes with `bb.themes`: an array of
`{ id, name, description?, css }`, where `css` is a plugin-relative `.css`
file. Loaded plugin palettes appear in Settings → Appearance and `bb theme
list`; their selectable id is `plugin:<plugin-id>:<theme-id>`. Disabling or
removing the owning plugin makes bb fall back to the default palette.

Logos: drop a logo.svg (or logo.png / logo.webp) in the plugin root and bb
shows it wherever the plugin's contributions appear — the sidebar entry,
panel title bar, composer command and mention menus, thread action
buttons, and Settings → Plugins. Optional `bb.logo` in the manifest
relocates the file (svg/png/webp only). An optional dark-theme variant —
logo-dark.svg/png/webp at the root, or `bb.logoDark` — is preferred while
the app is in dark mode. Without a logo bb falls back to each contribution's
named icon; its Settings entry uses the manifest-level `bb.icon` hint. Unknown
icon names use the generic fallback. Reload the plugin to pick up logo or icon
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
bb.storage.sqlite()+migrate (the plugin's own database); bb.sdk (the full
bb SDK — handlers/services only, not the factory; spawned threads are
attributed to the plugin); bb.on (observe thread.created/idle/failed/deleted);
bb.http.route (routes under /api/v1/plugins/<id>/http/* with
local/token/none auth); bb.rpc.register (the frontend data plane);
bb.realtime.publish (ephemeral signals to open app pages);
bb.background.service (long-lived, AbortSignal, restart w/ backoff) and
bb.background.schedule (durable cron rows); bb.cli.register (a top-level
`bb <name>` command agents run through bash); bb.agents.registerTool
(native tools with
zod or JSON-schema parameters); bb.ui.registerThreadAction /
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
The `examples/plugins/` directory of a bb checkout also has
reference plugins: github (full-stack: gh-CLI-backed issue/PR browser on
vendored shadcn components), slack-bot (webhook bot), agent-enrichment
(agent surfaces), and small-ux-pack (host-rendered UI).
