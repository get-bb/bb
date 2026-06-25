---
kind: instruction
title: bb Guide — Customization
summary: Command reference for customizing the bb app — color palette (themes) and the live-editable UI source.
intent: Provide complete customization command documentation for agents reshaping the app's look and frontend.
editingNotes: Keep flags accurate against the CLI implementation. Theme details live in the bb-cli skill's references/theming.md; UI-source details live in the bb-cli skill.
---
Customization commands

bb can be reshaped while it runs, at two levels: the color palette (`bb theme`)
and the frontend itself (`bb ui`).

Theming — the app-wide color palette

`bb theme` controls a set of CSS-variable overrides, persisted server-side and
applied live to every open window. This is the palette only; light/dark mode is a
separate per-client setting the palette layers on top of. Custom themes live on
disk, one folder per theme, at <bb-data-dir>/theme/<name>/theme.css (the packaged
app uses ~/.bb/theme/…). The folder name is the theme id.

  bb theme list                  Built-in and custom themes; shows the active one
  bb theme dir                   Print the custom-theme directory (where to author)
  bb theme set <id>              Activate a built-in or custom theme; applies live
  bb theme show [--css]          Print the active palette; --css dumps the CSS
  bb theme reset                 Back to the default theme

To author a custom theme, run `bb theme dir`, write <that-dir>/<name>/theme.css,
then `bb theme set <name>`. The full design-token reference is in the bb-cli
skill (references/theming.md).

Modifying the app UI

`bb ui` reshapes the frontend itself — layout, copy, components, behavior — from
any chat. It is an experiment, off by default: turn on "UI forking" under
Settings → Experiments first (until then `bb ui` is disabled and the shipped UI is
always served). `bb ui fork` then creates your editable copy of the frontend at
<bb-data-dir>/ui (the packaged app uses ~/.bb/ui): a self-contained Vite + React +
Tailwind workspace (src/, index.html, public/, package.json). Edit the source on
disk — and add dependencies to package.json — then `bb ui apply` installs (when
package.json changed) and builds, and live-reloads every window.

  bb ui status                   Which UI is active (prod|fork) + last build state
  bb ui fork [--reset]           Create your editable fork and switch to it
  bb ui apply                    Rebuild your fork after editing; reload clients
  bb ui prod                     Switch back to the shipped UI (fork kept on disk)
  bb ui update                   Rebase your fork onto a newer shipped UI

The shipped UI is the known-good fallback: `bb ui prod` restores it instantly and
works even when an edit has broken the app (it runs server-side). Builds are
gated — a build that fails to compile is never served; the live UI stays on the
last good build and `bb ui apply` returns the errors to fix and retry. `bb ui`
swaps what the server serves, so it applies to the packaged app and production
server builds; under `pnpm dev` the frontend is served by Vite (use its HMR).

Add --json to any theme or ui command for machine-readable output.
