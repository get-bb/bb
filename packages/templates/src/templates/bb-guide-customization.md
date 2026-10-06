---
kind: instruction
title: bb Guide — Customization
summary: Command reference for the bb app theme, server-backed settings, keyboard shortcuts, sidebar preferences, host files, and voice transcription.
intent: Explain the CLI theme surface, server-backed app settings, and the remaining app-wide customization commands.
editingNotes: Keep flags accurate against the CLI implementation. Theme details live in the bb-cli skill's references/theming.md. Bundled plugins document their settings in the plugins chapter and their skills, not here.
---
Customization commands

Bundled plugins such as Keep Awake, Concurrency limit, Thread list, and Push
notifications own their settings and commands; run `bb guide plugins`.

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
                                 Activate a theme (built-ins: default, nord,
                                 dracula, solarized, gruvbox, catppuccin),
                                 preserving the favicon color unless the flag
                                 supplies the complete selection
  bb theme show [id] [--css]     Print the active palette, or resolve <id> without
                                 activating it; --css dumps the CSS
  bb theme reset                 Back to the default theme; preserve favicon color
  bb theme favicon set <color>   Set favicon color; preserve the active theme
  bb theme favicon reset         Reset favicon color; preserve the active theme

To author a custom theme, run `bb theme dir`, write <that-dir>/<name>/theme.css,
then `bb theme set <name>`. A name has at most 64 characters, starts with a
letter or digit, then uses letters, digits, `.`, `_`, or `-`; avoid built-in
ids. Optional `pierre-dark.json` / `pierre-light.json`
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

Server-backed settings

Settings stored server-side apply to every window and survive restarts.

  bb settings show
  bb settings ai-services
  bb settings ai-services set <thread-title|commit-message|voice> <automatic|off|service-id> [--plugin <plugin-id>]
  bb settings ai-services test <thread-title|commit-message>
  bb settings general <key> <value>
  bb settings completed-turns [provider-id] [collapse|flat|default]
  bb settings experiment <key> <value>
  bb settings usage [--machine <id-or-name>]
  bb settings version [--force]
  bb settings reload              Reload bb-managed configuration

AI services: `bb settings ai-services` shows which AI service writes thread
titles (and so branch names), commit messages, and voice transcripts, plus
every service a plugin registers and whether it is ready. `set` picks
`automatic` (bb cloud first, then all other compatible services by plugin id
and service id in lexicographic order, including third-party plugins), `off`,
or one service id; a picked service is never swapped for another. A service is
identified by its plugin and its id, so two plugins may use the same id; pass
`--plugin <plugin-id>` when they do. `test` runs a sample title or commit
message through the current choice. Settings → AI services has the same
controls. Each plugin chooses its own model. The removed `BB_INFERENCE`,
`BB_INFERENCE_FALLBACK`, and `BB_TRANSCRIPTION` variables are ignored with a
warning in `~/.bb/config.json`, and `bb-app config set` refuses them.

General keys: `bb settings general` accepts any key from `generalSettings` in
`bb settings show`; an unknown key or wrongly shaped value is rejected with the
list of known keys. Boolean preferences take `true`, `false`, `on`, or `off`,
and `null` clears a preference that can be unset. Most appear in Settings →
General. Machine-related keys (`machineServerUrl`, `defaultMachineAccess`,
`machineGitCredentialsEnabled`) are covered in `bb guide machines`.

- `showDiagnosticEvents` (default false) shows provider environment resolution
  and unhandled provider events in the timeline. Warnings, errors, and model
  fallback stay visible either way.
- `steerActiveThreadOnEnter` (default true for a new install; an earlier
  install with saved settings or work keeps false): when on, Enter steers a
  running thread and Command+Enter queues a follow-up; when off, those are
  reversed. Shift+Enter inserts a newline.
- `showGitChanges` (default true; Settings → General → Show Git changes and
  Commit button): false hides the git summary, expanded file list, and Commit
  action in the thread header and overflow menu for every thread and connected
  client. PR status and workspace warnings remain visible.
- `confirmThreadArchive` (default true): set false to archive parent and child
  threads in the app without the confirmation popup; the toast still offers
  Undo. CLI and SDK archive calls are always non-interactive.
- `streamerMode` (default false) hides every `customModels` entry from
  `~/.bb/config.json` in all model lists (pickers, `bb provider models`, and
  the SDK) during a screen share. The entries stay in the config file; a
  request that names a hidden model still runs with it, and default model
  resolution still sees the full list.
- `allowFastServiceTier` (default true; Settings → Providers): false hides the
  service tier control and runs new turns at the default service tier,
  including explicit requests for any other tier (fast, Codex ultrafast), saved
  project defaults, automations, and messages queued before the change. Project
  defaults saved while it was off retain the default tier.
- `managedBranchPrefix` (default `bb/`, at most 64 characters) prefixes every
  branch bb creates for a worktree or a new checkout branch: the default gives
  `bb/fix-login-flow-thr_ab12cd34ef`, `sawyer/wt-` gives
  `sawyer/wt-fix-login-flow-thr_ab12cd34ef`, and an empty value gives no
  prefix. bb rejects a prefix that cannot start a valid git branch name.
  Existing branches keep their names.
- `providerOrder` (default `[]`) is a JSON array of provider ids, and
  `defaultProviderId` (default `null`) names the default provider; `null`
  clears it.
- `telemetryEnabled`: see Telemetry below.

Completed turns: `bb settings completed-turns` lists how each provider shows a
finished turn: `collapse` folds the turn's work into one "Worked for" row and
keeps the final answer visible, and `flat` keeps every step visible. Each
provider has a default (Claude Code is `flat`, the other first-party providers
`collapse`); `--json` shows whether each value comes from your setting or that
default. `bb settings completed-turns <provider-id> <collapse|flat>` overrides
it for that provider, and `default` removes the override. It applies to
existing threads too, including `bb thread log`. Settings → Providers has the
same per-provider switch.

Experiments: `bb settings experiment <key> <true|false>` toggles a default-off
experiment (Settings → Experiments). `changelogPreview` shows the latest
release notes as a dismissible card on Settings → Updates. Experiments that
gate a feature are documented with it: `serverMove` in `bb guide machines`,
`performanceDiagnostics` under Server performance diagnostics below.

`navigationRail` keeps a vertical rail of destinations beside the sidebar.
Home returns to the last thread, Settings sits at the bottom, and New thread
moves into the sidebar header. While enabled, the Navigation and Header
choices under Settings → Appearance are not used. Narrow windows and phones
keep the regular drawer.

Launcher settings

`bb-app config` and `bb-app env` reload runtime settings in a running server,
but the CLI identifies settings that are startup-only, including binding/ports,
data and the dev-app port, telemetry, inherited skill roots, and
`BB_LOG_LEVEL`. Use `bb-app config`, not `bb-app env`, to change `BB_APP_URL`
live. After a startup-only change, run `bb-app stop && bb-app start` or restart
the desktop app; until then, changing or unsetting `BB_SERVER_BIND_HOST` does
not close a previous `0.0.0.0` listener.

`--server-bind-host 0.0.0.0` (or `BB_SERVER_BIND_HOST=0.0.0.0`) listens on
every interface for direct remote access; containers must also publish the
port. BB accepts request hosts that are `localhost`, IP addresses (including
LAN and Tailscale IPs), or the hostname in `BB_APP_URL`. For a custom DNS name
or reverse proxy, run `npx bb-app config set BB_APP_URL https://bb.example.com`
before connecting, including from the CLI or SDK; forwarded host headers cannot
authorize an unconfigured name. BB Connect needs no additional configuration.

Keyboard shortcuts

Settings → Keyboard records per-command shortcut overrides, persisted
server-side and applied live to every connected window, including desktop menu
accelerators. Reset removes an override and returns to bb's current default;
`disabled` explicitly unbinds a command. `Mod` means Command on macOS and
Control on Windows/Linux. The complete default table is in docs/configuration.md.

  bb settings keyboard list
  bb settings keyboard hints <true|false>
  bb settings keyboard set <command> <shortcut|disabled> [--platform mac|windows|linux]
  bb settings keyboard reset [command] [--platform mac|windows|linux]

`keyboard list` prints core command ids with their effective bindings, plus
every saved override; examples include `panel.previousTab` / `panel.nextTab`,
`pane.focus.left|right|up|down`, `pane.maximize.toggle`, and the initially
unbound `panel.fullScreen.toggle`. `hints` (default true) shows or hides the
delayed shortcut badges shown while holding the modifier key; shortcuts work
either way.

`history.back` / `history.forward` (`Mod+[` / `Mod+]`) follow the pages opened
in the current window, like the sidebar arrows. `thread.previous` /
`thread.next` follow sidebar order instead: `Mod+Shift+[` / `Mod+Shift+]`
on desktop and `Control+Shift+[` / `Control+Shift+]` on the web.

An override can be scoped with `--platform`; without it, it applies on all
platforms. A platform-specific override takes precedence over a general one,
including when disabled. Scoped `set` and `reset` keep other platforms'
overrides; unscoped `set` updates the general override, and unscoped `reset`
clears every scope for the command (or every command if omitted). The SDK uses
`system.updateKeyboardSettings` to write and `system.config` to read bindings.

Plugin commands use `plugin:<plugin-id>/<command-id>` as their binding ID, for
example `bb settings keyboard set plugin:example/open-issue Mod+Shift+I`;
`reset` restores the plugin's default. Overrides survive plugin disable,
re-enable, and reload. Commands without defaults start unbound, and
conflicting plugin defaults stay unbound. Plugin defaults resolve in each app
window, not in `keyboard list`, so CLI/SDK callers should clear conflicting
explicit bindings in the same update.

Sidebar preferences

`bb settings ui` reads and writes server-side sidebar preferences shared by
every window, device, and the CLI. The same registry stores which thread Info
panel sections are collapsed (`infoPanel.collapsedSections`).

  bb settings ui list [--json]
  bb settings ui get <key> [--json]
  bb settings ui set <key> <value> [--json]
  bb settings ui reset <key> [--json]

`list` prints every key with its value, revision, and a short description.
`set` takes plain strings for enum and provider keys and JSON for lists and
`null`; it retries once if another writer changed the key. `reset` writes the
default. The SDK offers `sdk.system.uiPreferences.list()`, `.set()`, and
`.reset()`.

The thread list is drawn by `sidebar.threadListProvider`, which defaults to
`__automatic__`: the first installed thread list plugin other than the bundled
Thread list plugin (`thread-list/thread-list`), or the bundled plugin when
there is none, so installing a thread list plugin switches to it. Select one
with `bb settings ui set sidebar.threadListProvider <plugin-id>/<slot-id>`, or
reset to restore Automatic. The bundled Thread list plugin keeps its own
layout (organization mode, sort, grouping, hidden and collapsed groups) and
copies the legacy `sidebar.*` layout keys from here only once; change its
layout with `bb thread-list prefs` (see `bb guide plugins`).

The sidebar navigation rows (New thread, Search, Plugins, Skills, plugin
panels) come from `sidebar.navigationProvider`, which defaults to
`__automatic__`: an installed navigation plugin wins over the bundled
`navigation/navigation`. Their order and visibility are
`sidebar.pluginPanelOrder` and `sidebar.visiblePluginPanels`.
`sidebar.headerProvider` picks a plugin that draws controls beside the sidebar
toggle; it defaults to `__builtin__`.

Footer actions: `sidebar.footerOrder` and `sidebar.hiddenFooterItems` are
string lists of `builtin:settings`, `builtin:report-bug`, or
`plugin:<encoded pluginId>/<encoded registrationId>`. They survive plugin
reloads and temporarily unavailable plugins; new items are visible by default.

  bb settings ui set sidebar.hiddenFooterItems '["plugin:bb--provider-usage/usage"]'
  bb settings ui reset sidebar.hiddenFooterItems

In the app, the sidebar footer's More menu holds hidden actions and actions
that don't fit; Settings → Appearance → Sidebar footer, or right-clicking an
action, edits the footer.

The command palette's thread search has its own Active/Archived filter, which
is browser-local: it is not a server setting or a CLI/SDK option. The sidebar
thread list's Active/Archived filter is the Thread list plugin's
`threadLifecycles` preference.

Sidebar width and open state are per window and stay local to the browser.

Host files and voice transcription

  bb file read|write|list|paths|mkdir|move|remove ...
  bb voice transcribe <audio-file> [--type <mime>] [--prompt <context>]
                                   --type defaults to audio/webm

`bb file` supports `--host` for remote machines and `--root` on mutating
commands to confine access beneath an absolute directory. `bb file write`
takes exactly one of `--content` or `--stdin`; `bb file paths` lists files and
directories unless `--files` or `--directories` narrows it. `bb file list` and
`bb file paths` include dot-prefixed entries; pass `--no-hidden` to skip them.
Both skip a default set of dependency and cache directories such as
`node_modules`, `.venv`, `.pnpm-store`, and root-relative `.claude/worktrees`;
`--exclude <names...>` replaces that set. Entries match basenames at any depth
or exact root-relative paths using `/` separators. Use
`--json` for metadata and machine-readable results.

`bb file remove` needs `--yes` without a terminal. `bb file remove --recursive`
and `sdk.files.remove({ recursive: true, ... })` first stop processes whose
working directory is inside the directory, including dev servers in nested
checkouts (macOS and Linux only).

Voice transcription uses the Voice input service chosen with
`bb settings ai-services set voice <automatic|off|service-id>`. bb accepts
recordings up to 25 MB, and each service may set a lower limit; Codex takes up
to 20 MB. These limits apply to the app, SDK, and CLI. The app's microphone
choice is per browser and has no `bb` command. Right-click the composer
microphone or press Shift+F10 to open preferences in a desktop popover or
mobile drawer. Opening starts a local waveform preview; closing releases it.
Recording controls contain cancel, stop, and send; preferences are available
while idle.

Missing or unreadable inputs fall back to the system default, then other
available inputs. Permission denials do not trigger fallback. A disconnect
switches inputs in the same recorder, preserving captured audio. A reconnected
preferred device is used on the next recording. A missing preference alone
shows no warning. Capture failures warn on the idle microphone; five seconds
of near-silent audio warns in the preview or recording row without switching
inputs or stopping capture. Preview audio is never saved or transcribed.

Telemetry

Anonymous usage telemetry is controlled by Settings → General → Privacy &
diagnostics, `bb settings general telemetryEnabled false`, or SDK
`system.updateGeneralSettings` with `telemetryEnabled`. The saved preference
takes effect immediately. `BB_TELEMETRY=false` always disables telemetry, even
when the saved preference is enabled.

Mobile app downloads

Settings → Mobile links the iOS TestFlight
(https://testflight.apple.com/join/T9MayTMb) and the Android APK from the
public `get-bb/bb` GitHub `android-testing` release (`bb-android.apk`), and
pairs either app through Add mobile device. `bb settings mobile-app --json` or
SDK `system.mobileAppDownloads()` returns both links. Add `--details --json`
or call `system.mobileAppReleases()` for the Android version, build, size, and
upload date; `android` is `null` when that metadata is unavailable, and the
links still work. Inside the Android app, this page compares the installed
native build number with the published APK. Older apps without build reporting
cannot determine update status. Installed version and build are device-local;
CLI and SDK metadata report the published APK.

Server performance diagnostics

Start with `bb-app --perf-diagnostics` or `BB_PERF_DIAGNOSTICS=1` (restart to
change), then run `bb settings experiment performanceDiagnostics true|false`.
Collection needs both; it adds overhead and writes CPU profiles every 30 seconds
to `$BB_DATA_DIR/logs/performance/` (kept 12 hours), which contain local paths.
Open a `.cpuprofile` in Chrome DevTools.
