---
kind: instruction
title: bb Guide — Customization
summary: Command reference for customizing the bb app color palette.
intent: Provide complete theme command documentation for agents reshaping the app's look.
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
  bb theme set <id>              Activate a built-in or custom theme; applies live
  bb theme show [--css]          Print the active palette; --css dumps the CSS
  bb theme reset                 Back to the default theme

To author a custom theme, run `bb theme dir`, write <that-dir>/<name>/theme.css,
then `bb theme set <name>`. The full design-token reference is in the bb-cli
skill (references/theming.md).

Add --json to any theme command for machine-readable output.
