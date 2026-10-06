---
kind: instruction
title: bb Guide — Plugins
summary: Command reference for installing, configuring, and running bb plugins, a summary of the bundled plugins, and the plugin authoring loop.
intent: Provide complete plugin management documentation, route each bundled plugin to its own skill, and route plugin authors to the bb-plugin-authoring skill.
editingNotes: Keep flags accurate against the CLI implementation (apps/cli/src/commands/plugin.ts, apps/cli/src/commands/marketplace.ts) and the server plugin service; a CLI test asserts every `bb plugin` and `bb marketplace` subcommand and flag appears in this chapter. Each bundled plugin gets a two-to-three-line summary here; its manual lives in the plugin's own skill. The full authoring reference is the bb-plugin-authoring builtin skill.
---
Plugin commands

A bb plugin is a TypeScript package that extends bb with server code, an
optional entry that runs on enrolled hosts, UI, agent skills and tools, and
`bb` CLI subcommands. Plugins are full-trust code.

Builtin plugins (`builtin:<name>`) ship with bb and install automatically.
Official store plugins ship with the app and install on request; third-party
plugins come from marketplaces, Git, npm, or a local path. Plugin state lives
under `<bb-data-dir>/plugins/<id>/` (SQLite database, secrets, logs).

  bb plugin search <query>       Search the store: the bundled official
                                 plugins plus every registered marketplace.
                                 Matches id, name, description, category, or
                                 tag; status shows installed, compatible,
                                 requires newer bb, or `id in use by <source>`
  bb plugin install <entry>      Install an official plugin by name (docs,
                                 memory, tasks, github, ...),
                                 <entry-id>@<marketplace>, a Git repository
                                 URL, a local path, builtin:<name>,
                                 git:<url>[@<ref|semver-range>], or
                                 npm:<package>[@<version|tag|range>].
                                 Installs ask for confirmation; --yes skips it.
                                 --subdirectory <path> or --plugin <name>
                                 selects one plugin of a multi-plugin
                                 repository; --tag-prefix <prefix> scopes a
                                 git: semver range. Installing a local path
                                 for an id already installed from another
                                 path moves it and keeps its settings.
                                 Installs run one at a time as server jobs
                                 that continue if the CLI or app disconnects;
                                 a repeat request joins the active job.
                                 --no-wait starts the job and prints its id
  bb plugin install-jobs         List queued, running, and recently finished
                                 installs (--json for the jobs)
  bb plugin cancel-install <job> Cancel an install: a queued job is dropped;
                                 a running job stops its download or build
                                 and installs nothing, unless it already
                                 started registering, which then finishes
  bb plugin outdated             Check installed plugins for compatible
                                 updates (--json for raw results), including
                                 newer releases blocked by engine ranges
  bb plugin update <id> | --all  Apply compatible updates for one plugin or
                                 every tracking plugin. Same confirmation as
                                 install (--yes skips; non-TTY refuses
                                 without --yes)
  bb plugin list                 Status, services, schedules, handler timings,
                                 and contributed CLI commands. `bb status`
                                 also names enabled plugins that are
                                 incompatible, failed, or missing
  bb plugin source <id> [--json] Requested and resolved source, subdirectory,
                                 semver range and resolved tag, engine ranges,
                                 install time, and recent activation history
  bb plugin enable|disable <id>  Load or unload an installed plugin. A
                                 builtin you never toggled follows bb's
                                 default; an explicit choice persists across
                                 releases
  bb plugin safe-mode [on|off]   Show or change safe mode. `on` stops every
                                 plugin you installed (official store plugins
                                 included) without changing its enabled
                                 setting; builtins keep running. `off`
                                 restarts them and exits 1 if any fail.
                                 Installs and updates of stopped plugins are
                                 refused until it is off
  bb plugin reload [id]          Restart plugins on their current sources.
                                 Exits 1 when one does not come up (the
                                 previous instance is kept or degraded)
  bb plugin config <id> [set <key> <value> | unset <key>]
                                 Show or change a plugin's declared settings.
                                 Running plugins receive changes live; a
                                 plugin waiting for configuration retries
  bb plugin logs <id> [-n N] [-f]  Print (or follow) a plugin's log
  bb plugin run <id> [args...]   Run a plugin command explicitly (also works
                                 when a core command owns its name)
  bb plugin token <id> [--rotate]  Print the token for a plugin's
                                 token-authenticated HTTP routes; --rotate
                                 replaces it
  bb plugin remove <id>          Uninstall and delete the plugin's settings,
                                 secrets, and schedules (local path sources
                                 stay on disk; builtin removals are
                                 remembered)

  bb marketplace add <source>    Add a marketplace from an https manifest URL,
                                 git:<url>[@<ref>], or path:<directory>.
                                 Adding a marketplace installs nothing
  bb marketplace list            Name, source, entry count, and last refresh
                                 (--json for raw rows)
  bb marketplace refresh [name]  Re-read one catalog or all of them. Never
                                 installs, updates, or runs plugin code; a
                                 failed refresh keeps the last valid catalog
                                 and exits non-zero
  bb marketplace remove <name>   Forget a marketplace. Plugins installed from
                                 it keep running as direct installs and keep
                                 updating from their recorded source.
                                 bb-official and bb-community cannot be
                                 removed

Installed plugins and their settings also appear under Settings → Installed
plugins.

Plugin CLI commands

A plugin can register one top-level `bb` subcommand (for example
`bb github …`); run it like any core command. Core command names win on a
collision, and `bb plugin list` then shows the `bb plugin run <id>` form.
Inside agent threads the generated `plugin-commands` skill lists every
available plugin command. Most plugin commands accept `--json` and `--help`.

Bundled plugins

Each bundled plugin documents its commands and behavior in its own skill.

- Prompt Library (builtin, disabled by default): enable with
  `bb plugin enable bb--prompt-library`. Open **+ → Prompts…** or press
  **Ctrl+R** to search, preview, star, and insert prompts. Its commands and
  behavior are documented in the `prompt-library` skill.
- Custom instructions (builtin): up to 4,096 characters saved under
  Settings → Custom instructions are added to every agent task on this host.
  `bb instructions get`, `bb instructions set <text...>`, and
  `bb instructions clear`.
- Account Pooler (builtin, off by default): pools Claude and Codex accounts
  behind the bb server with quota-aware failover. Run
  `bb plugin enable account-pool`, then `bb pool account add`,
  `bb pool status`, and `bb pool routing`; see the `account-pool` skill.
- Keep Awake (builtin): prevents idle sleep on selected macOS and Windows
  hosts while bb runs; closing the lid still sleeps.
  `bb keep-awake status|enable|disable [--json]`, `bb keep-awake hosts all`,
  or `bb keep-awake hosts <host-id>...`.
- Concurrency limit (builtin): caps running threads overall and per host.
  `bb concurrency-limit status|global|host`; see the `concurrency-limit`
  skill.
- Provider retry (builtin): queues an automatic retry after provider
  overloads and subscription-window limits.
  `bb provider-retry status|retry|cancel`; see the `provider-retry` skill.
- Thread list (builtin): owns the sidebar's layout preferences, synced to
  every window. `bb thread-list prefs list|get|set|reset`; see the
  `thread-list` skill.
- Push notifications (builtin): notifies mobile, web, and desktop clients
  when a thread needs attention.
  `bb push-notifications status|list|add|remove|test`; see the
  `push-notifications` skill.
- Secrets (builtin): `bb secret request <NAME...> --write-env <path>` collects
  credentials through a secure form into a dotenv file without exposing them
  to the agent; see the `secrets` skill.
- Inline previews (builtin): `::inline-vis{file="demo.html"}` renders a
  workspace HTML or Markdown file inline in chat; see the `inline-vis` skill.
- Automations (builtin): recurring or one-shot agent prompts and stored
  server scripts. `bb automation create|list|show|update|pause|resume|run|runs|delete`;
  see the `automations` skill.
- Workflows (builtin, off by default): durable JavaScript orchestration of
  worker threads. Run `bb plugin enable workflows`, then
  `bb workflows validate|run|status|history|list|stop`; see the `workflows`
  skill.
- Memory (official, `bb plugin install memory`): durable cross-provider
  agent memory. `bb memory catalog|search|get|add|update|forget|history`;
  see the `memory` skill.
- Docs (official, `bb plugin install docs`): document vaults with a
  pull/edit/push loop and reviewable proposals.
  `bb docs vaults|list|read|pull|status|push|propose`; see the `docs` skill.
- Tasks (official, `bb plugin install tasks`): a task tracker with agent
  delegation. `bb tasks show|list|comment|update|attach`, and
  `bb tasks --help` for the rest; see the `tasks` skill.
- Modal sandboxes (official, `bb plugin install environment-modal-sandbox`):
  reusable Modal cloud machines. `bb modal account inspect`,
  `bb machine create --provider modal-sandbox`, and `bb modal image|sandbox`;
  see the `modal-sandboxes` skill.

Multi-plugin repositories

One repository can hold several plugins, each an ordinary plugin directory
with its own package.json. An optional `.bb/plugins.json` collection manifest
indexes them:

  {
    "$schema": "https://getbb.app/schemas/plugins.schema.json",
    "schemaVersion": 1,
    "name": "acme-plugins",
    "plugins": [
      { "name": "sidebar", "source": "./plugins/sidebar" },
      { "name": "status", "source": "./apps/status" }
    ]
  }

Every source is a repository-relative directory starting with "./"; absolute
paths, "..", the repository root, duplicate names, and unknown fields are
rejected. The file is an index only: identity, branding, entry points, and
engine ranges stay in each plugin's manifest.

  bb plugin install git:github.com/acme/repo@main --plugin sidebar
  bb plugin install git:github.com/acme/repo@main --subdirectory plugins/sidebar
  bb plugin install path:/work/repo --plugin sidebar

--subdirectory works without a collection manifest; --plugin resolves a name
from .bb/plugins.json. When a repository with a collection manifest is not a
plugin itself and neither flag is given, the install fails and lists the
entry names. bb records the subdirectory, so outdated, update, and remove
work per plugin.

Marketplaces

`bb-official` lists the plugins bundled with the app. It reads a local catalog
and never uses the network; install its entries by bare name or qualified name
(`bb plugin install docs` or `bb plugin install docs@bb-official`). An app
update also updates the bundled copy.

`bb-community` lists reviewed plugins that live outside the app bundle, read
from https://getbb.app/marketplace/v2/marketplace.json at startup and every two
hours. Set BB_MARKETPLACE_URL (read at startup) to override the URL. An invalid
manifest keeps the last valid catalog. `bb plugin search` shows install counts
that bb measures through anonymous telemetry, so they undercount; third-party
marketplaces have none. Builtins show "Built in", and a plugin under 25
installs that was published in the last 30 days shows "New".
`bb plugin search --json` returns the raw `installs`, `installedByDefault`,
and long-form `overview` fields.

Anyone can host a third-party marketplace:

  bb marketplace add https://plugins.acme.dev/marketplace.json
  bb marketplace add git:github.com/acme/bb-marketplace@main
  bb marketplace add path:/work/acme-marketplace

The manifest `name` is the marketplace identity; duplicates and the reserved
`bb-official` and `bb-community` names are refused. Install an entry of a
specific marketplace with <entry-id>@<marketplace>:

  bb plugin install thread-hover-cards@acme-plugins

A bare id resolves across every marketplace: one match installs, several
matches fail and list the id@marketplace choices. Other source forms bypass
catalog resolution. Before installing from a third-party marketplace, bb shows
the marketplace, the entry's author, and the true source, including the exact
release tag and commit a range lands on. `--yes` skips the prompt, not the
resolution, and the install is refused if the listing or resolved commit
changes after confirmation. Settings → Plugin marketplaces manages the same
list. To publish a marketplace, see the bb-plugin-authoring skill.

Updates and pinning

Updates are manual: `bb plugin outdated` checks tracking sources and
`bb plugin update` applies compatible candidates. Reinstalling an installed
managed plugin is refused; use `bb plugin update`. A failed activation restores
the previous version and leaves the failure visible.

Exact npm versions, Git tags and commits, path sources, and bundled official
plugins are pinned. npm ranges, dist-tags, and omitted specs, omitted Git refs
(the default branch), Git branches, and Git semver ranges track compatible
updates. Change a pinned git:/npm: source with `bb plugin remove` (which
deletes settings, secrets, and schedules) and a fresh install. Edit a local
path plugin in place and `bb plugin reload <id>`, or move it with
`bb plugin install path:<new dir>`; both keep its configuration.

Managed git:/npm: installs refuse engines.bb and engines.bbPluginSdk
mismatches, manifest and artifact identity mismatches, and ids reserved by
bundled plugins. Git and path installs build the plugin on install (git
sources need `git`; bb ships its own npm), and a build failure fails the
install. npm packages must ship their prebuilt app and host bundles.

Git semver ranges

A git source can track releases over the repository's tags:

  bb plugin install git:github.com/acme/repo@^1.2.0
  bb plugin install git:github.com/acme/repo@semver:^1.2.0
  bb plugin install git:github.com/acme/repo@^1.2.0 --tag-prefix notes/

bb keeps tags named [<tag-prefix>]vX.Y.Z and installs the highest one the
range allows. Prereleases are excluded unless the range names one. Without
--tag-prefix tags are repository-wide (v1.2.3); with it they version one
plugin (notes/v1.2.3).

bb records the selected tag and its commit. If that tag later points at
another commit, bb refuses it and names both commits; remove and reinstall
the plugin to accept the new commit.

A bare spec that reads as a range (`^1.2.0`, `1.x`, `>=1 <2`) resolves over
tags only when no branch or tag has that literal name; when one does, the
install fails and asks you to choose `@semver:<range>` or `@ref:<name>`. Bare
version tags such as `v1` and `v1.2.3` are always the literal tag.

Authoring a plugin

  bb plugin new <name>           Scaffold ./bb-plugin-<name> (backend, sidebar
                                 page, `bb <name>` command, skill) and install
                                 its npm dependencies; no server required
  bb plugin install .            Register the directory in place
  bb plugin dev [path]           Watch sources, rebuild, and reload the
                                 installed plugin on every save
  bb plugin build [path]         Compile the plugin into dist/; no server
                                 required
  bb plugin types [path] [--check]  Sync the plugin's SDK and shimmed-package
                                 type pins to this bb; --check only reports
  bb plugin migrate [path] [--yes]  Move a plugin that vendors types/ to the
                                 @get-bb/plugin-sdk npm package

The full authoring reference (manifest, every API surface, build and release,
testing, and marketplace publishing) is the built-in `bb-plugin-authoring`
skill; in a checkout it lives under plugins/bb-guide/skills/bb-plugin-authoring/.
`plugins/` holds every bundled plugin and `examples/plugins/` holds reference
plugins.

## Inspect plugin RPC

`bb plugin rpc list [plugin-id] [--method <exact-name>] [--json]` lists discoverable methods from running plugins, optionally restricted to one plugin. `bb plugin rpc inspect <plugin-id> [method] [--json]` dumps registration and method descriptions plus input/output JSON Schemas. Copy the relevant schema into your consumer and call the existing plugin RPC endpoint. Discovery is opt-in advertising, not access control; method names may carry versions such as `provider-usage.v1.listResources`.

`bb plugin rpc call <plugin-id> <method> [--input-file <json-path>] [--json]` invokes a method using server-side schema validation. Omitting the input file sends JSON null. Input files avoid putting sensitive values in command arguments.
