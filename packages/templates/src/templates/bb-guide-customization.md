---
kind: instruction
title: bb Guide — Customization
summary: Command reference for customizing the bb app color palette and keyboard shortcuts.
intent: Explain the CLI theme surface and server-backed app customization.
editingNotes: Keep flags accurate against the CLI implementation. Theme details live in the bb-cli skill's references/theming.md.
---
Customization commands

Theming — the app-wide color palette

`bb theme` controls a set of CSS-variable overrides, persisted server-side and
applied live to every open window. This is the palette only; light/dark mode is a
separate per-client setting the palette layers on top of. Custom themes live on
disk, one folder per theme, at <bb-data-dir>/theme/<name>/theme.css (the packaged
app uses ~/.bb/theme/…). The folder name is the theme id.

  bb theme list                  Built-in and custom themes; shows the active one
  bb theme dir                   Print the custom-theme directory (where to author)
  bb theme set <id> [--favicon-color <color>]
                                 Activate a theme, preserving the favicon color
                                 unless the flag supplies the complete selection
  bb theme show [--css]          Print the active palette; --css dumps the CSS
  bb theme reset                 Back to the default theme; preserve favicon color
  bb theme favicon set <color>   Set favicon color; preserve the active theme
  bb theme favicon reset         Reset favicon color; preserve the active theme

To author a custom theme, run `bb theme dir`, write <that-dir>/<name>/theme.css,
then `bb theme set <name>`. The full design-token reference is in the bb-cli
skill (references/theming.md).

Favicon colors are `default`, `red`, `orange`, `yellow`, `green`, `teal`,
`blue`, `purple`, and `pink`. Theme and favicon-only commands carry the other
appearance value forward explicitly.

Add --json to any theme command for machine-readable output.

Server-backed General settings

Settings → General includes app-wide preferences stored server-side so every
window and restart sees the same value. On macOS, the Caffeinate toggle asks the
primary host daemon to run `/usr/bin/caffeinate -i -w <daemon-pid>`, preventing
system idle sleep while bb is running; turning it off stops that process. It
only blocks idle sleep: closing a laptop lid or choosing Sleep manually still
sleeps the Mac. This setting is only shown when the connected primary host
daemon reports macOS.

Settings → Keyboard also includes `showKeyboardHints`, which defaults to true.
Turn it off to hide the delayed shortcut badges shown while holding Command or
Control on macOS, or Control on Windows/Linux. Shortcut commands continue to
work.

Settings → General includes `showUnhandledProviderEvents`, which defaults to
false in packaged builds. Turn it on to show raw provider events bb does not yet
understand; development builds always show these diagnostic rows.

Settings → General also includes `steerActiveThreadOnEnter`, which defaults to
false. When enabled, Enter steers a running thread and Command+Enter queues a
follow-up; when disabled, those actions are reversed.

  bb settings show
  bb settings general <key> <true|false>
  bb settings experiment <key> <value>
  bb settings usage [--machine <id-or-name>]
  bb settings version [--force]
  bb settings reload

The `toolsHub` experiment exposes Extensions for managing skills and plugins.
Automations stays in the Plugins section beside threads. It does not enable or
disable installed skills, automation execution, plugin runtimes, CLI commands,
or backend APIs.

Thread timeline windows are bounded by event count as well as user-message
count (`BB_FF_TIMELINE_WINDOW_EVENT_BUDGET`, default 1500), so a long thread
stops reprojecting its whole history — and blocking the server event loop — on
every update. A turn still running is cut at the budget too, so a very long
turn costs the budget per update instead of growing without limit. Older
activity loads automatically as you scroll toward the top.

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

Host files and voice transcription

  bb file read|write|list|paths|mkdir|move|remove ...
  bb voice transcribe <audio-file> [--prompt <context>]

`bb file` supports `--host` for remote machines and `--root` on mutating
commands to confine access beneath an absolute directory. Use `--json` for
metadata and machine-readable results.

Client-local UI preferences

Some Settings values live only in the current browser/client. The Voice Input
microphone picker stores the selected browser MediaDevices device id in
localStorage as `bb.voiceInput.audioInputDeviceId`; it does not have a `bb`
command and does not change the server-side transcription model.
