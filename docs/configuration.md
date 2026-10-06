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
- `BB_LOG_LEVEL`, `BB_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD`,
  `BB_MARKETPLACE_URL`, `BB_PERF_DIAGNOSTICS`, `BB_POSTHOG_API_KEY`, and
  `BB_TELEMETRY`
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
`bb-app start` on it runs with in-app updates off. A server the desktop app
starts updates with the desktop app; `pnpm dev`, `bb-server`, and a standalone
`bb-host-daemon` do not offer in-app updates. `BB_APP_UPDATE_MODE`,
`BB_APP_INSTALL_KIND`, `BB_APP_SOURCE_ORIGIN`, and `BB_APP_SOURCE_COMMIT` are
internal markers the launcher passes to its server child; do not set them. See
`bb guide machines` for the `bb updates` commands.

## Common Keys

| Key                            | Set with                                           | When to set             | Used for                                                                                                                                                                                                                     |
| ------------------------------ | -------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BB_APP_URL`                   | `bb-app config`                                    | Optional for remote use | Human-facing app URL used for generated links, allowed browser origins, and the allowed DNS hostname for requests. Leave empty for local-only use. Live when set with `bb-app config`.                                       |
| `BB_EXTERNAL_URL`              | `bb-app env`, or environment                       | Startup-only            | Internet-facing HTTPS base URL for generated public links; the fallback for `machineServerUrl`.                                                                                                                              |
| `BB_MARKETPLACE_URL`           | `bb-app env`, or environment                       | Startup-only testing    | Manifest URL of the reserved `bb-community` marketplace. Default `https://getbb.app/marketplace/v2/marketplace.json` (falls back to v1 on 404); a custom URL is requested without fallback. Changes only `bb-community`.     |
| `BB_SERVER_URL`                | `bb-app config`                                    | Remote CLI/host use     | Server targeted by the standalone `bb` CLI and `host-daemon` commands on this machine. Defaults to `http://127.0.0.1:38886`. It does not change where `npx bb-app` binds.                                                    |
| `BB_SERVER_BIND_HOST`          | `bb-app env`, environment, or `--server-bind-host` | Startup-only            | Server listener host: `127.0.0.1` (default) or `0.0.0.0`. Not a `bb-app config` key. See [Startup Flags](#startup-flags).                                                                                                    |
| `BB_SERVER_PORT`               | `bb-app env`, environment, or `--server-port`      | Startup-only            | HTTP listener port. Defaults to `38886`.                                                                                                                                                                                     |
| `BB_HOST_DAEMON_PORT`          | `bb-app env`, environment, or `--host-daemon-port` | Startup-only            | Local host-daemon API port. Defaults to `38887`.                                                                                                                                                                             |
| `BB_LOG_LEVEL`                 | `bb-app config`                                    | Startup-only debugging  | `trace`, `debug`, `info`, `warn`, `error`, or `fatal`.                                                                                                                                                                       |
| `BB_TELEMETRY`                 | `bb-app env`, or environment                       | Startup-only            | `false` always disables anonymous usage telemetry, overriding the `telemetryEnabled` setting.                                                                                                                                |
| `BB_PERF_DIAGNOSTICS`          | `bb-app env`, environment, or `--perf-diagnostics` | Startup-only            | Default false. Permits the `performanceDiagnostics` experiment; see [Experiments](#experiments).                                                                                                                             |
| `BB_CLI_ERROR_LOG`             | Environment of the `bb` process                    | Optional                | `0` stops the CLI recording failed invocations (command path, error code, no argument values) to `<dataDir>/logs/cli-errors.jsonl`. See `bb guide overview`.                                                                 |
| `BB_ACCOUNT_POOL_PARENT_URL`   | Set automatically by a parent bb server            | Nested bb servers       | Account Pooler hub of the bb server whose thread launched this one. When present the Account Pooler plugin is enabled on first run and proxies to that parent; `bb pool parent isolate` opts out. Not a `bb-app config` key. |
| `BB_ACCOUNT_POOL_PARENT_TOKEN` | Set automatically by a parent bb server            | Nested bb servers       | Machine token this nested server presents to the parent hub. Both parent variables must be well formed or proxying stays off.                                                                                                |

BB accepts request hosts that are `localhost`, IP addresses (including LAN and
Tailscale IPs), or the hostname in `BB_APP_URL`. For a custom DNS name or
reverse proxy, set `BB_APP_URL` (for example `https://bb.example.com`) before
connecting, including from the CLI or SDK; a matching `Host`/`Origin` or
`X-Forwarded-Host` cannot authorize an unconfigured name. A proxy can preserve
the configured host or forward to localhost. bb connect needs no additional
configuration.

## General settings

Server-wide preferences, stored in the bb database and applied live to every
client. Set them in Settings, with `bb settings general <key> <value>`, or with
SDK `system.updateGeneralSettings`. See `bb guide customization` for the
command surface.

| Key                                                                        | Default                             | Effect                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `showDiagnosticEvents`                                                     | `false`                             | Settings → General → Privacy & diagnostics. Shows provider environment resolution and unhandled raw provider events in the timeline. Warnings, errors, and model fallback stay visible. Hidden diagnostics do not count toward timeline limits.                        |
| `steerActiveThreadOnEnter`                                                 | `true`                              | Settings → General. `true` ("Steer"): Enter steers a running thread and Mod+Enter queues; `false` ("Queue") swaps them. Installs that predate the setting were migrated to `false`. Shift+Enter always inserts a newline.                                              |
| `confirmThreadArchive`                                                     | `true`                              | Settings → General. `false` archives a thread and its children in the app without a confirmation popup; the toast still offers Undo. CLI and SDK archives never prompt.                                                                                                |
| `streamerMode`                                                             | `false`                             | Settings → General. Hides every `customModels` entry from pickers, `bb provider models`, and `sdk.providers.models`. Threads that name a hidden model still run; a composer whose stored selection is hidden falls back to the provider default.                       |
| `allowFastServiceTier`                                                     | `true`                              | Settings → Providers. `false` hides the service tier control and runs every new turn, including automations and queued messages, at the default tier. Project defaults saved while off keep the default tier.                                                          |
| `managedBranchPrefix`                                                      | `bb/`                               | Settings → General → New branch prefix. Prefix for branches bb creates for worktrees and new checkout branches (`bb/fix-login-flow-thr_ab12cd34ef`); empty for none. At most 64 characters and must start a valid git branch name. Existing branches keep their names. |
| `providerOrder`                                                            | `[]`                                | Settings → Providers. JSON list of provider ids that lead the picker; unlisted ids follow in plugin install order and unknown ids are ignored.                                                                                                                         |
| `defaultProviderId`                                                        | `null`                              | Settings → Providers. Provider for new threads when neither caller nor project chose one; `null` means the first available provider in picker order.                                                                                                                   |
| `telemetryEnabled`                                                         | `true`                              | Settings → General → Privacy & diagnostics → Share anonymous usage data. Takes effect immediately; `BB_TELEMETRY=false` overrides it.                                                                                                                                  |
| `machineServerUrl`, `defaultMachineAccess`, `machineGitCredentialsEnabled` | See [Multi-machine](#multi-machine) | Machine access and credential forwarding.                                                                                                                                                                                                                              |

The general-settings API still accepts and returns `showUnhandledProviderEvents`
as a deprecated alias of `showDiagnosticEvents`; when a payload contains
conflicting values, the one changed from the saved setting wins.

**Completed turn display.** `providerCompletedTurnDisplay` maps provider id to
`collapse` (finished work folds into one "Worked for" row) or `flat` (every
step stays visible). A provider without an entry uses its registration's
`completedTurnDisplay` default: Claude Code is `flat`, other first-party
providers `collapse`. It applies to existing threads, the outline, and
`bb thread log`. Set it in Settings → Providers or with
`bb settings completed-turns <provider-id> <collapse|flat|default>`.

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

bb accepts voice recordings up to 25 MB; Codex transcribes up to 20 MB and bb
cloud up to 10 MB. With a ChatGPT subscription login, Codex transcription can
be blocked by Cloudflare bot protection on some networks; run
`codex login --with-api-key` on the primary machine or pick another voice
service.

bb accepts voice recordings up to 25 MB. A service may set a lower limit;
Codex transcribes recordings up to 20 MB and bb cloud up to 10 MB.

Open microphone preferences by right-clicking the composer microphone or pressing
Shift+F10 while it is focused. A warning opens preferences when the microphone
is clicked. Desktop uses an anchored popover; mobile uses a drawer. Opening
preferences starts a local microphone preview with the recording waveform and
a list of inputs. Closing preferences releases the preview. The recording controls
contain only cancel, stop, and send; microphone preferences are available while idle.

Recording tries the preferred device, then the system default, then other
available inputs for missing or unreadable devices. Permission denials do not
trigger fallback. A disconnect during recording switches the input into the
same recorder, preserving audio captured before the disconnect. Reconnecting
the preferred microphone makes it available for the next recording; it does not
interrupt the current fallback recording.

A missing preferred microphone alone does not block recording or show a warning.
Capture failures, interrupted input, or no available inputs after access was
granted show a decorative warning badge on the idle microphone. During capture,
five seconds of near-silent audio produces a warning in the open preview or an
accessible status in the recording row; the recording row has no microphone menu. Silence warnings clear when audio returns and never
stop recording or switch microphones automatically. While idle, a warning opens
preferences on click. Audio preview runs only while microphone preferences are
open; it is not saved or transcribed.

The microphone picker in Settings → Voice Input is client-local. It stores the
selected browser `MediaDevices` device id in localStorage as
`bb.voiceInput.audioInputDeviceId`. Recording prefers that microphone and falls
back to the system default and other available inputs when it is disconnected,
then uses the saved preference again when it reconnects. Select System default to follow system
microphone changes; it does not change which service
transcribes.

The built-in Push notifications plugin uses `expoPushUrl` for its relay URL.
The default is `https://exp.host/--/api/v2/push/send`. Change it with
`bb plugin config push-notifications set expoPushUrl <url>`. The plugin reads
the value when it sends a message. Independent `mobileEnabled`, `webEnabled`,
and `desktopEnabled` booleans default to true. Change each with
`bb plugin config push-notifications set webEnabled false` (or the other
channel key). Web and desktop clients receive system notifications while a bb
tab or window remains open; browsers require HTTPS or localhost and per-device
notification permission. Settings → Push notifications offers permission and
test controls. `bb push-notifications test <web|desktop>` broadcasts a test to
connected, permitted clients; it does not confirm OS display.

The builtin Keep Awake plugin has one autosaving configuration page with an
enable switch and an all-or-selected host picker. On selected macOS hosts it
runs `/usr/bin/caffeinate -i -w <worker-pid>` while enabled, preventing system
idle sleep while bb is running. It only blocks idle sleep: closing a laptop lid
or choosing Sleep manually still sleeps the Mac. Configure it from an agent or
terminal with:

```sh
bb keep-awake status [--json]
bb keep-awake enable [--json]
bb keep-awake disable [--json]
bb keep-awake hosts all
bb keep-awake hosts <host-id>...
```

The builtin Concurrency limit plugin has an autosaving page under Plugins →
Installed plugins. Its overall limit is unlimited by default. Each host defaults to
Auto: one thread per available processor. A blank host field restores
Auto, and 0 pauses new work for that scope. Configure it from an agent or
terminal with:

```sh
bb concurrency-limit status [--json]
bb concurrency-limit global [unlimited|<limit>] [--json]
bb concurrency-limit host <host-id> [auto|<limit>] [--json]
```

The "Show diagnostic events" toggle in Settings → General → Privacy & diagnostics shows provider
environment resolution and raw provider events that bb does not yet understand.
It defaults to off in all builds. Warnings, errors, and model fallback remain
visible. An existing unhandled-provider-events preference is preserved.
Set it with `bb settings general showDiagnosticEvents <true|false>` or
`bb.sdk.system.updateGeneralSettings` using the `showDiagnosticEvents` field.
For older SDK callers, the general-settings API still accepts and returns
`showUnhandledProviderEvents` as a deprecated alias. Both names control the same
setting. When a read-modify-write payload contains conflicting values, the
value changed from the saved setting wins. Hidden diagnostics do not count
toward timeline event or byte limits.

The prompt box uses plain-text editing. Markdown delimiters remain visible while
editing.

The "Default thread followup behavior" picker in Settings → General changes the
active-thread composer shortcuts when no typeahead suggestion is active. A
queued message waits and then runs when the agent stops. A steer message goes
to the agent during the current run. The picker defaults to "Steer" for a new
install: Enter steers and Command+Enter queues. "Queue" swaps them: Enter
queues and Command+Enter steers. Ctrl+Enter is the same modifier shortcut on
Windows and Linux. An earlier install with saved settings or work
keeps "Queue" because a one-time migration stamps the old default onto it. Set
it with
`bb settings general steerActiveThreadOnEnter <true|false>`, where `true` is
"Steer".

The "Show Git changes and Commit button" switch in Settings → General defaults to on.
Turn it off to hide the untracked, uncommitted, and committed file summary and
expanded file list above every thread composer, plus the Commit action in the
thread header and overflow menu. PR status, thread relationships,
and workspace warnings remain visible. This server-wide preference persists
across reloads and applies to every connected app client. Set it with
`bb settings general showGitChanges false` or read the current config and call
`sdk.system.updateGeneralSettings({ ...config.generalSettings, showGitChanges: false })`.
Older clients that omit the field preserve the saved value.

The "Thread archive confirmation" switch in Settings → General defaults to on.
Turn it off to archive a thread and its child threads immediately without a
confirmation popup. The archive toast still offers Undo. This server-wide
preference applies to all connected app clients. Set it with
`bb settings general confirmThreadArchive false` or
`bb.sdk.system.updateGeneralSettings` using `confirmThreadArchive`.
CLI and SDK archive operations remain non-interactive.

The "Streamer mode" toggle in Settings → General hides every `customModels`
entry from `~/.bb/config.json` in all model lists: the web and mobile pickers,
`bb provider models`, and `sdk.providers.models`. Turn it on before a screen
share so a private or early-access model id does not appear. It defaults to
off. The entries stay in `config.json`, and a thread that names a hidden model
explicitly still runs with it. Default model resolution for a new thread also
keeps the full list, so a provider whose only models are custom still starts.
A composer whose stored selection is a hidden model treats it as unavailable
and falls back to the provider default; the next send records that default, so
select the custom model again after you turn streamer mode off. Set it with
`bb settings general streamerMode <true|false>`.

The "Allow faster service tiers" switch in Settings → Providers defaults to on.
Turn it off with `bb settings general allowFastServiceTier false` or
`bb.sdk.system.updateGeneralSettings`. While off, new turns use the default
service tier, including explicit requests for another tier (`fast`, Codex
`ultrafast`, or any other tier a provider lists), automations, and previously
queued messages. The app hides the service tier control. Turn the setting on to
choose a faster tier again; completed turns and project defaults saved while it
was off retain the default tier.

The "New branch prefix" field in Settings → General sets the text bb
puts in front of every branch name it creates for a managed worktree or a new
checkout branch. It defaults to `bb/`, which produces
`bb/fix-login-flow-thr_ab12cd34ef`. Change it to `sawyer/` to group your branches
under your own namespace, or clear the field to create
`fix-login-flow-thr_ab12cd34ef` with no prefix. bb rejects a prefix that cannot
start a valid git branch name, such as one with a space or a leading `-`, and
the prefix is at most 64 characters. The prefix applies to branches bb creates
after you change it; it does not rename an existing branch or worktree. Set it
with `bb settings general managedBranchPrefix <prefix>`.

Settings → Providers lists every registered agent provider in picker order.
Move a provider up or down to change the order and choose the default for new
threads. Both are persisted preferences: `providerOrder` is the list of ids
that lead the picker (ids not listed follow in plugin install order, and an id
that names no registered provider is ignored) and `defaultProviderId` is the
provider new threads use when neither the caller nor the project chose one
(`null` means the first available provider in picker order). Set them with
`bb settings general providerOrder '["claude-code","codex"]'` and
`bb settings general defaultProviderId claude-code` (or `null`).

The "Collapse finished turns" switches in Settings → Providers choose, per
provider, how a finished turn appears in the thread timeline. Collapsed, the
turn's work folds into one "Worked for" row and the final answer stays
visible. Flat, every step of the finished turn stays visible, as it was while
the turn ran. Each provider declares its default (`completedTurnDisplay` on
its registration): Claude Code defaults to flat, and every other first-party
provider defaults to collapsed. Your choice is stored in
`providerCompletedTurnDisplay`, a map of provider id to `collapse` or `flat`;
a provider without an entry uses its default. The display applies to existing
threads as well as new ones, and to the conversation outline and
`bb thread log`. Set it with
`bb settings completed-turns <provider-id> <collapse|flat|default>`, where
`default` removes your entry, and list every provider's current display with
`bb settings completed-turns`.

Each provider's own options live on its plugin: Codex memory and native
subagents under the Codex provider plugin, and Claude Code memory, native
subagents, and the Workflow tool under the Claude Code provider plugin.

Claude Code's **Disable 1M context** provider setting (`disable1MContext`)
defaults to `false`. Enable it with
`bb plugin config provider-claude-code set disable1MContext true`.
bb sets `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` when enabled and `0` when off.
Changes restart the thread's Claude process before its next turn, preserving
conversation context.

Claude Code starts without its Claude in Chrome browser tools when bb runs it,
even when the interactive `claude` CLI has Chrome enabled by default. Turn the
tools on for bb threads with
`bb plugin config provider-claude-code set chromeEnabled true`. bb then starts
Claude Code with `--chrome`. The host needs the Claude in Chrome extension and a
claude.ai login; API-key sessions keep Chrome off. A change restarts the thread's
Claude process before its next turn and keeps the conversation.

In Accept Edits and Approve for me modes, bb runs Claude Code's Bash commands in
Claude Code's sandbox. Turn it off with
`bb plugin config provider-claude-code set sandboxEnabled false`. Bash commands
then go through Claude Code's normal approvals and your own Claude Code
permission and sandbox settings. A change restarts the thread's Claude process
before its next turn and keeps the conversation.

Outside an open typeahead menu, Shift+Enter inserts a newline. On
coarse-pointer touch devices, the software-keyboard Return path inserts a
newline and the submit button sends.
iPadOS WebKit additionally preserves the Enter and Command+Enter shortcuts
above for a connected Magic Keyboard.

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

| Area      | Command                                      | Default                     | Availability             |
| --------- | -------------------------------------------- | --------------------------- | ------------------------ |
| Palette   | Quick palette                                | `Mod+Shift+P`               | All clients              |
| Window    | Back to app (from Settings, Plugins, Skills) | `Escape`                    | All clients              |
| Threads   | New thread                                   | `Mod+N` / `Mod+Shift+O`     | Desktop / web            |
| Threads   | Search threads                               | `Mod+K`                     | All clients              |
| Threads   | Rename focused thread                        | Unassigned                  | Thread view              |
| Threads   | Archive focused thread                       | Unassigned                  | Thread view              |
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
| Window    | Open server and daemon logs                  | Unassigned                  | macOS desktop            |
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
| Pi           | `~/.pi/agent/skills`, `~/.agents/skills`                                                                 | `.pi/skills` and `.agents/skills` from the repository root to the current directory                          |
| Cursor       | `~/.cursor/skills`, `~/.agents/skills`, `~/.claude/skills`, `~/.codex/skills`                            | The same four roots in the workspace                                                                         |
| OpenCode     | `~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills`                                      | `.opencode/skills`, `.claude/skills`, and `.agents/skills` from the repository root to the current directory |
| omp          | The active `~/.omp/.../agent` roots and supported Pi, Agents, Claude, Codex, and OpenCode roots          | `.omp/skills` and the supported compatibility roots from the repository root to the current directory        |
| Grok Build   | `$GROK_HOME/skills` or `~/.grok/skills`, plus `~/.agents/skills`, `~/.claude/skills`, `~/.cursor/skills` | The same four roots from the repository root to the current directory                                        |
| Hermes Agent | `$HERMES_HOME/skills` or `~/.hermes/skills`                                                              | None                                                                                                         |

OpenCode also uses `$OPENCODE_CONFIG_DIR/skills`. Pi and omp use
`$PI_CODING_AGENT_DIR`; omp selects its profile with `$OMP_PROFILE` or
`$PI_PROFILE`. Cursor and Hermes roots are scanned recursively. Pi settings
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
host keeps its local Git authentication. An explicit global or project
`GH_TOKEN` overrides the built-in token. Changes apply to new turns, setup
commands, and terminals.

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
| `sidebar.navigationProvider`  | Plugin key or `__automatic__` (default): an installed navigation plugin wins over the bundled `navigation/navigation`                                  |
| `sidebar.headerProvider`      | Plugin key, or `__builtin__` (default) for bb's header controls only                                                                                   |
| `sidebar.pluginPanelOrder`    | Navigation entry order                                                                                                                                 |
| `sidebar.visiblePluginPanels` | Navigation entries shown, or `null` for every entry                                                                                                    |
| `sidebar.footerOrder`         | Footer action order                                                                                                                                    |
| `sidebar.hiddenFooterItems`   | Footer actions moved into More                                                                                                                         |
| `infoPanel.collapsedSections` | Collapsed thread Info panel sections (`commits`, `uncommittedChanges`, `forks`, `threadStorage`)                                                       |

Legacy `__builtin__` thread list and navigation selections resolve to the
bundled plugin. Footer IDs are `builtin:settings`, `builtin:report-bug`, and
`plugin:<encoded pluginId>/<encoded registrationId>`; unknown and
disabled-plugin IDs are retained, and new actions default to visible. The
footer can also be edited from its More menu or Settings → Appearance → Sidebar
footer.

The layout keys `sidebar.organizationMode`, `sidebar.threadGrouping.environment`,
`sidebar.chronologicalSort`, `sidebar.sortDirection`, the three section-order
keys, `sidebar.hiddenGroups`, and the `sidebar.collapsed*` keys are legacy: the
bundled Thread list plugin copies non-default values once and then keeps its
own preferences ([Thread list plugin](#thread-list-plugin)).

Sidebar width and open state stay in each browser tab or desktop window; a new
window starts from the most recent choice in that browser. The command
palette's Active/Archived filter is browser-local and has no CLI/SDK setting.

## Experiments

Experimental surfaces are changed in Settings → Experiments or with
`bb settings experiment <key> <true|false>`. All experiments start off.
bb stores only the experiments you set; the others follow the shipped default.
The default-off `changelogPreview` experiment shows the latest release notes
as a compact, dismissible card on Settings → Updates.
The default-off `navigationRail` experiment keeps a vertical rail of
destinations on the left edge of the sidebar on every screen. Home returns to
the last thread, Settings sits at the bottom, and New thread moves into the
sidebar header. The sidebar beside the rail still swaps between the thread
list, Plugins, Skills, and Settings. While it is on, bb draws the navigation
itself, so the Navigation and Header choices under Settings → Appearance are
not used; they apply again when the experiment is turned off. Narrow windows
and phones keep the regular drawer.

- `changelogPreview` shows the latest release notes as a dismissible card on
  Settings → Updates.
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
marketplace comes from `BB_MARKETPLACE_URL`. The server checks installed
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

| Setting            | Default | Effect                                                                                                                                         |
| ------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `disable1MContext` | `false` | Sets `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` (`0` when off).                                                                                        |
| `chromeEnabled`    | `false` | Starts Claude Code with `--chrome` for Claude in Chrome tools; the host needs the extension and a claude.ai login (API-key sessions stay off). |
| `sandboxEnabled`   | `true`  | Runs Bash in Claude Code's sandbox in Accept Edits and Approve for me modes; `false` uses Claude Code's own approvals and sandbox settings.    |

Set them with `bb plugin config provider-claude-code set <key> <value>`. A
change restarts the thread's Claude process before its next turn, keeping the
conversation. Memory, native subagents, and the Workflow tool are toggled on
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
processor), and `0` pauses new work for that scope. Configure it on its plugin
page or with `bb concurrency-limit global|host`; see the `concurrency-limit`
skill.

### Keep Awake

The builtin Keep Awake plugin prevents idle system sleep on selected macOS and
Windows hosts while bb runs (closing the lid still sleeps). Its settings are an
enable switch and an all-or-selected host list, set on its plugin page or with
`bb keep-awake enable|disable` and `bb keep-awake hosts all|<host-id>...`.

### Push notifications

The builtin Push notifications plugin's `mobileEnabled`, `webEnabled`, and
`desktopEnabled` booleans default to `true`. `expoPushUrl` (default
`https://exp.host/--/api/v2/push/send`) is the relay URL, read on every send.
Web and desktop notifications need an open bb tab or window, HTTPS or
localhost, and per-device permission. See the `push-notifications` skill.

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
row's Customize row actions, or `bb thread-list prefs get|set|reset <key>`
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
| `rowActions`          | `["archive"]`                     | Up to three of `split`, `copyLink`, `read`, `pin`, `move`, `rename`, `archive`, in display order                                            |
| `showProviderIcons`   | `false`                           | Shows the provider icon before each thread title                                                                                            |
| `collapsed*`          | `[]`                              | Collapsed sections, projects, threads, environments, custom sections, and machines                                                          |

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
- `pnpm start:worktree` loads the same cascade and checkout-specific data
  directory and ports, builds production artifacts, and serves the bundle from
  the main server (no Vite or hot reload). Telemetry stays disabled. Its data
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
