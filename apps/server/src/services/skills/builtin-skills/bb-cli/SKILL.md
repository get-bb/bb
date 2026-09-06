---
name: bb-cli
description: Use this when controlling bb. The bb CLI inspects and manages threads, environments, projects, machines, providers, visible Browser tabs, notifications, skills, plugins, settings, terminals, and other BB services.
---

# BB CLI

Use bb for BB state and actions. Inspect the current context before you choose
IDs, machines, workspaces, providers, or models.

## Start with context

```sh
bb status --json
```

Use JSON when command output controls later work. Use human output for quick
inspection.

Run `bb --version` for the CLI version. Use `bb --help` or `bb help [command]`
for help. Run bb guide for the system overview. Run bb guide <chapter> for one
area. Use bb <group> --help for current flags and defaults.

A standalone CLI targets http://127.0.0.1:38886. Use BB_SERVER_URL and
BB_HOST_DAEMON_PORT only for an intentional non-default target.

## Read only the relevant reference

- Read references/command-index.md to find the exact core command path. Use
  live help for current flags and defaults.
- Read references/configuration.md for settings, agent instructions, skills,
  remote clients, and environment setup scripts.
- Read references/thread-creation.md before you spawn or fork threads, create
  projects, select machines, or create environments.
- Read references/thread-operation.md for messages, queues, interactions,
  panes, terminals, inspection, and long-running commands.
- Read references/failure-recovery.md when a thread fails, stops, or needs plan
  or goal recovery.
- Read references/theme-commands.md for palette and favicon commands. Read
  references/theming.md before you create or edit theme CSS.
- Read references/plugins.md for plugin discovery, install, build, update,
  configuration, runtime, and contributed commands.
- Read references/app-settings.md for complete app setting keys and effects.

## Command habits

- Resolve names and IDs with a list or show command before mutation.
- Pass an explicit project when a command can act across projects.
- Pass an environment or machine selector when the default host is uncertain.
- Query provider models on the machine that will run the thread.
- Prefer non-interactive commands and machine-readable output for automation.
- Pass `--yes` for a confirmed destructive command in a non-interactive shell.
- Treat plugin commands as normal top-level commands after installation.

The builtin Account Pooler plugin is disabled by default. Enable it, add Claude
or Codex credentials, and inspect its proxy routes and account quota with:

```sh
bb plugin enable account-pool
bb pool account add --provider claude --login
printf '%s\n' "$CLAUDE_AUTH_CODE" | bb pool account login-complete --session <id> --code-stdin
bb pool account add --provider codex --login
bb pool account login-poll --session <id>
bb pool account add --provider claude --import
bb pool account add --provider codex --import
printf '%s\n' "$ANTHROPIC_API_KEY" | bb pool account add --provider claude --api-key-stdin [--label <text>] [--priority <n>]
bb pool account add --provider claude --api-key <key> [--label <text>] [--priority <n>]
bb pool account list [--json]
bb pool account remove <id>
bb pool account enable <id>
bb pool account disable <id>
bb pool status [--json]
bb pool routing <claude|codex> [--off]
bb pool config
bb pool config set <anthropicUpstreamBaseUrl|codexUpstreamBaseUrl|switchThreshold> <value>
bb pool token rotate --machine <id-or-name>
bb pool bypass <thread-id> [--off]
```

Claude `--login` starts a PKCE session, prints a browser URL and session ID,
then exits. Pipe the manual callback code to `account login-complete` with that
session ID within ten minutes. Codex `--login` prints a device verification
URL, one-time code, session ID, and an `account login-poll` command that waits
for authorization. The Claude code stays out of process arguments, and either
browser may be on a different machine from the bb server. Newly added or
enabled accounts are available without a plugin reload. With an
enabled account whose secret file remains readable and valid, matching Claude
Code or Codex sessions receive the pool route and a distinct secret token for
their machine.
Codex receives `CODEX_OPENAI_BASE_URL` and the secret
`CODEX_POOL_AUTH_TOKEN`; bb applies them as in-memory app-server config.
Tokens are never printed. `status` prunes tokens for unenrolled machines and
shows token timestamps plus recently routed threads whose machines need a
local Claude login before the pool can be disabled safely. Rotation keeps the
prior token valid for ten minutes. Agents should pipe API keys to
`--api-key-stdin`;
`--api-key <key>` is an unsafe compatibility form that exposes the key in
process arguments, shell history, and agent transcripts. Prefer `--import` for
an existing Claude Code login. The CLI Codex import path reads
`~/.codex/auth.json` on the bb server host. OAuth quota refreshes on add or
enable and every five minutes while an account is idle. Account tables add columns for observed
model-family buckets; JSON status exposes their utilization, reset, status,
observation time, and source under `familyWeekly`. Selection skips an account
whose requested family is spent while retaining it for other families. A
present `metadata.user_id` account UUID is aligned with the selected OAuth
account. Use `bb pool config` to inspect the full routing configuration and
`bb pool config set <key> <value>` to update one value. The upstream URL keys
are QA-only overrides; `switchThreshold` must be greater than 0 and at most 1.

- Inspect real status, logs, API results, or diffs instead of assumptions.
- Keep file paths on the machine that owns the selected workspace.

## Browser control

Use `bb browser list --json` before each Browser action. `bb browser open
--thread <thread-id>` creates a thread-owned Browser without changing the
visible app layout, even when that thread's Browser panel is not mounted. It
never falls back to another thread. A connected tab supplies the exact target
for later actions; activate an inactive tab through its panel owner.

```sh
bb browser list --json
bb browser open --thread <thread-id> --url <url> --json
bb browser run --client <client-id> --window <window-id> --tab <tab-id> --epoch <navigation-epoch> --action '{"kind":"snapshot","mode":"interactive"}' --json
bb browser wait --client <client-id> --window <window-id> --tab <tab-id> --epoch <navigation-epoch> (--locator <json> | --text <text> | --url <url> | --navigation <start|commit> | --load-state <state> | --popup | --request <url> | --response <url> | --download-blocked) [--match <exact|glob>] --json
bb browser capture --client <client-id> --window <window-id> --tab <tab-id> --epoch <navigation-epoch> (--out <path> | --json) [--mode viewport|full-page|element] [--format png|jpeg] [--quality <1-100>]
bb browser capture-download --descriptor <json-file> --out <path> --json
bb browser plugin --plugin <plugin-id> --controller <controller-id> --client <client-id> --window <window-id> --tab <tab-id> --epoch <navigation-epoch> --input <json> [--timeout <seconds>] --json
bb browser batch --items '[{"id":"snapshot","target":{"clientId":"<client-id>","windowId":"<window-id>","tabId":"<tab-id>","navigationEpoch":<epoch>},"action":{"kind":"snapshot","mode":"dom"}}]' --json
```

CSS, accessibility, shadow-root, and nested cross-origin frame locators are
supported. Discover child frames with `{"kind":"list-frames"}` and attach the
returned opaque `{"frameId":"...","documentEpoch":...}` target to a locator;
never retain a frame target after its document or the main page changes.
Actions cover native pointer and form controls, file upload by bounded base64
content, navigation and tab lifecycle, typed waits, screenshots, dialogs,
permissions, page storage, diagnostics, and explicit native browser-profile
cookie import.
Downloads remain blocked. Clear imported cookies only with
`{"kind":"clear-imported-cookies","confirm":true}`; this clears the shared
managed Browser partition.

The service controls the visible native Browser rather than another Chromium
session. Every action uses the exact client, window, tab, and page revision;
unsupported navigation and stale revisions reject instead of retargeting.
Permission changes and viewport profiles remain scoped to the selected tab and
clear with Browser-view teardown.

`bb browser capture --out <path>` streams validated image chunks to the machine
running the CLI and releases the resource. Use `--json` instead of `--out` to
create a live canonical descriptor without downloading:
`{ captureId, mimeType, pixelSize, byteLength, target, expiresAt }`.
Save that JSON and use `bb browser capture-download --descriptor <json-file>
--out <path>` to download and release it. Creation rejects stale epochs; immutable
bytes remain readable after navigation, but not after release or expiry. Valid
reads refresh the two-minute idle lease up to an absolute ten-minute lifetime.

Plugin-owned Browser workflows run through `bb browser plugin`, which sends an
opaque `--input` JSON command to the plugin's
`experimental_browserController` registered for that exact revision; the live
controller parses the input and answers with JSON. A disabled, reloaded, or
crashed controller and a stale epoch reject before any handler effect.

## Common checks

```sh
bb project list --json
bb machine list --json
bb provider list --environment "$BB_ENVIRONMENT_ID" --json
bb thread show "$BB_THREAD_ID" --json
bb environment status "$BB_ENVIRONMENT_ID" --json
bb plugin list --json
bb skill list --environment "$BB_ENVIRONMENT_ID" --json
```

## Completion

Confirm the command result and any affected thread, environment, plugin, or
remote service. Report the stable ID or URL that the user needs next.


## Plugin configuration

Use `bb plugin config <id>` to inspect the plugin’s configuration and
`bb plugin config <id> set <key> <value>` to change it. Read the plugin’s own
guidance for its delivery commands and supported clients. A server-side
notification switch does not grant browser or operating system permission;
that permission is granted from the target client’s settings.
