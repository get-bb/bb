# Configuration

The packaged `npx bb-app` flow stores persistent package settings under
`~/.bb/config.json`, provider environment values under `~/.bb/env.json`, and
client SSH target mappings under `~/.bb/client.json`.

Use `bb-app config` for non-secret bb settings and `bb-app env` for provider
credentials and provider-specific environment:

```bash
npx bb-app config set BB_APP_URL https://<machine>.<tailnet>.ts.net
npx bb-app config list
npx bb-app config unset BB_APP_URL
npx bb-app config refresh
npx bb-app env set OPENAI_API_KEY <key>
npx bb-app env list
npx bb-app env unset OPENAI_API_KEY
```

`bb-app config list` shows non-secret values. `bb-app env list` redacts every
value and only shows whether a key is set. When targeting a non-default
running instance, pass the same `--data-dir` and `--server-port` to
`bb-app config` or `bb-app env` so they write the right file and refresh the
right server.

Launcher status output is plain when stdout is redirected, including in CI.
Set `FORCE_COLOR=1` to request color or `NO_COLOR=1` to disable it; `NO_COLOR`
takes precedence. In-place progress updates require a stdout TTY.

## Repository worktree hooks

Commit `.bb-env-setup.sh` when a managed worktree needs repository setup.
Commit `.bb-env-teardown.sh` when bb must release external resources before it
removes that worktree. See [Worktrees, setup scripts, and teardown
scripts](worktrees.md) for the lifecycle, environment, timeout, and failure
contracts.

## Precedence

Configuration is resolved in this order:

1. Explicit launcher flags, such as `--data-dir`, `--server-port`, or
   `--server-bind-host`.
2. Persistent `bb-app config`, `bb-app env`, and client values.
3. Ambient shell environment.
4. Built-in defaults.

For the packaged app, prefer `bb-app config`, `bb-app env`, and launcher flags
over shell variables. Source-development commands still load `.env` files
(see [Source Development](#source-development)).

After `bb-app config` writes `~/.bb/config.json` or `bb-app env` writes
`~/.bb/env.json`, it asks the running local server to reload. If bb is not
running, the new values apply on the next start. If you edit either file by
hand, run `npx bb-app config refresh` to apply it to a running server.

The live reload applies the `BB_APP_URL` config key, `customModels`,
`sharedSkillRoots`, and provider env values. `BB_APP_URL` stored with
`bb-app env` instead of `bb-app config` is startup-only.

These entries are startup-only:

- `BB_APP_SURFACE`, `BB_APP_URL` (when set through `bb-app env`),
  `BB_DATA_DIR`, `BB_DEV_APP_PORT`, and `BB_EXTERNAL_URL`
- `BB_HOST_DAEMON_PORT` and `BB_INHERITED_SKILLS_ROOTS`
- `BB_CONNECT_GATE_KEYS_URL`, `BB_LOG_LEVEL`,
  `BB_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD`, `BB_MARKETPLACE_URL`,
  `BB_PERF_DIAGNOSTICS`, `BB_POSTHOG_API_KEY`, and `BB_TELEMETRY`
- `BB_SERVER_BIND_HOST`, `BB_SERVER_PORT`, and all `BB_FF_*` feature flags

Setting or unsetting one still reloads any other pending changes, but running
processes keep their current values until a full launcher restart
(`bb-app stop && bb-app start`) or a desktop app restart. In particular,
changing or unsetting `BB_SERVER_BIND_HOST` does not close an existing
`0.0.0.0` listener until that restart. `bb-app config refresh` names any
startup-only keys present in `config.json` or `env.json`.

## Stopping A Running bb

A running `bb-app start` writes `<dataDir>/bb-app-runtime.json` (launcher
process id, server URL, version, start time, and launch mode) and removes it on
exit. Do not edit it. `npx bb-app stop` uses it to stop the bb that owns the
data directory; pass the same `--data-dir` you started with when it is not the
default `~/.bb/`. The macOS desktop app uses it to offer stopping a bb it did
not start. Both verify the recorded process is a bb launcher before signalling
it, so a stale file cannot stop an unrelated process.

## The bb Command On PATH

Settings → General → Command line has an **Install** button that installs the
bb CLI for use outside bb: it puts the `bb` command on your PATH, so you, a
script, or an agent running outside bb (such as Claude Code or Codex) can
control bb with `bb thread list` and every other CLI command. Threads in bb
already have `bb` on their PATH and need nothing. **Remove** takes it off again. Nothing changes your PATH until
you choose Install. The CLI equivalent is `bb settings cli-command` (show),
`bb settings cli-command install`, and `bb settings cli-command remove`; the
SDK methods are `system.experimental_cliCommand()`,
`system.experimental_installCliCommand()`, and
`system.experimental_removeCliCommand()`, over
`GET /api/v1/system/cli-command` and `POST .../install` and `.../remove`.

- Every start of an installed bb (`npx bb-app` or the desktop app) writes a
  small launcher to `<dataDir>/bin/bb` (`bb.cmd` on Windows). It runs the bb
  CLI of the install that started last, with that install's own Node runtime,
  so the desktop app needs no separate Node. After bb moves or updates, start
  it once to refresh the launcher. Source checkouts (`pnpm start`, `pnpm dev`)
  write no launcher and do not show the setting.
- Install acts on the computer that runs the bb server. On macOS and Linux it
  links the launcher into the first usable folder of `/opt/homebrew/bin` and
  `/usr/local/bin` (macOS only), `~/.local/bin`, and `~/bin`, preferring one
  already on your PATH. If the folder is not on your PATH, the setting says so.
  On Windows it appends `<dataDir>\bin` to your user PATH.
- bb never replaces another `bb`. If one already comes first on your PATH
  (for example a global `npm install -g bb-app`, the `~/.local/bin/bb` a bb
  machine install added, or Babashka), the setting names it and Install is
  refused with `409 cli_command_blocked`.
- Remove deletes only links that point at a bb launcher, or the
  `<dataDir>\bin` PATH entry on Windows.
- Machine credentials cannot install or remove the command.

`BB_CLI_LAUNCHER` is an internal path the launcher passes to its server child;
do not set it yourself.

## In-App Updates

In-app updates are on when you start bb with `npx bb-app start` (or a global
`bb-app`) or with `pnpm start` from a source checkout. bb runs under a small
update shim, so Settings → Updates and `bb updates app apply` can update bb
without a terminal. Pass `--no-in-app-updates` to turn them off: bb then starts
without the shim and Settings → Updates shows the npm upgrade command for
release installs. `--in-app-updates`, which earlier releases needed, is still
accepted and changes nothing. Source checkouts show their
Git revision, or a labeled build version when unavailable, and are never compared
with npm releases. Without the update shim, no freshness indicator is shown.
Failed checks report “Latest unknown”; release checks can be retried in the UI,
with `sdk.system.version({ force: true })`, or by rerunning `bb updates`.
`GET /api/v1/system/version` and `sdk.system.version()` expose nullable
`installKind` (`desktop`, `npm`, or `source`) and `currentCommit` fields.

- **npm installs** download the release into
  `<dataDir>/app-versions/<version>/` and restart into it. The shim runs
  whichever is newer, that install or the launched `npx` copy; `--bundled`
  always runs the launched copy. bb keeps the running and previous versions.
  Stable installs follow the `latest` dist-tag and nightly builds `nightly`.
- **Source checkouts** update only from a clean `main` that fast-forwards to
  `origin/main`; bb fast-forwards, runs `pnpm install --frozen-lockfile`,
  rebuilds, and restarts.

bb does not roll back an update; a version that fails to start runs again on
the next start, and an older release may not open a database the new version
migrated. The outcome is recorded in `<dataDir>/bb-app-update.json` (do not
edit it). Only one launcher manages updates for a data directory; a second
`bb-app start` on it runs with in-app updates off. `pnpm dev`, `bb-server`, and a standalone
`bb-host-daemon` do not offer in-app updates. `BB_APP_UPDATE_MODE`,
`BB_APP_INSTALL_KIND`, `BB_APP_SOURCE_ORIGIN`, and `BB_APP_SOURCE_COMMIT` are
internal markers the launcher passes to its server child; do not set them. See
`bb guide machines` for the `bb updates` commands.

Settings → Updates shows the **Server** row for both standalone servers and servers
hosted by the desktop app. **Update** downloads the release and restarts the
server, using the hosting desktop's native updater when applicable. It asks
before interrupting running threads and checks again when the download finishes.
A separate **Desktop** row appears when the viewing desktop needs attention and
is not the desktop hosting the server. The same server update is available with
`bb updates app apply` and `sdk.system.applyAppUpdate`.

Desktop update capability is an additive `desktopUpdateSupported: true` field in
`SystemAppUpdateStatus`. The legacy `support` value remains
`{ kind: "unsupported", reason: "desktop" }`, so previously shipped clients can
still parse the response and keep their existing desktop update path. New clients
use the capability to offer the shared server controls. If an updater request
fails, confirmed support is retained and installation is blocked until a retry
succeeds. Desktop/server IPC stays within the bundled process tree and does not
change the host-daemon protocol.

## Common Keys

| Key                            | Set with                                           | When to set             | Used for                                                                                                                                                                                                                                                                   |
| ------------------------------ | -------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BB_APP_URL`                   | `bb-app config`                                    | Optional for remote use | Human-facing app URL used for generated links, allowed browser origins, and the allowed DNS hostname for requests. Leave empty for local-only use. Live when set with `bb-app config`.                                                                                     |
| `BB_EXTERNAL_URL`              | `bb-app env`, or environment                       | Startup-only            | Internet-facing HTTPS base URL for generated public links; the fallback for `machineServerUrl`.                                                                                                                                                                            |
| `BB_MARKETPLACE_URL`           | `bb-app env`, or environment                       | Startup-only testing    | Manifest URL of the reserved `bb-community` marketplace. Default `https://getbb.app/marketplace/v2/marketplace.json` (falls back to v1 on 404); a custom URL is requested without fallback. Changes only `bb-community`.                                                   |
| `BB_CONNECT_GATE_KEYS_URL`     | `bb-app env`, or environment                       | Startup-only testing    | Public key set the bb connect next tunnel ingress verifies gate assertions with. Default `https://getbb.app/.well-known/bb-connect-gate-keys.json`. See [connect-next.md](connect-next.md).                                                                                |
| `BB_SERVER_URL`                | `bb-app config`                                    | Remote CLI/host use     | Server targeted by the standalone `bb` CLI and `host-daemon` commands on this machine. Defaults to `http://127.0.0.1:38886`. It does not change where `npx bb-app` binds.                                                                                                  |
| `BB_SERVER_BIND_HOST`          | `bb-app env`, environment, or `--server-bind-host` | Startup-only            | Server listener host: `127.0.0.1` (default) or `0.0.0.0`. Not a `bb-app config` key. See [Startup Flags](#startup-flags).                                                                                                                                                  |
| `BB_SERVER_PORT`               | `bb-app env`, environment, or `--server-port`      | Startup-only            | HTTP listener port. Defaults to `38886`.                                                                                                                                                                                                                                   |
| `BB_HOST_DAEMON_PORT`          | `bb-app env`, environment, or `--host-daemon-port` | Startup-only            | Local host-daemon API port. Defaults to `38887`.                                                                                                                                                                                                                           |
| `BB_LOG_LEVEL`                 | `bb-app config`                                    | Startup-only debugging  | `trace`, `debug`, `info`, `warn`, `error`, or `fatal`.                                                                                                                                                                                                                     |
| `BB_TELEMETRY`                 | `bb-app env`, or environment                       | Startup-only            | `false` always disables anonymous usage telemetry, overriding the `telemetryEnabled` setting.                                                                                                                                                                              |
| `BB_SKIP_ONBOARDING`           | Environment                                        | Startup-only            | Default false. `1` marks first-run setup completed at startup when it is not yet, so the setup screen is skipped. Settings → General can still replay it. `pnpm dev`, `pnpm start:worktree`, and `pnpm desktop:worktree` default it to `1`; an explicit `0` retains setup. |
| `BB_PERF_DIAGNOSTICS`          | `bb-app env`, environment, or `--perf-diagnostics` | Startup-only            | Default false. Permits the `performanceDiagnostics` experiment; see [Experiments](#experiments).                                                                                                                                                                           |
| `BB_CLI_ERROR_LOG`             | Environment of the `bb` process                    | Optional                | `0` stops the CLI recording failed invocations (command path, error code, no argument values) to `<dataDir>/logs/cli-errors.jsonl`. See `bb guide overview`.                                                                                                               |
| `BB_ACCOUNT_POOL_PARENT_URL`   | Set automatically by a parent bb server            | Nested bb servers       | Account Pooler hub of the bb server whose thread launched this one. When present the Account Pooler plugin is enabled on first run and proxies to that parent; `bb pool parent isolate` opts out. Not a `bb-app config` key.                                               |
| `BB_ACCOUNT_POOL_PARENT_TOKEN` | Set automatically by a parent bb server            | Nested bb servers       | Machine token this nested server presents to the parent hub. Both parent variables must be well formed or proxying stays off.                                                                                                                                              |

BB accepts request hosts that are `localhost`, IP addresses (including LAN and
Tailscale IPs), or the hostname in `BB_APP_URL`. For a custom DNS name or
reverse proxy, set `BB_APP_URL` (for example `https://bb.example.com`) before
connecting, including from the CLI or SDK; a matching `Host`/`Origin` or
`X-Forwarded-Host` cannot authorize an unconfigured name. A proxy can preserve
the configured host or forward to localhost. bb connect needs no additional
configuration.

## General settings

`idleProviderSessionTimeoutMinutes` (default `30`) sets how long an agent can sit idle after its last turn before every machine stops its provider process to free memory. Allowed values are `0` (ASAP), `5`, `10`, `30`, and `60`. Use Settings → Providers → Configuration → Release idle agent sessions, `bb settings general idleProviderSessionTimeoutMinutes 5`, or SDK `system.updateGeneralSettings({ ...config.generalSettings, idleProviderSessionTimeoutMinutes: 5 })`. Read `config` with `system.config()` or inspect the value with `bb settings show`. Changes apply live and on reconnect. Machines check every five minutes, so release can take up to five minutes beyond the timeout. Only restorable sessions without active, pending, or background work are eligible; threads keep their history and resume on the next message. Manual `bb thread stop` still works. This is not a memory or loaded-process limit.

Server-wide preferences, stored in the bb database and applied live to every
client. Set them in Settings, with `bb settings general <key> <value>`, or with
SDK `system.updateGeneralSettings`, which takes the full settings object (read
the current `generalSettings` and change one key). See `bb guide customization`
for the command surface.

| Key                                                                        | Default                             | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `showDiagnosticEvents`                                                     | `false` in all builds               | Settings → General → Privacy & diagnostics → Show diagnostic events. Shows provider environment resolution and raw provider events bb does not yet understand in the timeline. Warnings, errors, and model fallback stay visible. Hidden diagnostics do not count toward timeline event or byte limits.                                                                                                                                                                                                                                        |
| `steerActiveThreadOnEnter`                                                 | `true`                              | Settings → General → Default thread followup behavior, when no typeahead suggestion is active. `true` ("Steer"): Enter sends to the agent during its current run and Mod+Enter queues the message until the agent stops; `false` ("Queue") swaps them. Installs with saved settings or work from before the setting were migrated once to `false`.                                                                                                                                                                                             |
| `confirmThreadArchive`                                                     | `true`                              | Settings → General → Thread archive confirmation. `false` archives a thread and its children in the app without a confirmation popup; the toast still offers Undo. CLI and SDK archives never prompt.                                                                                                                                                                                                                                                                                                                                          |
| `showGitChanges`                                                           | `true`                              | Settings → General → Show Git changes and Commit button. `false` hides the untracked, uncommitted, and committed file summary and expanded file list above every thread composer, that shelf's pull-request status and actions, and the Commit action in the thread header and overflow menu. Thread relationships and workspace warnings stay visible.                                                                                                                                                                                        |
| `keepHistoryAfterContextClear`                                             | `false`                             | Settings → General → Show messages from before a context clear. When `false`, a thread's timeline, conversation outline, and message lookup start at its latest `Context cleared` boundary; `true` keeps earlier messages, which load on scroll and appear in the outline and `bb thread log --message`. Clearing always starts a fresh provider conversation and resets the context meter.                                                                                                                                                    |
| `summarizeShellCommands`                                                   | `true`                              | Settings → General → Summarize shell commands. `true` titles a shell command that runs `ls`, `find`, `grep`, `rg`, `cat`, `head`, `tail`, `nl`, or `sed -n` with a summary such as `Searched for X`, and the row does not expand. `false` titles every shell command row with its command (`Running …`, `Ran …`), expands it to the command and its output, and counts it as a command in step summaries. Native read and search tool rows keep their titles.                                                                                  |
| `streamerMode`                                                             | `false`                             | Settings → General. Hides every `customModels` entry from the web and mobile pickers, `bb provider models`, and `sdk.providers.models`, for example before a screen share. Entries stay in `config.json`; a thread that names a hidden model still runs, and default model resolution keeps the full list, so a provider whose only models are custom still starts. A composer whose stored selection is hidden falls back to the provider default and records it on the next send; reselect the custom model after turning streamer mode off. |
| `allowFastServiceTier`                                                     | `true`                              | Settings → Providers. `false` hides the service tier control and runs every new turn at the default tier, including explicit requests for another tier (`fast`, Codex `ultrafast`, or any tier a provider lists), automations, and queued messages. Completed turns and project defaults saved while off keep the default tier.                                                                                                                                                                                                                |
| `managedBranchPrefix`                                                      | `bb/`                               | Settings → General → New branch prefix. Prefix for branches bb creates for worktrees and new checkout branches (`bb/fix-login-flow-thr_ab12cd34ef`); empty for none. At most 64 characters and must start a valid git branch name (no space or leading `-`). Existing branches and worktrees keep their names.                                                                                                                                                                                                                                 |
| `providerOrder`                                                            | `[]`                                | Settings → Providers (move a provider up or down). JSON list of provider ids that lead the picker, such as `'["claude-code","codex"]'`; unlisted ids follow in plugin install order and unknown ids are ignored.                                                                                                                                                                                                                                                                                                                               |
| `defaultProviderId`                                                        | `null`                              | Settings → Providers. Provider for new threads when neither caller nor project chose one; `null` means the first available provider in picker order.                                                                                                                                                                                                                                                                                                                                                                                           |
| `telemetryEnabled`                                                         | `true`                              | Settings → General → Privacy & diagnostics → Share anonymous usage data. Takes effect immediately; `BB_TELEMETRY=false` overrides it.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `earlyAdopter`                                                             | `false`                             | Settings → Experiments → Become an early adopter. Turns on experiments marked Early adopter unless you set them yourself; see [Experiments](#experiments).                                                                                                                                                                                                                                                                                                                                                                                     |
| `machineServerUrl`, `defaultMachineAccess`, `machineGitCredentialsEnabled` | See [Multi-machine](#multi-machine) | Machine access and credential forwarding.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**Terminal clipboard.** Settings → General → Terminals → Copy on select
(`terminalCopyOnSelect`, default `true`) copies completed terminal selections
exactly and shows a "Selection copied" notification. Selections in messages,
files, and prompt editors are unchanged. Disable it with
`bb settings general terminalCopyOnSelect off` or SDK
`system.updateGeneralSettings`, preserving the other general settings.
The server persists it across windows and restarts; older clients that omit it
preserve the saved value. Explicit Copy/Paste remain available when it is off.
On Linux browsers with native primary-selection support, middle-click focuses
the terminal and pastes the primary selection independently of this setting.
Unsupported browsers never substitute unrelated regular clipboard contents.

Older clients that omit `showGitChanges`, `keepHistoryAfterContextClear`,
`summarizeShellCommands`, or `earlyAdopter` preserve the saved value. For older SDK callers, the
general-settings API still accepts and returns `showUnhandledProviderEvents` as
a deprecated alias of `showDiagnosticEvents`, and an existing value is
preserved; when a read-modify-write payload contains conflicting values, the one
changed from the saved setting wins. Codex memory and native subagents live on
the Codex provider plugin; Claude Code's options are under
[Claude Code provider](#claude-code-provider).

**Composer keys.** The prompt box uses plain-text editing; Markdown delimiters
stay visible. Outside an open typeahead menu, Shift+Enter inserts a newline. On
coarse-pointer touch devices, the software-keyboard Return inserts a newline
and the submit button sends; iPadOS WebKit keeps the Enter and Command+Enter
shortcuts for a connected Magic Keyboard.

**Completed turn display.** The "Collapse finished turns" switches in Settings
→ Providers store `providerCompletedTurnDisplay`, a map of provider id to
`collapse` (finished work folds into one "Worked for" row and the final answer
stays visible) or `flat` (every step stays visible, as while the turn ran). A
provider without an entry uses its registration's `completedTurnDisplay`
default: Claude Code is `flat`, other first-party providers `collapse`. It
applies to existing threads, the outline, and `bb thread log`. Set it with
`bb settings completed-turns <provider-id> <collapse|flat|default>`, where
`default` removes the entry; `bb settings completed-turns` lists every
provider's current display.

**Setup guide.** A new install opens a first-run setup guide (connect an agent,
add projects, pick plugins, set up devices). `onboardingCompletedAt` records
when it was finished or skipped; `bb settings replay-onboarding`, or Settings →
General → Setup guide, clears it so the guide shows again. The projects step
lists what `bb project discover` and
`bb.sdk.hosts.experimental_discoverRepos({ hostId })` return.

**Anonymous usage telemetry.** PostHog events carry a random install id, app
version, install kind, platform, OS release, architecture, and Node version.
The server sends `app_started`, `telemetry_disabled`, `thread_created`,
`user_message_sent`, `turn_finished`, and `plugin_installed`. The app reports setup-guide and
first-send events through `POST /api/v1/system/telemetry/events`
(`sdk.system.experimental_recordTelemetryEvent`): `onboarding_started`,
`onboarding_step_reached`, `onboarding_step_completed`,
`onboarding_step_skipped`, `onboarding_finished`, `onboarding_agent_state`,
`onboarding_sign_in`, and `new_thread_submit` (started, accepted, or failed).
The route accepts only these events with fixed enums and booleans: no provider
ids, account details, prompts, project or file names, terminal output, error
messages, or session ids. Sign-in `exited` means the command exited before
readiness was observed, not that authentication succeeded; `new_thread_submit`
`accepted` means the thread was created, not that the provider answered.
By default (`BB_FF_INITIATOR_TELEMETRY=false` turns it off), `thread_created` and `user_message_sent` also carry
`initiator`: `user`, `agent`, `automation` (started by the automations
plugin), `plugin` (any other plugin), or `system` (bb's own retries and follow-ups). Sends from a plugin carry its ID (the plugin SDK adds `originPluginId`), so automation
runs into an existing thread report `automation`. `bb thread spawn` run inside a thread
sends that thread as `senderThreadId`; the new thread reports `agent` when the sender has a
turn running, and `user` otherwise.

`turn_finished` sends only `outcome` (`succeeded`, `failed`, or `stopped`),
`error_category` (`none`, `auth`, `billing`, `rate_limit`, `limit_reached`,
`provider_unavailable`, `start_failed`, `process_exited`, `host_lost`, or `other`),
`provider` (a shipped built-in provider ID, otherwise `other`), and
`install_turn_number`, in addition to the standard event properties. The stored
per-install number increments atomically on each enabled finish. It pauses while
telemetry is off and resumes at the next number when enabled again.

## AI services

Thread titles (and the branch names built from them), commit messages, and
voice transcripts come from AI services that plugins register. Each task
(`thread-title`, `commit-message`, `voice`) is `automatic` (default), `off`,
or a service id; set it in Settings → AI services or with
`bb settings ai-services set <task> <value> [--plugin <plugin-id>]` (see
`bb guide customization`). Automatic tries bb cloud (the `bb-ai` plugin, for a
signed-in bb account) first, then every other registered service supporting
the task in lexicographic order of plugin id and service id; unavailable
services and failed requests fall through. A picked service is used alone; if
it fails, titles fall back to the start of the prompt and commits to
`bb: automated commit`. `bb ai off|on` turns bb cloud off and on; see the
`bb-cloud-ai` skill.

The removed `BB_INFERENCE`, `BB_INFERENCE_FALLBACK`, and `BB_TRANSCRIPTION`
keys are ignored with a warning in `~/.bb/config.json`, and `bb-app config set`
refuses them.

bb accepts voice recordings up to 25 MB; a service may set a lower limit, and
Codex transcribes up to 20 MB and bb cloud up to 10 MB. With a ChatGPT
subscription login, Codex transcription can be blocked by Cloudflare bot
protection on some networks; run `codex login --with-api-key` on the primary
machine or pick another voice service.

Open microphone preferences by right-clicking the composer microphone, pressing
Shift+F10 while it is focused, or clicking the Microphone control in Settings →
Voice Input; desktop uses an anchored popover and mobile a drawer. Preferences
are available only while idle; the recording row contains only cancel, stop,
and send. Opening preferences starts a local microphone preview with the
recording waveform and a list of inputs; the preview is not saved or
transcribed, and closing preferences releases it.

The microphone preference is client-local: localStorage
`bb.voiceInput.audioInputDeviceId` holds the selected browser `MediaDevices`
device id. Select System default to follow system microphone changes; the
choice does not change which service transcribes. Recording tries the
preferred device, then the system default, then other available inputs for
missing or unreadable devices; permission denials do not trigger fallback. A
disconnect during recording switches the input into the same recorder,
preserving audio captured before the disconnect. A reconnected preferred
microphone is used again from the next recording; it does not interrupt the
current fallback recording.

A missing preferred microphone alone does not block recording or show a
warning. Capture failures, interrupted input, or no available inputs after
access was granted show a decorative warning badge on the idle microphone;
clicking it then opens preferences. During capture, five seconds of
near-silent audio produces a warning in the open preview or an accessible
status in the recording row. Silence warnings clear when audio returns and
never stop recording or switch microphones automatically.

## Themes

`bb theme` controls CSS-variable overrides for the app palette and typography
(see `bb guide customization`). Custom themes live at
`<bb-data-dir>/theme/<name>/theme.css`, with optional `pierre-dark.json` and
`pierre-light.json` code themes.

The typography tokens are mode-independent and belong in the `:root, .light`
block:

- `--font-sans` controls app UI and body text.
- `--font-mono` controls code blocks, diffs, file paths, and previews.
- `--font-serif` controls serif prose.
- `--font-terminal` controls the integrated terminal's font family.

Always end font stacks with a generic fallback such as `sans-serif` or
`monospace`. The complete theme token reference is in the bb-cli skill's
`references/theming.md`.

## Keyboard Shortcuts

Settings → Keyboard, `bb settings keyboard set|reset`, and SDK
`system.updateKeyboardSettings` store per-command overrides in the server
database, applied live to every window, including desktop menu accelerators.
Reset removes an override so future releases can update the default; `disabled`
unbinds a command. Overrides may be scoped to `mac`, `windows`, or `linux`. Plugin
commands bind as `plugin:<plugin-id>/<command-id>`. See
`bb guide customization` for scoping and plugin-binding rules.

`showKeyboardHints` (default `true`; `bb settings keyboard hints <true|false>`)
shows delayed shortcut badges while the modifier is held; shortcuts work
either way.

`Mod` means Command on macOS and Control on Windows/Linux. Numbered thread and
pane shortcuts follow Slack's browser-safe convention: web uses
`Control+1…9` on macOS and `Ctrl+Shift+1…9` on Windows/Linux, while desktop
uses `Mod+1…9`. The web aliases leave native browser `Mod+1…9` tab switching
untouched. Previous and next thread use `Mod+Shift+[/]` on desktop and
`Control+Shift+[/]` on the web; they follow the sidebar order.

`history.back` / `history.forward` (Go back / Go forward) do the same thing
as the sidebar's back and forward arrows: they move through the pages opened
in the current window, like browser history. They use `Mod+[` / `Mod+]` on
desktop and the web; in the browser, bb handles the key instead of the
browser's own Back while it has somewhere to go. At either end the desktop app
does nothing, while the web app leaves the key to the browser's own Back or
Forward. The commands appear in the command palette only when there is
somewhere to go, and they don't run while the in-app browser has focus.
Hovering an arrow shows its current shortcut.

On macOS, `panel.previousTab` / `panel.nextTab` default to
`Command+Control+ArrowLeft/Right` (cycling visible right-panel tabs and each
pane's New tab button), `panel.previousNewTabItem` / `panel.nextNewTabItem`
to `Command+Control+ArrowUp/Down` (on a New tab page), and
`pane.focus.left|right|up|down` to `Command+Control+Shift+Arrow…` (spatial
chat-pane focus). These start unassigned on Windows/Linux to preserve native
Control-arrow editing. `pane.focus.previous` / `pane.focus.next` and
`panel.fullScreen.toggle` start unassigned.

`thread.rename`, `thread.archive`, `thread.markRead`, and `thread.pin` start
unassigned and act on the focused pane's open thread; Mark read and Pin toggle
like the matching thread menu item.

| Area      | Command                                      | Default                     | Availability             |
| --------- | -------------------------------------------- | --------------------------- | ------------------------ |
| Palette   | Quick palette                                | `Mod+Shift+P`               | All clients              |
| Window    | Back to app (from Settings, Plugins, Skills) | `Escape`                    | All clients              |
| Threads   | New thread                                   | `Mod+N` / `Mod+Shift+O`     | Desktop / web            |
| Threads   | Search threads                               | `Mod+K`                     | All clients              |
| Threads   | Rename focused thread                        | Unassigned                  | Thread view              |
| Threads   | Archive focused thread                       | Unassigned                  | Thread view              |
| Threads   | Mark focused thread read or unread           | Unassigned                  | Thread view              |
| Threads   | Pin or unpin focused thread                  | Unassigned                  | Thread view              |
| Threads   | Previous / next thread                       | Surface defaults above      | Desktop / web            |
| Threads   | Open visible thread 1–9                      | Platform defaults above     | Web / desktop            |
| Layout    | Previous / next chat pane                    | Unassigned                  | While split              |
| Layout    | Focus chat pane 1–8                          | Platform defaults above     | Split (web / desktop)    |
| Layout    | Maximize / restore chat pane                 | `Mod+Shift+E`               | While split              |
| Layout    | Close focused chat pane                      | `Mod+Shift+X`               | While split              |
| Layout    | Toggle sidebar                               | `Mod+\`                     | All clients              |
| Window    | New window                                   | `Mod+Shift+N`               | Desktop                  |
| Window    | Find in window                               | `Mod+F`                     | Desktop                  |
| Window    | Settings                                     | `Mod+,`                     | All clients              |
| Window    | Open data directory                          | Unassigned                  | Desktop                  |
| Window    | Open local logs                              | Unassigned                  | Desktop                  |
| Window    | Show all notifications                       | Unassigned                  | All clients              |
| Plugins   | Turn plugin safe mode on / off               | Unassigned                  | All clients              |
| Panel     | New tab / close tab / toggle                 | `Mod+T` / `Mod+W` / `Mod+J` | All clients              |
| Panel     | Reopen closed tab                            | `Mod+Shift+T`               | Desktop                  |
| Workspace | Quick open file / toggle diff                | `Mod+P` / `Mod+D`           | All clients              |
| Workspace | Open terminal                                | `Mod+Shift+Enter`           | All clients              |
| Workspace | Open in preferred app                        | `Mod+O`                     | All clients              |
| Composer  | Focus composer                               | `Mod+Shift+C`               | All clients              |
| Composer  | Toggle model picker                          | `Mod+Shift+M`               | All clients              |
| Composer  | Cycle model forward / backward               | `Alt+M` / `Alt+Shift+M`     | All clients              |
| Composer  | Cycle provider forward / backward            | `Alt+P` / `Alt+Shift+P`     | All clients              |
| Composer  | Cycle reasoning effort forward / backward    | `Alt+T` / `Alt+Shift+T`     | All clients              |
| Browser   | Focus location / reload / find in page       | `Mod+L` / `Mod+R` / `Mod+F` | Desktop embedded browser |
| Questions | Choose visible answer 1–9                    | `1` … `9`                   | While a question is open |

Cycle shortcuts act only from the active composer or an open picker; other
editable controls keep their Option-composed input. Reasoning cycles through
the current model's supported efforts from low to high.

## Client SSH Targets

`~/.bb/client.json` is local to the machine showing the UI; the remote server
does not read it. It maps a server and work host to an SSH target (the value
that works after `ssh`, such as `devbox`, `user@devbox`, or a `Host` entry in
`~/.ssh/config`) so the local helper can open remote paths in local editors and
terminals. Without a helper, local editor actions are unavailable.

```bash
npx bb-app client ssh-target set https://bb.example.test devbox --host-id host_abc
npx bb-app client ssh-target list
npx bb-app client ssh-target remove https://bb.example.test --host-id host_abc
```

Use `--host-id` (from `bb machine list`) when the server has more than one
machine. Without it, `set` auto-selects the single machine and `remove` removes
every mapping for that server.

```json
{
  "servers": {
    "https://bb.example.test": {
      "hosts": {
        "host_abc": {
          "sshAuthority": "devbox"
        }
      }
    }
  }
}
```

## Provider availability

The core `disabledProviderIds` list disables individual providers by id. Change
it from a provider row's menu in Settings → Providers, `bb provider
disable|enable <id>`, or `sdk.providers.setEnabled`; a general-settings save
cannot change it. A disabled provider is hidden from pickers and
`bb provider list`, and new turns, sessions, queued messages, and automations
on it are rejected; its plugin, sibling providers, CLI, and threads are kept.
Enable removes the id, restoring automatic discovery, and enables the
supplying plugin if needed. Uninstalling a plugin forgets its providers'
disabled state. See `bb guide providers`.

## Custom ACP Agents

Add your own ACP agent through the ACP providers plugin's `customAgents`
setting, a JSON array, in Settings → Plugins → ACP providers or:

```bash
bb plugin config provider-acp set customAgents '[
  {"id": "amp", "displayName": "Amp", "command": "amp", "args": ["acp"]}
]'
```

Each entry needs `id` (lowercase letters, digits, and dashes), `displayName`,
and `command`. bb derives the provider id `acp-<id>`, which never changes once
a thread has used it. `cursor` is reserved; an entry with an id bb lists only
where the agent is installed (`opencode`, `omp`, `grok`, `hermes-agent`)
replaces the shipped agent and keeps its `nativeSkillRoots` unless it sets its
own. Optional fields: `args`, `env`, `cwd`, `modelCli` (CLI model listing and
selection), `reasoningCli` (launch-time reasoning flags), `nativeReasoning`
(ACP `session/set_config_option` reasoning), `nativeSkillRoots`
(`{"user": [...], "project": [...]}` relative paths; an entry is a path or
`{"path": ..., "recursive": true, "ancestors": true}`), `permissionCli`
(permission-mode launch flags), `supportsManualCompaction` (bb hides
`/compact` otherwise), `providerUsage`, and `dialect` (`cursor`, `opencode`,
`omp`, or `grok`).

Changes apply immediately, with no restart. A custom agent's command is local
code execution and only works with a co-located daemon. The `customAcpAgents`
key in `config.json` is no longer read. Known agents, OpenCode launch settings,
and OpenCode Go usage are covered by the `acp-provider` skill.

Agents from the official ACP registry can be added in the same settings
section or with `bb acp registry`, `bb acp add <agent-id>`, and
`bb acp remove <agent-id>`. An added agent is a `customAgents` entry running
the registry's `npx` or `uvx` package on the thread's host.

## Custom Models

Register extra picker models with top-level `customModels` in
`~/.bb/config.json`, for a model the provider accepts but does not list. There
is no set/unset CLI: edit the JSON, then run `npx bb-app config refresh` or
restart bb. `bb-app config list` prints the entries.

```json
{
  "customModels": [
    { "providerId": "claude-code", "model": "claude-example-preview" },
    {
      "providerId": "acp-my-agent",
      "model": "my-proxy/my-model",
      "displayName": "My Proxy Model"
    }
  ]
}
```

`providerId` accepts `codex`, `claude-code`, `pi`, `acp-cursor`, or any
`acp-*` provider id. `displayName` is optional. bb skips an invalid entry with
a warning. Entries appear after the provider's own catalog in the model picker
and `bb provider models`; the provider catalog wins on an id collision, and
`streamerMode` hides them. An entry only makes the id selectable:
`claude-code` and `codex` accept unlisted ids, an ACP agent can reject one at
session start, and OpenCode rejects ids outside its own catalog, so add
OpenCode models (and default agents) to the OpenCode config instead.

## Agent Instructions

bb appends user-level and workspace-level instructions to every
provider-backed thread's system prompt when a provider session starts:

- `<dataDir>/AGENTS.md` for defaults across projects.
- `<workspace>/.bb/AGENTS.md` for repo-specific guidance.

When both exist, the data-dir file comes first. An empty or whitespace-only
file is treated as absent. bb injects these itself, so they apply to every
provider; provider-native files such as a repo-root `AGENTS.md` or `CLAUDE.md`
remain separate. See `bb guide agent-configuration`.

## Skills

User-level skills live under `<dataDir>/skills/<name>/SKILL.md` (usually
`~/.bb/skills`). Project skills live under
`<workspace>/.bb/skills/<name>/SKILL.md`. Enabled plugins contribute
`skills/<name>/SKILL.md` (relocatable with the manifest's `bb.skills` field).
Project skills override user skills, which override plugin skills, by name.

All skill discovery uses the shared skills index. User roots, skill directories,
and `SKILL.md` entries may be symlinks. Project skills and Markdown commands may
follow links only within their workspace (or the repository boundary for an
ancestor root). Traversal resolves real paths and stops cycles. Each recursive
skill root reads at most 1,000 folders and each command root at most 1,000
entries; files inside skill folders do not count. Supporting files in an
injected skill tree must remain ordinary files and directories; linking the root
or `SKILL.md` is supported.

`bb skill list`, the SDK, and the Skills page collapse registrations that share a
name and identical `SKILL.md` bytes, preferring provider-neutral and user-wide
registrations. Different contents with the same name, and identical contents under
different names, remain distinct. Previously issued registration IDs still address
their original registration. Linked registrations are read-only in bb. Runtime
catalogs collapse skills with the same name and identical trees, and Claude Code
omits injected copies already visible under the same name in its native user or
project roots. Selected Codex skills are sent as structured skill inputs with the
path from Codex's active catalog, matched by catalog name or skill directory name,
for both starting and steering a turn; a selected skill missing from that
catalog is sent as plain text only.

Top-level `sharedSkillRoots` in `~/.bb/config.json` adds one provider-neutral
skill collection: `{"user": [...], "project": [...]}` relative paths, resolved
from the home directory and the workspace. bb indexes them read-only and
injects selected skills into every provider; bb user and project skills win on
a name collision. Apply edits with `npx bb-app config refresh`.

bb also indexes each provider's native skill roots for that provider's `/`
menu, the Skills page, and `bb skill list`. The shipped provider plugins
declare:

| Provider     | User roots                                                                                               | Project roots                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Codex        | `~/.agents/skills`, `$CODEX_HOME/skills`                                                                 | `.agents/skills` from the repository root to the current directory, plus `.codex/skills`                     |
| Claude Code  | `$CLAUDE_CONFIG_DIR/skills` or `~/.claude/skills`, plus enabled plugin skills                            | `.claude/skills` from the repository root to the current directory, plus enabled plugin skills               |
| Pi           | `~/.pi/agent/skills`, `~/.agents/skills`                                                                 | `.pi/skills` in the workspace; `.agents/skills` from the repository root to the current directory            |
| Cursor       | `~/.cursor/skills`, `~/.agents/skills`, `~/.claude/skills`, `~/.codex/skills`                            | The same four roots in the workspace                                                                         |
| OpenCode     | `~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills`                                      | `.opencode/skills`, `.claude/skills`, and `.agents/skills` from the repository root to the current directory |
| omp          | The active `~/.omp/.../agent` roots and supported Pi, Agents, Claude, Codex, and OpenCode roots          | `.omp/skills` and the supported compatibility roots from the repository root to the current directory        |
| Grok Build   | `$GROK_HOME/skills` or `~/.grok/skills`, plus `~/.agents/skills`, `~/.claude/skills`, `~/.cursor/skills` | The same four roots from the repository root to the current directory                                        |
| Hermes Agent | `$HERMES_HOME/skills` or `~/.hermes/skills`                                                              | None                                                                                                         |

OpenCode also uses `$OPENCODE_CONFIG_DIR/skills`. Pi and omp use
`$PI_CODING_AGENT_DIR`; omp selects its profile with `$OMP_PROFILE` or
`$PI_PROFILE`. Cursor and Hermes roots are scanned recursively, and Pi finds
skills at any depth under its roots. Pi settings
and packages, omp's `skills.customDirectories`, Hermes' `skills.external_dirs`,
and Grok's `[skills].paths` in `config.toml` add paths; Grok also reads enabled
Grok and Claude-compatible plugin skills.

## Multi-machine

Multi-machine execution lets this server dispatch work to host daemons on
other machines; it is independent of browser access (Tailscale, bb connect).
Add, rename, and remove machines in Settings → Machines; see
`bb guide machines` for the CLI.

**Permission ceiling.** Each machine has `maxPermissionMode` (default `full`).
Every thread on that machine is resolved down to the ceiling, and a provider
that supports no mode under it is refused there. Only an owner session sets it,
on the machine's page in Settings → Machines; it is deliberately absent from
the SDK and CLI, and machine credentials cannot change it. Read it with
`bb machine list --json`.

**Machine server access.** `machineServerUrl` (Settings → Machines → Server URL
reachable by machines; HTTP or HTTPS without embedded credentials) falls back
to `BB_EXTERNAL_URL` when unset. `defaultMachineAccess` selects the access
provider; unset selects bb connect, and `direct` (Manual) uses your own URL.
An explicit provider must be installed and available. Set them with
`bb settings general machineServerUrl <url-or-null>` and
`bb settings general defaultMachineAccess <provider-id-or-null>`.

**Daemon updates.** Machines install the host package from the owning server
(falling back to npm only when the server has no package route) under the
machine's bb data directory, so enrollment needs no `sudo`. Installed services
run with `--auto-update`: daemons follow newer server protocols, never
downgrade, and retry failures with backoff from 5 seconds to 5 minutes. Remove
the flag from the launchd plist or systemd user unit and reload the service to
opt out.

### Machine installer

`BB_DATA_DIR` on the installer selects the machine's state directory instead of
`~/.bb-machines/<server-host>`. Enrollment refuses the default `~/.bb` unless its
`host-id` already names this machine.

On Linux the installer installs a persistent systemd user service, retrying with
the runtime path from `loginctl` when the user bus is unavailable and failing
before enrollment if it still cannot reach it. In containers and on machines
without systemd as init it runs a detached daemon instead. Set
`BB_INSTALL_SKIP_SERVICE=1` on the installer command only when running without a
service is intentional; nothing then restarts the daemon after a reboot.

The installer writes these `config.json` fields; they are managed by bb, not
user knobs. Do not copy, edit, or commit them, and re-add the machine instead of
changing them:

- `serverUrl`: the server this machine belongs to.
- `serverHeaders`: private request headers from the access provider, passed to
  the daemon and its bundled `bb` CLI through `BB_SERVER_HEADERS` (a JSON
  string map) for enrollment, HTTP, WebSocket, and proxy requests.
- `machineCredential` and `connectMachineId`: the legacy bb connect form;
  `machineCredential` is sent as the `x-bb-connect-machine` header.

These secret fields are omitted from `bb-app config list`.

The Settings → Machines installer assigns each standalone daemon a stable local
API port, persisted in the machine data directory; its command accepts
`--host-daemon-port <port>` when an explicit port is needed.

### Machine environment

Settings → Environment variables (scope All projects or one project) and
Project settings → Advanced settings edit encrypted environment variables for
machines. Global values sync into every host daemon, including the primary
host. Project values follow the project across machines and worktrees and are
passed only to operations core runs for that project: agent turns, source
clones, setup/teardown hooks, and new terminals. Plugin host calls receive
global values only.

Precedence: built-in credentials, then global variables, then project
variables; agent-provider contributions win over all of them. An empty string
is an explicit override; deleting a project override restores the inherited
value. Existing terminals keep their launch environment, and agent turns pick
up changes on their next turn.

Values are encrypted with the key in `<dataDir>/machine-environment-key`; back
it up with the database. Names and notes are public metadata, and settings
APIs never return values. CLI: `bb machine env list|set|unset [--project <id>]`
(set reads the value from stdin); SDK: `sdk.system.machineEnvironment` and the
matching `sdk.projects` methods. See `bb guide machines`.

**GitHub credential forwarding.** `machineGitCredentialsEnabled` (default
`true`; the automatic GH_TOKEN switch in Settings → Environment variables)
forwards the server's `gh` login to non-primary hosts as `GH_TOKEN`, a Git
credential helper and SSH URL rewrites for github.com, and author/committer
identity, without installing helper files or global Git config. The primary
host keeps its local Git authentication; a server without a local host daemon
has no primary host, so every machine receives the token. An explicit global or
project `GH_TOKEN` overrides the built-in token. Changes apply to new turns,
setup commands, and terminals.

## Sidebar preferences

Core sidebar and Info panel layout preferences live in a server-side keyed registry shared by every
window, device, and the CLI. Each key has a typed schema, a default, and a
revision; a write that names a stale revision gets `409
ui_preference_conflict`. Read and write them with `bb settings ui
list|get|set|reset` or `sdk.system.uiPreferences` (see
`bb guide customization`).

| Key                           | Value                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sidebar.threadListProvider`  | Plugin key or `__automatic__` (default): the first installed thread list plugin other than the bundled `thread-list/thread-list`, else the bundled one |
| `sidebar.navigationProvider`  | Plugin key or `__automatic__` (default): the first navigation from a plugin other than the bundled Navigation plugin, else its `navigation/rail`       |
| `sidebar.pluginPanelOrder`    | Navigation destination order                                                                                                                           |
| `sidebar.visiblePluginPanels` | Navigation destinations shown, or `null` for every destination                                                                                         |
| `sidebar.footerOrder`         | Footer action order                                                                                                                                    |
| `sidebar.hiddenFooterItems`   | Footer actions moved into More                                                                                                                         |
| `infoPanel.collapsedSections` | Collapsed thread Info panel sections (`commits`, `uncommittedChanges`, `childThreads`, `forks`, `threadStorage`, or `<pluginId>/<sectionId>`)          |

A legacy `__builtin__` thread list selection resolves to the bundled plugin.
Footer IDs are `builtin:settings` (top list layout only), `builtin:mobile`,
`builtin:report-bug`, and
`plugin:<encoded pluginId>/<encoded registrationId>`; unknown and
disabled-plugin IDs are retained, and new actions default to visible. The
footer can also be edited from its More menu or Settings → Appearance → Sidebar
footer.

The bundled Navigation plugin draws the navigation. Its default layout,
`navigation/rail`, is a vertical rail on the left edge of the sidebar that holds Home (the last thread),
the visible destinations (Plugins, Skills, plugin panels), More (hidden
destinations and Customize navigation), and Settings at the bottom. New thread sits
in the sidebar header and cannot be hidden from the rail. The list beside the rail swaps
between the thread list, Plugins, Skills, and Settings; collapsing the sidebar
leaves only the rail. On narrow windows and phones the rail sits inside the
drawer. In the macOS desktop app, wide windows add a title bar with the window
controls, Back and Forward, and the sidebar toggle.

With `sidebar.navigationProvider` set to `navigation/top-list` (Settings →
Appearance → Navigation), there is no rail. The visible destinations, New
thread among them, and More (hidden destinations and Customize navigation) are
labeled rows above the thread list, with plugin panel badges at the end of
their row. New thread can be reordered and hidden like any other row.
Settings is a footer action, and the Settings, Plugins, and Skills lists start
with a Back to app row. Collapsing hides the whole sidebar, and the macOS
desktop app keeps the window controls over the sidebar instead of a separate
title bar. A navigation plugin gets the rail or list layout its registration
declares, and a list navigation can bring its own controls beside the sidebar
toggle; legacy `__builtin__` and `navigation/navigation` read as
`__automatic__`. Disabling the Navigation plugin with no other navigation
plugin installed leaves the list layout with no destinations; Settings stays
in the footer.

The layout keys `sidebar.organizationMode`, `sidebar.threadGrouping.environment`,
`sidebar.chronologicalSort`, `sidebar.sortDirection`, the three section-order
keys, and `sidebar.hiddenGroups` are legacy: the
bundled Thread list plugin copies non-default values once and then keeps its
own preferences ([Thread list plugin](#thread-list-plugin)).

Sidebar width and open state stay in each browser tab or desktop window; a new
window starts from the most recent choice in that browser. The command
palette's Active/Archived filter is browser-local and has no CLI/SDK setting.

## Experiments

Experimental surfaces are changed in Settings → Experiments or with
`bb settings experiment <key> <true|false>`. All experiments start off.
bb stores only the experiments you set; the others follow the shipped default.

The `earlyAdopter` general setting (the Become an early adopter banner on
Settings → Experiments, `bb settings general earlyAdopter on`) switches the
shipped default to the early adopter default: experiments marked Early adopter
(currently `timelinePush`, `compactExpiredCache`, and `sidebarMultiSelect`) turn on, and the rest stay
off. An experiment you set yourself keeps your value either way.
`/system/config` and `sdk.system.config()` return the resolved values in
`experiments`.

- `changelogPreview` shows the latest release notes as a dismissible card on
  Settings → Updates.
- `compactExpiredCache` (on for early adopters) reports `compactionOfferAt` on a thread's context
  usage (timeline `contextWindowUsage` and `bb thread context`) once the
  provider has reported a prompt-cache lifetime, the provider supports manual
  compaction, and the context holds at least 100k tokens. After that time the
  composer shows a Compact chip beside the context meter; while it is on, the
  next send passes `compactFirst` so the server runs `/compact` and queues the
  message behind it. Clicking the chip keeps the full history for that one
  send.
- `serverMove` enables Move server here in Settings → Machines,
  `bb server move`, `bb server export`, and old server copy deletion; while off
  those routes return 403 `server_move_experiment_disabled` (status and cancel
  stay available). See `bb guide machines`.
- `performanceDiagnostics` turns on server performance diagnostics: slow
  database, API, and event-loop logging, periodic performance samples, and
  continuous V8 CPU profiles written every 30 seconds to
  `<dataDir>/logs/performance/`. Profiles are kept for 12 hours with a 1 GB
  total cap (oldest first), and a profile over 12 MiB is discarded. It needs
  startup permission from `BB_PERF_DIAGNOSTICS=1` or the launcher flag
  `--perf-diagnostics` (`pnpm start`, `pnpm start:worktree`, `bb-app`), which
  requires a restart; without it the toggle is hidden and cannot start
  collection. The experiment itself applies live; turning it off restores
  normal logging and flushes the in-flight profile, keeping saved files. See
  [diagnostics](debugging-and-qa.md#opt-in-server-performance-diagnostics).
- `sidebarMultiSelect` (on for early adopters) lets the built-in thread list
  select several threads: Cmd/Ctrl+Shift-click toggles a row (starting from the
  open thread), Shift-click selects the visible range from the last clicked row,
  and a plain click, Cmd/Ctrl-click, Escape, or a click outside the sidebar
  clears the selection.
  Right-clicking a selected row offers Mark read/unread, Pin/Unpin,
  Notifications, Move to section, Archive (Unarchive when every selected
  thread is archived), and Delete for the whole selection. Archive and Delete
  ask once for the whole selection, counting child threads that are not
  selected, and act on the topmost selected threads; Archive skips the
  question when the Archive confirmation setting is off. Dragging a selected row moves
  every selected thread onto a section, under a thread, or into Pinned, or drops
  them onto a composer as one mention per thread. Cmd/Ctrl-click still opens a
  thread in a split. Plugins read it with
  `experimental_useExperiment("sidebarMultiSelect")`.
- `timelinePush` makes an open thread view subscribe to its latest timeline
  window over the WebSocket (`thread-timeline` subscription target); the server
  pushes the full window once, then row deltas after new events, instead of the
  client refetching the latest window after every update. A missed push falls
  back to the delta request used when it is off. Open views follow a toggle
  live.
- `unreadDividerAtAnswer` moves the NEW divider in an unread thread from the
  first row after your read point to the answer of a turn that finished while
  you were away: the turn's final assistant message, or the error that ended
  it. The turn's tool calls and in-between notes stay above the divider. A
  message that started a new turn keeps the divider above it, a turn that is
  still running or has no answer keeps the old placement, and the divider never
  lands on your own message. It applies the next time you open a thread.

## Thread Timeline Window

`BB_FF_TIMELINE_WINDOW_EVENT_BUDGET` (default 1500) guides how many
conversation groups a timeline page selects and caps the content leaves it
returns. It is a server-start operator setting, not a hard limit on query
bytes, events, or CPU: one large turn can need substantially more work. Pages
target 4 MiB of rendered rows. The API and SDK contract is in
[timeline-pagination.md](timeline-pagination.md).

Timeline builds slower than 150 ms log `Thread timeline build blocked the event
loop`, and event-loop stalls over 500 ms log `Event loop stalled`, both at
`info`.

## Plugins

Plugins are on by default. Builtin plugins ship with bb; the official plugins
(GitHub, Docs, Memory, Tasks) ship bundled in the app, install from that copy
without network access, and update with bb releases. See `bb guide plugins` for
installing, sources, updates, and marketplaces, and the `bb-plugin-authoring`
skill for manifests and `engines` ranges. Plugins are full-trust code running
inside the bb server process.

Plugin state lives under the data dir:

```
<dataDir>/plugins/<id>/data.db     Per-plugin SQLite database
<dataDir>/plugins/<id>/secrets/    Secret settings and the plugin HTTP token
<dataDir>/plugins/<id>/logs/       bb.log output (plugin.log, JSONL, rotated
                                   at 5MB; read with `bb plugin logs <id>`)
<dataDir>/plugins/git/, npm/       Managed installs for git:/npm: sources
<dataDir>/marketplaces/staging/    Throwaway checkouts for git: marketplace
                                   refreshes
<dataDir>/skills-generated/        Server-generated skills (the
                                   plugin-commands skill)
```

Marketplace catalogs live in the bb database. The reserved `bb-community`
marketplace comes from `BB_MARKETPLACE_URL`. A `git:` marketplace reads
`marketplace.json` from the repository root, or from the directory saved with
`bb marketplace add --subdirectory <relative-path>`. The server checks installed
plugins for updates every 6 hours but never applies them.

Plugin settings are changed on the plugin's page under Settings → Installed
plugins, with `bb plugin config <id> set <key> <value>`, or with SDK
`plugins.updateSettings({ pluginId, values })`. Running plugins receive changes
live.

### Multi-plugin repositories

An optional `.bb/plugins.json` collection manifest at a repository root
indexes several plugins, each a directory with its own `package.json` and `bb`
manifest:

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

The file is strict: `schemaVersion` must be `1`, names match
`^[a-z0-9][a-z0-9-]*$`, unknown fields and duplicate names are rejected, and
each `source` is a repository-relative directory starting with `./` (absolute
paths, `..`, empty segments, and the repository root are refused). An invalid
file is rejected whole. It is an index only and never overrides a plugin's
identity, branding, entry points, or engine ranges. Select an entry with
`bb plugin install … --plugin <name>`.

### BB guide

BB guide is installed and enabled by default. Its boolean settings, all
default `true`, are `introduction` (the BB introduction), `skills` (all four
bundled skills), and `bbCli`, `pluginAuthoring`, `skillCreator`, and
`submitPlugin` (individual skills). They apply the next time agent
configuration is assembled. Disabling the plugin removes its introduction and
skills.

### Claude Code provider

| Setting                      | Default | Effect                                                                                                                                                                                                                                                                |
| ---------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `disable1MContext`           | `false` | Sets `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` (`0` when off).                                                                                                                                                                                                               |
| `chromeEnabled`              | `false` | Starts Claude Code with `--chrome` for Claude in Chrome tools, which bb otherwise leaves off even when the interactive `claude` CLI enables them; the host needs the extension and a claude.ai login (API-key sessions stay off).                                     |
| `artifactsEnabled`           | `false` | Sets `CLAUDE_CODE_ARTIFACT=1` so Claude Code loads its Artifact tools (read, publish, and edit claude.ai artifacts), which it withholds from SDK sessions by default; when off, bb leaves any inherited value alone. Claude may publish private pages without asking. |
| `sandboxEnabled`             | `true`  | Runs Bash in Claude Code's sandbox in Accept Edits and Approve for me modes; `false` uses Claude Code's own approvals and sandbox settings.                                                                                                                           |
| `fullAccessApprovalsEnabled` | `false` | Shows Claude Code's own prompts in Full Access (`permissions.ask` rules, PreToolUse hooks that answer `ask`, and built-in safety checks); `false` approves every request. Applies from the next turn without a restart.                                               |

Set them with `bb plugin config provider-claude-code set <key> <value>`. Unless
noted, a change restarts the thread's Claude process before its next turn,
keeping the conversation. Memory, native subagents, and the Workflow tool are toggled on
the provider's page in Settings → Providers (see `bb guide providers`).

Two host-daemon environment variables reach the Claude Code bridge:
`BB_CLAUDE_CODE_EXECUTABLE` picks the `claude` binary, and
`CLAUDE_CODE_OAUTH_TOKEN` authenticates a machine with no interactive login,
such as a CI runner (mint it with `claude setup-token`). See the
`claude-code-provider` skill.

### Account Pooler [Experimental]

The builtin Account Pooler plugin pools Claude and Codex accounts behind the bb
server. It is disabled on fresh installations (`bb plugin enable
account-pool`), except that a nested server with `BB_ACCOUNT_POOL_PARENT_URL`
enables it. Account tokens and per-machine hub tokens are 0600 files under
`<dataDir>/plugins/account-pool/secrets/accounts/`.

| Setting                    | Default                                 | Effect                                                                                     |
| -------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------ |
| `switchThreshold`          | `0.98`                                  | Shared or model-family quota fraction at which an account stops receiving matching traffic |
| `anthropicUpstreamBaseUrl` | `https://api.anthropic.com`             | Upstream for Claude traffic; only for tests and QA with a fake upstream                    |
| `codexUpstreamBaseUrl`     | `https://chatgpt.com/backend-api/codex` | Upstream for Codex traffic; only for tests and QA with a fake upstream                     |

Inspect and change them with `bb pool config` and
`bb pool config set <key> <value>`. Values stored through `bb.settings` by
older builds are not migrated. Provider routing is persisted per provider and
defaults on; `bb pool routing <claude|codex> --off` stops it. See the
`account-pool` skill for accounts, ordering, and routing.

### Concurrency limit

The builtin Concurrency limit plugin caps running threads. The overall limit is
unlimited by default; each host defaults to Auto (one thread per available
processor), a blank host field restores Auto, and `0` pauses new work for that
scope. Configure it on its autosaving plugin page or with
`bb concurrency-limit status|global|host`; see the `concurrency-limit` skill.

### Keep Awake

The builtin Keep Awake plugin prevents idle system sleep on selected macOS and
Windows hosts while bb runs; on macOS it runs
`/usr/bin/caffeinate -i -w <worker-pid>`. Closing the lid or choosing Sleep
still sleeps the machine. Its settings are an enable switch and an
all-or-selected host list, set on its autosaving plugin page or with
`bb keep-awake status|enable|disable` and `bb keep-awake hosts all|<host-id>...`
(each accepts `--json`).

### Push notifications

The builtin Push notifications plugin's `mobileEnabled`, `webEnabled`, and
`desktopEnabled` booleans default to `true`. `expoPushUrl` (default
`https://exp.host/--/api/v2/push/send`) is the relay URL, read on every send.
`defaultLevel` (default `all`) and `childLevel` (default `input-only`) set
top-level and child thread levels. Set them with
`bb plugin config push-notifications set <key> <value>`. Web and desktop
notifications need an open bb tab or window, HTTPS or localhost, and
per-device permission; the plugin's settings page offers permission and test
controls. See the `push-notifications` skill for levels, devices, and
`bb push-notifications test|thread`.

### Storage & retention

The bundled Storage & retention plugin is disabled by default
(`bb plugin enable bb--storage-retention`). Configure it in its sidebar panel,
where every setting saves immediately, or with `bb storage retention`, which
previews until `--save --yes`. It keeps its policy and latest run in its own
storage; there are no general app settings for retention.

| Setting                                              | Default | Flag                                                                          |
| ---------------------------------------------------- | ------- | ----------------------------------------------------------------------------- |
| Archive after / delete after                         | Never   | `--archive-after <days\|never>`, `--delete-after <days\|never>` (1–3650 days) |
| Delete thread storage on archive                     | Off     | `--delete-storage-on-archive <true\|false>`                                   |
| Delete development data when its checkout is removed | Off     | `--delete-dev-data-on-checkout-removal <true\|false>`                         |

Archive eligibility uses each affected member's `updatedAt`; deletion requires
every lifecycle member to have been archived past the cutoff. The plugin uses
the SDK thread listing and archive/delete APIs, accepting changes between
inspection and mutation, and disabling it stops retention without losing the
saved policy. Development-data cleanup stores no removal history in the core
database. The plugin owns the disk scanner, cached reports, classification,
and host-worker file operations behind `bb storage usage` and the cleanup
commands; background cleanup started from the page survives navigation and
reconnects. See the
[plugin skill](../plugins/storage-retention/skills/storage-retention/SKILL.md).

### Ask User Question plugin

The builtin Ask User Question plugin keeps an unanswered question card open for
30 minutes by default. When it expires, the agent receives a timeout result and
the card closes. Choose `1 hour`, `4 hours`, `8 hours`, `24 hours`, `3 days`, or
`7 days` under the plugin settings, or configure it from the CLI:

```bash
bb plugin config ask-user-question set questionTimeout "24 hours"
```

The setting applies to questions asked after it changes. A server restart still
closes every open card.

### Provider retry plugin

The builtin Provider retry plugin is enabled on fresh installations. It queues
a retry after Codex and Claude Code subscription-window limits that report a
reset time, and retries provider overloads with backoff. `maximumWait`
(`6 hours` default, `24 hours`, or `No limit`) skips scheduling resets beyond
that horizon:

```bash
bb plugin config provider-retry set maximumWait "24 hours"
```

Disable it with `bb plugin disable provider-retry`. See the `provider-retry`
skill.

### Workflows plugin

The builtin Workflows plugin is disabled on fresh installations
(`bb plugin enable workflows`). Its settings are bounded integers:

| Key                    |    Default |       Allowed range | Behavior                                               |
| ---------------------- | ---------: | ------------------: | ------------------------------------------------------ |
| `maxActiveRuns`        |        `4` |            `1`–`32` | Concurrent runs across the plugin; changes apply live. |
| `maxConcurrentAgents`  |        `8` |            `1`–`64` | Concurrent agent calls within one run.                 |
| `maxAgentCalls`        |      `100` |          `1`–`1000` | Total agent calls within one run.                      |
| `totalRunTimeoutMs`    | `86400000` | `60000`–`604800000` | Maximum total run duration in milliseconds.            |
| `retentionDays`        |        `7` |          `1`–`3650` | Days to retain completed workflow data.                |
| `maxNotificationBytes` |    `16384` |     `1024`–`262144` | Maximum UTF-8 size of a completion notification.       |

The settings other than `maxActiveRuns` are snapshotted into each new run. See
the `workflows` skill.

### Thread list plugin

The bundled Thread list plugin owns the sidebar thread list layout, synced to
every window. Change it from the list header's Organize and Filter menus, a
row's Customize actions, or `bb thread-list prefs get|set|reset <key>`
(`set` takes JSON; a bare word is a string). See the `thread-list` skill.

| Key                   | Default                           | Values                                                                                                                                      |
| --------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `organizationMode`    | `chronological`                   | `project`, `chronological` (Custom), or `machine`                                                                                           |
| `environmentGrouping` | `auto`                            | `true` collapses sibling threads sharing a worktree into one row, `false` never does, `auto` groups except in `chronological`               |
| `groupByReadStatus`   | `false`                           | Lists unread threads above the rest; exclusive with environment grouping                                                                    |
| `chronologicalSort`   | `updated`                         | Sort field for `chronological`                                                                                                              |
| `sortDirection`       | `default`                         | `default`, `ascending`, or `descending`                                                                                                     |
| `sectionOrder`        | `["pinned","projects","threads"]` | Top-level order by project; `manualSectionOrder` and `machineSectionOrder` cover the other modes                                            |
| `hiddenGroups`        | `[]`                              | Groups moved into More: `threads`, `project:<id>`, `section:<id>`, `machine:<hostId>` (`machine:no-machine`); `set` replaces the whole list |
| `threadLifecycles`    | `["active"]`                      | `["active"]`, `["archived"]`, or both; empty and duplicate values are rejected                                                              |
| `rowActions`          | `["bb--core/archive"]`            | Up to three thread action keys in display order; see below                                                                                  |
| `showProviderIcons`   | `false`                           | Shows the provider icon before each thread title                                                                                            |
| `collapsed*`          | `[]`                              | Collapsed sections, projects, threads, environments, custom sections, and machines                                                          |

`rowActions` keys are `bb--core/<id>` (`split`, `newThreadInEnvironment`,
`copyLink`, `read`, `pin`, `rename`, `archive`, `delete`), `thread-list/move`,
or a plugin's `<pluginId>/<actionId>`. Bare legacy ids and `core/<id>` keys
migrate to current keys. A key whose action is hidden for a row, or whose
plugin is not installed, is skipped on that row.

### Connect and bb account

Remote access makes this server reachable at `https://<handle>.getbb.app` once
it is signed in to a getbb.app account. The builtin bb account plugin holds the
server credential in its plugin KV (in `bb.db`); the builtin connect plugin
holds the tunnel while the server runs. See the `bb-account` skill for signing
in and the `share-server-links` skill for `bb connect` and port shares.

| Connect setting          | Default | Effect                                                                                                                 |
| ------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------- |
| `remoteAccess`           | `true`  | The Remote access switch; `false` closes the tunnel and machine shares without signing out. Also `bb connect off\|on`. |
| `sendRemoteInstructions` | `true`  | "Tell agents about remote access"; `false` suppresses Connect's remote-use agent message without disabling sharing.    |

`bb plugin disable connect` cuts off all remote access. `--server` and
`--base-url` on `bb connect` and `bb account login` accept only
`https://getbb.app` and `https://vibecodethis.site` (plus
`http://bb.localhost:<port>` in a development build).

Settings → Mobile links the iOS TestFlight and Android APK downloads and pairs
the bb mobile app (`bb connect machine-code`, see `bb guide machines`). Mobile
builds, the optional `GOOGLE_SERVICES_JSON` Firebase config, and publishing
are documented in [`apps/mobile/README.md`](../apps/mobile/README.md).

### Connect next (beta)

The builtin connect-next plugin is disabled by default. Enabled
(`bb plugin enable bb--connect-next`) and switched on, it also makes this server
reachable at `https://<label>.next.getbb.app` through the Fly gate, next to
its connect address. The domain follows the bb account: `next.<host of the
account's base URL>` (`next.vibecodethis.site` on staging). While it is on,
every enrolled machine's daemon also serves the ports shared from it with
`bb connect expose <port> --host <machine>` at
`https://<machine-label>--<port>.next.getbb.app`, downloading `frpc` into
`<daemon data dir>/connect-next/frp/`. See the `connect-next` skill and
[`connect-next.md`](connect-next.md).

| Connect next setting | Default | Effect                                                                      |
| -------------------- | ------- | --------------------------------------------------------------------------- |
| `enabled`            | `true`  | "Reach this bb at its next address (beta)". Also `bb connect-next on\|off`. |

| Variable                 | Effect                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `BB_CONNECT_FRPC`        | Path of an `frpc` binary to run instead of the frp 0.71.0 release the plugin (or a host daemon) downloads and verifies.           |
| `BB_CONNECT_NEXT_SERVER` | `ws://host:port` or `wss://host:port` of the frp server to dial instead of `wss://tunnel.<next domain>` derived from the account. |

### Modal machines

The Modal sandbox plugin creates machines on Modal. Its settings:
`tokenId` and `tokenSecret` (secret; a Modal API token), `appName` (default
`bb-sandboxes`), and `idleMinutes` (default 15; `0` disables idle suspension,
maximum 1440). Sandboxes run for at most Modal's 24-hour sandbox lifetime.
Without a size preset, a new machine reserves 1 CPU and 2 GiB. The plugin page
also holds named image definitions (the bundled Standard Dockerfile, extra
Dockerfiles, or Modal image IDs) and CPU/memory presets; a saved image applies
to the next new machine. See the `modal-sandboxes` skill.

### Browser Automation

The Browser Automation plugin installs its pinned `dev-browser` release on
first use on each browser host, under the plugin's host storage directory; it
never modifies the user's global npm installation. See the
`browser-automation` skill and `plugins/browser-automation/README.md`. For
isolated development smoke tests only, `DEV_BROWSER_SMOKE_BINARY` and
`DEV_BROWSER_SMOKE_CHROME` select absolute binary and Chrome paths.

### MCP server

The bundled MCP server plugin is disabled by default; enable it with
`bb plugin enable bb--mcp`. It serves a Model Context Protocol endpoint at
`/mcp` on the bb connect address and at `/api/v1/plugins/bb--mcp/http/mcp` on
loopback (`bb mcp status` prints both). Remote apps sign in through the bb
account, and an approved app can run any `bb` command; `bb mcp clients` lists
them and `bb mcp revoke <grant-id>` disconnects one. The loopback address needs
no sign-in and has the same trust as the local `bb` CLI. See the `mcp` skill.

## Desktop browser cookie discovery

The desktop app discovers Chromium and Firefox cookie stores of registered web
browsers with no setting. On Linux, an absolute `XDG_CONFIG_HOME` in the
desktop process environment replaces `~/.config` for discovery (relative values
are ignored), and Flatpak and Snap data directories are also searched. See
`bb guide browser` for the import commands.

## Startup Flags

Use launcher flags for per-run startup details:

```bash
npx bb-app --data-dir ~/.bb-test --server-port 48886 --host-daemon-port 48887
```

The server listens on `127.0.0.1` by default. Set
`--server-bind-host 0.0.0.0` (or `BB_SERVER_BIND_HOST=0.0.0.0`) only when a
trusted network boundary must reach the listener directly: the public API is
unauthenticated and permits command execution and file reads. The only
accepted bind hosts are `127.0.0.1` and `0.0.0.0` (IPv4 only); containers must
also publish the port. With wildcard binding the startup `Server listening`
and `app` lines show `http://0.0.0.0:<port>`.

The data directory holds all bb-managed state: the SQLite database, logs, host
identity, thread storage, custom themes, and plugins. It defaults to `~/.bb/`
for the packaged app. Use `--data-dir` for fully isolated instances.

Other launcher flags: `--no-in-app-updates` ([In-App Updates](#in-app-updates))
and `--perf-diagnostics` ([Experiments](#experiments)).

## Source Development

`pnpm mobile:apk:dev` builds the standalone Android development app, **bb dev**,
with orange icons and package `app.getbb.mobile.dev`. Output is
`apps/mobile/build-output/bb-dev.apk`; append `-- x86_64` for an Intel emulator.
The build command sets `BB_MOBILE_VARIANT=dev` for Expo configuration. Direct
Expo commands accept `BB_MOBILE_VARIANT=production` (the default) or `dev`;
other values fail validation. The dev variant omits production Firebase and
HTTPS app-link registration. See [mobile build instructions](../apps/mobile/README.md#android-local-apk-and-verification).

For source development only, `pnpm dev`, `pnpm start:worktree`,
`pnpm start:worktree-remote`, and `pnpm start` load the repo-root
[dotenv-cli](https://github.com/entropitor/dotenv-cli) cascade. Add a repo-root
`.env` only to override the defaults above.

- `pnpm dev` loads `.env`, `.env.local`, `.env.development`, and
  `.env.development.local`, then overrides `BB_DATA_DIR`, the server URL and
  port, the host-daemon port, and the Vite port with values derived from the
  checkout path. The data directory is `~/.bb-dev/<checkout-instance>/`, where
  the instance id is the sanitized checkout path relative to your home
  directory plus a short hash. The server and Vite bind to loopback; an
  explicit `BB_DEV_APP_HOST` overrides the Vite listener, and remote HTTP dev
  through it also needs `BB_SERVER_BIND_HOST=0.0.0.0` for realtime updates.
  It defaults `BB_SKIP_ONBOARDING` to `1`, so new instances skip the first-run
  setup screen; set `BB_SKIP_ONBOARDING=0` to retain setup or replay it from Settings.
- `pnpm start:worktree` loads the same cascade and checkout-specific data
  directory and ports, builds production artifacts, and serves the bundle from
  the main server (no Vite or hot reload). Telemetry stays disabled and
  first-run setup is skipped, as with `pnpm dev`. Its data
  directory, ports, inherited skills, listener host, and telemetry policy take
  precedence over that instance's `config.json` or `env.json`.
- `pnpm start:worktree-remote` does the same but binds the main server to
  `0.0.0.0`; protect the port with a trusted network boundary.
- `pnpm start` loads `.env`, `.env.local`, `.env.production`, and
  `.env.production.local`, and uses the packaged launcher policy with build
  outputs from `apps/app`, `apps/server`, and `apps/host-daemon`.
- `--dryrun` on `pnpm start` or `pnpm start:worktree` prepares through Turbo,
  prints the resolved ports and paths, and exits without starting services or
  migrating data. See [Prepared Worktree
  Restarts](debugging-and-qa.md#prepared-worktree-restarts).

`pnpm dev` injects `BB_DEV_CONNECT_BASE_URL=http://bb.localhost:<worktree-cloud-port>`
(`pnpm dev --staging` injects `https://vibecodethis.site`). With
`NODE_ENV=development`, the bb account plugin uses it as the sign-in default
and the connect plugin for its signed-out dashboard link. It is
launcher-managed, not a `bb-app config` setting, and packaged builds keep
`https://getbb.app`.

`pnpm bb`, `pnpm bb:dev`, and `pnpm reset` wrap `@bb/scripts` and force
`NODE_ENV` to the intended mode. `pnpm reset` and `pnpm reset:dev` clear
bb-managed state in a data directory, not provider credentials.

`BB_PROVIDER_BRIDGE_RECORD_DIR=<dir>` in the host daemon's environment records
every provider bridge's wire traffic as NDJSON under
`<dir>/<providerId>/<threadId>/`; it is off by default and never reaches a
provider child. Recordings can contain secrets; redact them with
`scripts/provider-recordings/redact.mjs` before sharing. See
[provider-bridge-protocol.md](provider-bridge-protocol.md) and
[debugging-and-qa.md](debugging-and-qa.md).

App production builds cache React Compiler output at
`<git-common-dir>/bb-cache/react-compiler`; it has no configuration and can be
deleted while no build runs.

Desktop Settings → Server → **Show This Mac** (or **Show This Computer** off macOS)
defaults to checked and is disabled while This Mac/Computer is selected.
Unchecking hides the built-in server from server choices
while another server is active and alternatives exist. It stays listed when
active or when it is the only choice. This setting does not stop the local
runtime or change the active server.

The desktop stores `showBuiltinServer: false` in `<userData>/server-target.json`;
missing means shown, and saving the default omits the field. Other top-level
metadata is preserved. This is a desktop-local preference, with no server
settings CLI/SDK endpoint. Builds with tolerant readers ignore the field and
may drop it on save; older strict readers can reject the whole file, so keep a
backup before rolling back to a build predating the tolerant-reader fix #5286.
