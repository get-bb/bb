# Notes

A Markdown-only source editor for one folder, `~/Notes` by default, in its own
nav panel. It shows Markdown *source* with syntax colouring rather than a
rendered document — the VS Code editing experience for a notes folder.

This is deliberately not the Docs plugin. Docs renders notes as rich text and
manages multiple vaults across hosts; Notes edits the raw Markdown of one
folder and applies regex-driven text decorations to it.

## Features

- **Source editing:** Monaco with a Markdown-tuned theme, find, folding, word
  navigation, and word wrap on by default. No bracket guides, occurrence boxes,
  or word-based suggestions — a note is prose, not code.
- **Markdown colouring from your theme:** Monaco's Markdown grammar tags every
  construct with a handful of generic token names, which a code theme then
  colours as if headings were keywords. `lib/markdown-theme.ts` re-points each
  one at the `markup.*` scopes a theme defines for prose, falling back to a
  built-in palette for themes that define none.
- **A colour per heading level** and dimmed completed task-list items, applied
  as decorations because the grammar cannot distinguish `#` from `######`.
  These skip fenced code blocks.
- **Imported VS Code preferences:** the shipped defaults include a working
  `highlight.regexes` set, applied on first open with no setup. A
  `.vscode/settings.json` in the notes folder overrides them key by key.
- **Files and folders:** create, rename, delete, and search from the sidebar,
  all scoped to the notes folder.
- **Safe saves:** compare-and-swap on SHA-256, so a note changed on disk offers
  Reload or Overwrite rather than being clobbered. Unsaved changes are
  confirmed before navigating away.
- **Table of contents:** fills the `<!-- toc -->` block, numbered when
  `markdown.extension.toc.orderedList` is set.
- **CLI:** `bb notes list|read|write|new|mkdir|move|remove|settings|root`.

## Configuration

One plugin setting, `rootDirectory` (default `~/Notes`), which must be absolute
or start with `~/`. Editor behavior comes from `<root>/.vscode/settings.json`.
Both are documented in [skills/notes/SKILL.md](skills/notes/SKILL.md).

## Safety

Every path from the panel is resolved against the notes root and rejected if it
escapes it, so `..` or an absolute path cannot reach the rest of the disk. Only
Markdown extensions are readable or writable. Decoration styles from a settings
file are validated against colour and keyword shapes before they reach a
stylesheet, and the notes root itself cannot be deleted.

## The Monaco bundle

`monaco-bundle/` is built to `dist/monaco` by `scripts/stage-assets.mjs` and
served through a `files.createPreview` lease, so Monaco is fetched the first
time the panel mounts rather than parsed at app boot. The app bundle stays
around 360 KB; Monaco's 4.2 MB loads lazily.

This plugin carries its own copy rather than reusing the File Editor plugin's:
that plugin ships disabled by default, and a disabled plugin's `dist/` is not
something this one may depend on existing.

## Layout

| Path                            | Role                                                        |
| ------------------------------- | ----------------------------------------------------------- |
| `server.ts`                     | RPC contract, file operations, settings merge, `bb notes`.  |
| `app.tsx`                       | The nav panel: routing, editor lifecycle, save state.       |
| `components/`                   | Sidebar tree and toolbar.                                   |
| `lib/notes-path.ts`             | Root resolution and containment checks.                     |
| `lib/vscode-settings.ts`        | The imported defaults, JSONC parsing, merge.                |
| `lib/highlight-rules.ts`        | Compiles `highlight.regexes` and scans a document.          |
| `lib/decoration-styles.ts`      | Validates styles into interned CSS classes.                 |
| `lib/decoration-controller.ts`  | Keeps one editor's decorations current.                      |
| `lib/markdown-theme.ts`         | Markdown token rules over the active BB code theme.          |
| `lib/markdown-decorations.ts`   | Heading ramp and task-list rules.                            |
| `lib/fenced-code.ts`            | Shared fence detection for the TOC and decorations.          |
| `lib/toc.ts`                    | Heading collection, anchors, TOC block rewriting.            |
| `lib/notes-tree.ts`             | Tree building, filtering, name validation, route decoding.   |
