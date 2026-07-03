---
kind: instruction
title: bb Guide — Plugins
summary: Command reference for installing, configuring, and running bb plugins and their contributed CLI commands.
intent: Provide complete plugin command documentation for agents and humans managing bb plugins.
editingNotes: Keep flags accurate against the CLI implementation (apps/cli/src/commands/plugin.ts) and the server plugin service.
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
  bb plugin token <id>           Print the token for auth:"token" HTTP routes
  bb plugin remove <id>          Uninstall (managed git:/npm: files deleted)
  bb plugin new <name>           Scaffold a new plugin (no server required)

Plugin CLI commands: a plugin can register one top-level subcommand (for
example `bb linear …`). Unknown `bb` commands are looked up against installed
plugins and proxied to the server, so plugin commands work exactly like core
commands; core command names always win. Inside agent threads the generated
`plugin-commands` skill lists the available plugin commands.

Settings changes do not auto-reload a plugin — run `bb plugin reload <id>`
after configuring. Add --json to plugin commands for machine-readable output.
