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

Plugins are an experiment, off by default: enable "Plugins" under Settings →
Experiments first. Until then `bb plugin` commands report that plugins are
disabled. Plugin state lives under `<bb-data-dir>/plugins/<id>/` (per-plugin
SQLite file, secrets, logs).

  bb plugin install <src>        Install from a local path, git:<url>@<ref>,
                                 or npm:<name>@<version> (npm: needs npm on
                                 PATH; installs prompt — pass --yes to skip)
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
  bb plugin remove <id>          Uninstall (managed git:/npm: files deleted)
  bb plugin new <name> [--app]   Scaffold a new plugin (no server required;
                                 --app adds a frontend entry, app.tsx, plus a
                                 typecheck-only tsconfig.json)
  bb plugin build [path]         Compile the plugin into dist/ — the backend
                                 bundle (server.js, server.meta.json) and,
                                 when bb.app is declared, the frontend bundle
                                 (app.js, app.css, app.meta.json); no server
                                 required
  bb plugin dev [path]           Watch a plugin's sources (default: cwd) and
                                 on every change rebuild its frontend bundle
                                 (if it declares bb.app) and reload the
                                 plugin; Ctrl+C to stop

Frontend builds are automatic once installed: path and git installs compile
dist/ at install time (a build failure fails the install), and the server
rebuilds them at load after a bb upgrade. npm packages must publish a
prebuilt dist/ (app.js + app.meta.json) or the install is refused.

The backend half is prebuilt too: when a git/npm install ships a
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
navPanel (own sidebar entry + /plugins/<id>/<path> route), threadPanelTab
(right panel next to Info/Diff), composerAccessory (prompt box footer). Hooks:
useRpc, useRealtime, useSettings (secrets excluded), useBbContext,
useBbNavigate. Components are vendored shadcn source the plugin owns (the
shadcn model): `bb plugin new --app` pre-vendors a starter set into
components/ui/ and `npx shadcn add @bb/<name>` pulls more from the BB
component registry (the full stock shadcn set, version-matched to the
running BB via the pinned ref in components.json). `import { toast } from
"sonner"` reaches the host toaster; react, the portaling radix families,
sonner, and vaul are runtime-shimmed (never bundled), everything else
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
into agent threads; default `skills/`), and `engines.bb` (supported bb
range). The plugin id is the package name minus `bb-plugin-`.

Logos: drop a logo.svg (or logo.png / logo.webp) in the plugin root and bb
shows it wherever the plugin's contributions appear — the sidebar entry,
panel title bar, composer command and @-mention menus, thread action
buttons, and Settings → Plugins. Optional `bb.logo` in the manifest
relocates the file (svg/png/webp only). An optional dark-theme variant —
logo-dark.svg/png/webp at the root, or `bb.logoDark` — is preferred while
the app is in dark mode. Without a logo bb falls back to the contribution's
named icon. Reload the plugin to pick up logo changes.

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
attributed to the plugin); bb.on (observe thread.created/idle/failed);
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

Frontend entries register React slots (homepageSection, navPanel,
threadPanelTab, composerAccessory) via definePluginApp, use the hooks
listed above, and render vendored components; styling is Tailwind against
the host theme's tokens only (semantic classes like bg-background and
tw-animate-css utilities compile in plugin builds).

For the complete authoring reference — exact signatures, working snippets
for every surface, the reload lifecycle, testing tips, and gotchas — use
the built-in `bb-plugin-authoring` skill (agents: it loads on demand;
humans: apps/server/src/services/skills/builtin-skills/bb-plugin-authoring/
in a checkout). The `examples/plugins/` directory of a bb checkout has four
reference plugins: github (full-stack: gh-CLI-backed issue/PR browser on
vendored shadcn components), slack-bot (webhook bot), agent-enrichment
(agent surfaces), small-ux-pack (host-rendered UI).
