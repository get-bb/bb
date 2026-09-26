---
kind: instruction
title: bb Guide — Customization
summary: Command reference for customizing the bb app color palette, typography, keyboard shortcuts, and mobile push notifications.
intent: Explain the CLI theme surface, server-backed app customization, and push-notification device registration.
editingNotes: Keep flags accurate against the CLI implementation. Theme details live in the bb-cli skill's references/theming.md.
---
Customization commands

Theming — the app-wide palette and typography

`bb theme` controls a set of CSS-variable overrides for the app palette and
typography, persisted server-side and applied live to every open window.
Light/dark mode is a separate per-client setting the theme layers on top of.
Custom themes live on
disk, one folder per theme, at <bb-data-dir>/theme/<name>/theme.css (the packaged
app uses ~/.bb/theme/…). The folder name is the theme id.

  bb theme list                  Built-in and custom themes; shows the active one
  bb theme dir                   Print the custom-theme directory (where to author)
  bb theme set <id> [--favicon-color <color>]
                                 Activate a theme, preserving the favicon color
                                 unless the flag supplies the complete selection
  bb theme show [id] [--css]     Print the active palette, or resolve <id> without
                                 activating it; --css dumps the CSS
  bb theme reset                 Back to the default theme; preserve favicon color
  bb theme favicon set <color>   Set favicon color; preserve the active theme
  bb theme favicon reset         Reset favicon color; preserve the active theme

To author a custom theme, run `bb theme dir`, write <that-dir>/<name>/theme.css,
then `bb theme set <name>`. Optional `pierre-dark.json` / `pierre-light.json`
(or a `theme.json` `codeTheme` field) ship the matching code colors. Built-in
palettes use the matching Shiki pair. The full design-token reference is in
the bb-cli skill (references/theming.md).

Theme CSS can override typography as well as colors. `--font-terminal` controls
the integrated terminal's font family independently of `--font-mono`; set it in
the theme's `:root, .light` block and end the stack with a generic fallback.

Favicon colors are `default`, `red`, `orange`, `yellow`, `green`, `teal`,
`blue`, `purple`, and `pink`. Theme and favicon-only commands carry the other
appearance value forward explicitly.

Hovering a palette in Settings → Appearance previews it live in that window
without saving; `bb theme show <id>` is the CLI counterpart.

Add --json to any theme command for machine-readable output.

Packaged launcher settings

`bb-app config` and `bb-app env` reload runtime settings in a running server,
but the CLI identifies server and launcher settings that are startup-only,
including binding/ports, data and the dev-app port, telemetry, inherited skill
roots, and `BB_FF_*` flags. `BB_LOG_LEVEL` is also startup-only. Use
`bb-app config`, not `bb-app env`, to change `BB_APP_URL` live. After a
startup-only change, run `bb-app stop && bb-app start` or restart the desktop
app. Until then, changing or unsetting `BB_SERVER_BIND_HOST` does not close a
previous `0.0.0.0` listener.

With `--server-bind-host 0.0.0.0`, the startup listener and `app` rows show
`http://0.0.0.0:<port>`. Health checks and the colocated daemon still connect
through loopback; this does not narrow the IPv4 wildcard listener. Containers
must also publish the port to the host.

Thread titles, commit messages, and voice transcripts come from AI services
that plugins register, chosen per task with `bb settings ai-services` (see
Server-backed General settings below). `BB_INFERENCE`,
`BB_INFERENCE_FALLBACK`, and `BB_TRANSCRIPTION` were removed: bb ignores them
in `~/.bb/config.json` with a warning, and `bb-app config set` refuses them.

Server-backed General settings

Settings → General includes app-wide preferences stored server-side so every
window and restart sees the same value. Keep Awake is instead owned by its
builtin plugin: use its autosaving page under Settings → Installed plugins or run
`bb keep-awake enable` or `bb keep-awake disable`. Choose every host with `bb
keep-awake hosts all`, or name individual host ids after `bb keep-awake hosts`.
On macOS it prevents system idle sleep while bb is running; closing the lid or
choosing Sleep still sleeps the Mac.

Concurrency limit is also owned by its builtin plugin. Its autosaving page
under Settings → Installed plugins leaves the overall limit unlimited by default and
uses an automatic per-host limit of one thread per available processor. Use
`bb concurrency-limit global [unlimited|<limit>]` and `bb
concurrency-limit host <host-id> [auto|<limit>]`; 0 pauses new work.

The sidebar thread list is owned by the Thread list builtin plugin. Its
layout preferences (active/archived filter, organization mode, sort, section order, hidden and
collapsed groups) live in the plugin and sync to every window:
`bb thread-list prefs list [--json]`, `prefs get <key>`,
`prefs set <key> <value>`, and `prefs reset <key>`. `set` takes JSON; a bare
word is a string. On first load the plugin copies non-default `sidebar.*`
values from `bb settings ui` once. `showProviderIcons` defaults to `false`;
Organize → Rows → Provider icons toggles the icon before each title, and
`bb thread-list prefs set showProviderIcons true` turns it on from the CLI.
The `threadLifecycles` preference defaults
to `["active"]`; `bb thread-list prefs set threadLifecycles '["archived"]'`
shows archived threads, and `'["active","archived"]'` shows both.

The sidebar navigation rows (New thread, Search, Plugins, Skills, plugin
panels) are drawn by the Navigation builtin plugin. Their order and
visibility are `bb settings ui` keys (`sidebar.pluginPanelOrder`,
`sidebar.visiblePluginPanels`), shared by any navigation plugin chosen with
`sidebar.navigationProvider`. `sidebar.headerProvider` picks a plugin that
draws controls beside the sidebar toggle; it defaults to `__builtin__`.

Settings → Keyboard also includes `showKeyboardHints`, which defaults to true.
Turn it off to hide the delayed shortcut badges shown while holding Command or
Control on macOS, or Control on Windows/Linux. Shortcut commands continue to
work.

Settings → General includes `showDiagnosticEvents`, which defaults to false
in all builds. Turn it on to show provider environment resolution and unhandled
provider events. Warnings, errors, and model fallback stay visible. Existing
unhandled-event preferences are preserved. Set it with
`bb settings general showDiagnosticEvents <true|false>`.

Settings → General also includes `steerActiveThreadOnEnter`, which defaults to
true for a new install. An earlier install with saved settings or work keeps
false. Outside an open typeahead menu, enabling it makes Enter steer a running
thread and Command+Enter queue a follow-up; when disabled, those actions are
reversed. Shift+Enter inserts a newline. On coarse-pointer touch devices, the
software-keyboard Return path inserts a newline. iPadOS WebKit preserves these
Enter shortcuts for a connected Magic Keyboard.

Settings → General also includes `streamerMode`, which defaults to false. Turn
it on to hide every `customModels` entry from `~/.bb/config.json` in all model
lists (pickers, `bb provider models`, and the SDK) during a screen share. The
entries stay in the config file.

Settings → Providers includes `allowFastServiceTier`, which defaults to true.
Set it to false with `bb settings general allowFastServiceTier false` to hide
Fast mode and run new turns at the default service tier. This also applies to
explicit fast requests, saved project defaults, automations, and messages queued
before the setting changed. Turn it back on to choose fast again; project
defaults saved while it was off retain the default tier.

Settings → General includes `managedBranchPrefix`, which defaults to
`bb/`. bb puts it in front of every branch name it creates for a worktree, so
the default gives `bb/fix-login-flow-thr_ab12cd34ef`. Set `sawyer/wt-` to get
`sawyer/wt-fix-login-flow-thr_ab12cd34ef`, or clear it for no prefix. bb rejects
a prefix that cannot start a valid git branch name. The new prefix applies to
branches bb creates after the change.

  bb settings show
  bb settings ai-services
  bb settings ai-services set <thread-title|commit-message|voice> <automatic|off|service-id> [--plugin <plugin-id>]
  bb settings ai-services test <thread-title|commit-message>
  bb settings general <key> <value>
  bb settings completed-turns [provider-id] [collapse|flat|default]
  bb settings experiment <key> <value>
  bb settings usage [--machine <id-or-name>]
  bb settings version [--force]
  bb settings reload

`bb settings ai-services` shows which AI service writes thread titles (and so
branch names), commit messages, and voice transcripts, plus every service a
plugin registers and whether it is ready. `set` picks `automatic` (the services
bb ships, in order: Codex, then bb cloud), `off`, or one service id; a picked
service is never swapped for another. A service is identified by its plugin
and its id, so two plugins may use the same id; pass `--plugin <plugin-id>`
when they do. `test` runs a sample title or commit message through the current
choice. Settings → AI services has the same controls. Each plugin chooses its
own model.

`bb settings general` accepts any key from `generalSettings` in
`bb settings show`. Boolean preferences take `true`, `false`, `on`, or `off`,
and `null` clears a preference that can be unset.

`bb settings completed-turns` lists how each provider shows a finished turn:
`collapse` folds the turn's work into one "Worked for" row and keeps the final
answer visible, and `flat` keeps every step visible. Each provider has a
default (Claude Code is `flat`, the other first-party providers `collapse`).
`bb settings completed-turns <provider-id> <collapse|flat>` overrides it for
that provider, and `default` removes the override. Settings → Providers has
the same per-provider switch.

The default-off `changelogPreview` experiment shows the latest release notes
as a compact, dismissible card on Settings → Updates.
The default-off `legacyJitiPluginLoader` experiment restores the previous JITI
loader the next time a plugin loads. Toggling it does not disturb running
plugin instances. Enable it with
`bb settings experiment legacyJitiPluginLoader true`.
Message editing is available for eligible, accepted
root user messages in Codex, Claude Code, and Pi threads, including failed or
incomplete turns. Opening the editor is
client-local; submitting stops and settles a running thread, then replaces the
selected turn and all later conversation history while retaining workspace side
effects. Grouped multi-message requests are not yet editable.

BB releases restorable provider sessions after 30 idle minutes. The daemon
checks for these sessions every five minutes. Active turns, commands, agents,
workflows, and monitors keep their sessions loaded.

The default-off `sidebarProgressiveDisclosure` experiment shows the first five
groups in the current sort order in **By project** and **By machine**, keeps
attention groups visible, and reveals ten more per **Show more** click. Revealed
groups stay visible through activity and sort-order changes.
**Manually** is unchanged. Enable it with `bb settings experiment
sidebarProgressiveDisclosure true`.

The default-off `serverMove` experiment enables Move server here in Settings →
Machines and the server-backed `bb server move` and `bb server export`
commands. Enable it with `bb settings experiment serverMove true`.

Long timelines and large expanded timeline details mount only nearby rows.

Thread timeline pages select complete conversation groups using
`BB_FF_TIMELINE_WINDOW_EVENT_BUDGET` (default 1500) as a selection budget.
Oversized groups paginate their contents with stable summary identities.
Grouping can load more than the budget to preserve lifecycle and delegation
context; it is not a hard CPU or memory cap. Older activity loads on scroll.
A walk keeps its initial history snapshot. Edits invalidate it, and a new live
snapshot can require loading older pages again.

Server-backed keyboard shortcuts

Settings → Keyboard records per-command shortcut overrides. They are persisted
server-side, applied live to every connected window, and survive restarts.
Reset removes an override and returns to bb's current default; Clear explicitly
disables a command. `Mod` means Command on macOS and Control on Windows/Linux.
Bindings for non-native actions apply in browser and desktop clients. Command
contexts and native-only availability remain server-owned, and desktop menu
accelerators for New Thread, New Window, New Tab, Close, and Settings use the
same resolved bindings. The complete default table is in docs/configuration.md.

  bb settings keyboard list
  bb settings keyboard hints <true|false>
  bb settings keyboard set <command> <shortcut|disabled>
  bb settings keyboard reset [command]

On macOS, right-panel tabs use `panel.previousTab` / `panel.nextTab` with
`Command+Control+ArrowLeft` / `Command+Control+ArrowRight`. They wrap through visible
tabs and each pane's New tab button in displayed order across the active
chat's right-panel groups. Press Enter or Space on New tab to open the picker.
On the selected New tab page, `panel.previousNewTabItem` /
`panel.nextNewTabItem` use `Command+Control+ArrowUp` / `Command+Control+ArrowDown` to
move through search, enabled actions, and recent items in displayed order.
Search results replace actions and recents while searching. Enter activates
the focused item.
Chat splits use `pane.focus.left` / `right` / `up` / `down` with
`Command+Shift+ArrowLeft` / `ArrowRight` / `ArrowUp` / `ArrowDown` on macOS. These move
spatially to the adjacent chat pane, including stacked splits, and stop at the
layout edge. The initially unassigned `pane.focus.previous` / `pane.focus.next`
commands still cycle in reading order. On Windows/Linux, these arrow navigation
commands start unassigned to preserve native Control-arrow editing shortcuts.
Rebind any of these commands in Settings → Keyboard, via
`bb settings keyboard set <command> <shortcut|disabled>`, or SDK
`system.updateKeyboardSettings`; read bindings with `system.config`.

Plugin commands use `plugin:<plugin-id>/<command-id>` as their stable binding
ID. For example: `bb settings keyboard set plugin:example/open-issue Mod+Shift+I`.
`bb settings keyboard reset plugin:example/open-issue` restores the plugin's
default; `set ... disabled` explicitly unbinds it. The SDK supports the same IDs
through `system.updateKeyboardSettings` and `system.config`.
Overrides survive plugin disable/re-enable and reload. Every active plugin
command appears in Keyboard Settings; commands without defaults start unbound.
Conflicting plugin defaults stay unbound and display the conflicting command.
The UI offers Replace binding or Cancel when assigning an occupied shortcut.
`keyboard list` includes all saved overrides and core effective bindings;
plugin defaults and availability are resolved in each app window, where the
plugin frontend runs. CLI/SDK callers should clear conflicting explicit
bindings in the same update; plugin defaults yield to explicit bindings.

Push notifications

The built-in Push notifications plugin sends mobile updates through Expo and
system notifications to connected web and desktop clients. Web tabs or desktop
windows must stay open; browser permission is requested in the plugin settings.

  bb push-notifications list
  bb push-notifications add --token <expo-push-token>
      --platform <ios|android> --label <device-name>
  bb push-notifications remove <id>
  bb push-notifications status
  bb push-notifications test <web|desktop>
  bb plugin config push-notifications set <mobileEnabled|webEnabled|desktopEnabled> <true|false>

`add` is an upsert by token: a known token refreshes its label and last-seen
time and keeps its id. Expo tokens that are no longer registered are removed
automatically after a failed delivery. Use `bb plugin disable
push-notifications` to stop delivery. Change the relay URL with `bb plugin
config push-notifications set expoPushUrl <url>`. Add `--json` to `list` or
`status` for machine-readable output. The list returns token suffixes only.
The three channel switches default to true and apply immediately across this
server. `test` broadcasts to all connected clients of the selected type with
permission; OS notification settings still control whether a banner appears.

Host files and voice transcription

  bb file read|write|list|paths|mkdir|move|remove ...
  bb voice transcribe <audio-file> [--prompt <context>]

Voice transcription uses the Voice input service chosen with
`bb settings ai-services set voice <automatic|off|service-id>`. bb accepts
recordings up to 25 MB, and each service may set a lower limit; Codex takes up
to 20 MB. These limits apply to the app, SDK, and CLI. If transcription fails
in the app, the error toast offers a download of the original recording until
dismissed.

`bb file` supports `--host` for remote machines and `--root` on mutating
commands to confine access beneath an absolute directory. `bb file list` and
`bb file paths` include dot-prefixed entries; pass `--no-hidden` to skip them.
Both skip a default set of dependency and cache directories such as
`node_modules`, `.venv`, `.pnpm-store`, and root-relative `.claude/worktrees`;
`--exclude <names...>` replaces that set. Entries match basenames at any depth
or exact root-relative paths using `/` separators. Use
`--json` for metadata and machine-readable results.

Server-backed sidebar preferences

Sidebar layout lives on the server in a keyed, revisioned registry so every
window, device, and the CLI share it: organization mode, chronological sort,
section orders, collapsed rows and sections, navigation entry order and
visibility, hidden thread-list groups, and the navigation and thread-list
provider pickers. The sidebar waits for them alongside the project list, and
an upgrade uploads the old browser-stored layout once.

  bb settings ui list [--json]
  bb settings ui get <key> [--json]
  bb settings ui set <key> <value> [--json]
  bb settings ui reset <key> [--json]

The sidebar thread list defaults to `__automatic__`: the first installed thread list
plugin other than the bundled Thread list plugin (`thread-list/thread-list`), or the
bundled plugin when there is none. Installing a thread list plugin therefore switches
to it. Legacy `__builtin__` selections resolve to the bundled plugin; other plugin
selections are preserved.
Use `bb settings ui reset sidebar.threadListProvider` to restore Automatic, or
`bb settings ui set sidebar.threadListProvider <plugin-id>/<slot-id>` to select
another plugin. The SDK exposes the same setting through `uiPreferences`.

`bb settings ui list` prints every key with its value, revision, and a short
description. `set` takes plain strings for enum and provider keys and JSON for
lists and `null`; it reads the current revision, writes with it, and retries
once on a conflict. `reset` writes the default. The SDK offers
`sdk.system.uiPreferences.list()`, `.set()`, and `.reset()`.

New installations default to Custom (`chronological`) for `sidebar.organizationMode`.
Migrated installations with existing projects, threads, or UI preferences fall back
to By project (`project`). Explicit server choices take precedence over legacy
browser choices, which take precedence over this installation fallback. Reset
saves the installation fallback as an explicit choice.

The built-in sidebar's Filter selects Active and Archived, defaulting to Active.
The selection is browser-local, not a server-backed preference or SDK/CLI setting.
Active includes threads with saved messages; there is no separate
Drafts section or filter. Archived threads use their preserved placement and a
restore action. Archived pages load only while selected.
Plugin sidebar replacements own their filters.

The palette's Filter uses Active and Archived independently of the
sidebar, defaulting to Active. Its selection is browser-local, not configurable
through SDK/CLI. Active includes threads with saved messages; Search threads retains
the existing title and conversation search behavior. Archived fetches bounded recent rows only when
selected.

Every thread-list header's actions menu offers New project, New section,
Organize, Sort by, and Filter. Organize selects By project,
By machine, or Custom and retains Groups → By environment.
The separate `sidebar.threadGrouping.environment` preference
decides whether sibling threads sharing one worktree collapse into a single row.
It defaults to `auto`, which groups them
everywhere except Custom: `bb settings ui set sidebar.threadGrouping.environment
false` keeps every thread on its own row, and `true` groups them in every mode.
Sort by selects a field, and selecting it again reverses its arrow/direction.
`sidebar.sortDirection` accepts `ascending`, `descending`, or `default`.
The default preserves each field's original order (newest first for dates,
A–Z for titles). For example: `bb settings ui set sidebar.sortDirection ascending`.

Thread-list visibility

Threads, a project, custom section, or machine's menu offers Hide from list;
its menu inside More offers Add to list. Customize list manages visibility and
order for the current organization. Hiding preserves the group's threads, order,
and collapse state. Pinned threads remain in Pinned; More carries hidden activity.

The Thread list plugin's `hiddenGroups` preference defaults to `[]`. Its keys
are `threads`, `project:<projectId>`, `section:<sectionId>`, and
`machine:<hostId>` (`machine:no-machine` for the unassigned group). Each
organization uses its own keys, while `threads` applies to every organization.
Pinned cannot be hidden. Duplicate keys are deduplicated, and unavailable IDs
remain saved without producing rows. New groups default visible.

  bb thread-list prefs get hiddenGroups
  bb thread-list prefs set hiddenGroups '["threads","project:proj_example","section:sec_example"]'
  bb thread-list prefs reset hiddenGroups

`set` replaces the entire list across organizations; include existing keys you
want to keep hidden. `reset` shows all groups. The plugin's `setPreference` and
`resetPreference` RPCs expose the same operations to its app client.

Sidebar footer actions

Settings → Appearance → Sidebar footer supports drag ordering and visibility.
Right-click an action and choose Hide to move it into the More menu. Hidden
shortcuts remain actionable; hiding an open disclosure closes it. The More menu
appears only when hidden actions are available and links back to customization.
`sidebar.footerOrder` and `sidebar.hiddenFooterItems` are string lists. Keys are
`builtin:settings`, `builtin:report-bug`, or `plugin:<encoded pluginId>/<encoded registrationId>`.
Preferences survive plugin reloads and temporarily unavailable plugins; new items
are visible by default. Example:

  bb settings ui set sidebar.hiddenFooterItems '["plugin:provider-usage/usage"]'
  bb settings ui reset sidebar.hiddenFooterItems

Client-local UI preferences

Some Settings values live only in the current browser/client. Sidebar width
and open state stay local because they depend on the window size. The Voice Input
microphone picker stores the selected browser MediaDevices device id in
localStorage as `bb.voiceInput.audioInputDeviceId`; it does not have a `bb`
command and does not change the server-side transcription model. When the preferred
microphone is disconnected, recording falls back to the system default (including
the sole available microphone). The saved preference is used again when it
reconnects. Select System default to follow system microphone changes.

Anonymous usage telemetry can be disabled in Settings → General → Privacy & diagnostics → Share anonymous usage data,
or with `bb settings general telemetryEnabled false`. The saved server-wide preference
takes effect immediately and persists across restarts. SDK callers can use
`system.updateGeneralSettings` with `telemetryEnabled`. `BB_TELEMETRY=false`
always disables telemetry, even when the saved preference is enabled.
