---
name: notes
description: Read and edit the Markdown notes shown in BB's Notes panel. Use when a request mentions the Notes panel, `bb notes`, the notes folder, a note by filename, or the Markdown highlight rules and table of contents that panel applies.
---

# Notes

Notes is a Markdown-only source editor over one folder on the primary machine,
`~/Notes` by default. It shows the Markdown *source* with syntax colouring, not
a rendered document — it is the VS Code editing experience for a notes folder,
not a WYSIWYG editor.

Notes is deliberately narrow:

- Only Markdown files (`.md`, `.markdown`, `.mdx`, `.mdown`, `.mkd`) appear in
  the tree and can be opened or written. Other files on disk are left alone.
- Dotfiles and dot-directories are hidden, so the panel never shows its own
  `.vscode/settings.json`.
- Every path is resolved inside the notes folder; `..` and absolute paths are
  refused.

## The folder

One setting, edited under Plugins → Installed plugins or from the CLI:

| Key             | Default   | Behavior                                            |
| --------------- | --------- | --------------------------------------------------- |
| `rootDirectory` | `~/Notes` | The folder the panel reads and writes.              |

```sh
bb plugin config notes get rootDirectory
bb plugin config notes set rootDirectory ~/Vault
```

The value must be absolute or start with `~/`; a relative path is refused
rather than resolved against the server's working directory. `~` expands to the
home directory of the account running the BB server. The folder is created if
it does not exist.

## CLI

```sh
bb notes root                            # print the notes folder
bb notes settings [--json]               # show the effective editor settings
bb notes list [--all] [--json]           # list notes; --all includes folders
bb notes read <path>                     # print a note
bb notes write <path> --content <text>   # overwrite a note
bb notes new <path>                      # create an empty note
bb notes mkdir <path>                    # create a folder
bb notes move <from> <to>                # rename or move
bb notes remove <path> [--recursive]     # delete
```

Paths are relative to the notes folder. `write` overwrites without a
compare-and-swap check, so read first if a human may be editing the same note
in the panel; the panel itself does use compare-and-swap and will report a
conflict rather than clobber a change made underneath it.

## Editor settings

Notes ships with a set of VS Code preferences already applied — there is no
setup step. Override any of them by putting a `settings.json` in the notes
folder under `.vscode/`, exactly where VS Code would look:

```
~/Notes/.vscode/settings.json
```

That file is JSONC: `//` and `/* */` comments and trailing commas are accepted.
Keys merge over the built-in defaults one at a time, so a file that sets only
`editor.fontSize` keeps the shipped highlight rules. A malformed file is
ignored with a log line rather than blanking the panel. `bb notes settings`
reports which keys are in effect and whether an override was found.

Understood keys:

| Key                                    | Effect                                                     |
| -------------------------------------- | ---------------------------------------------------------- |
| `highlight.regexes`                    | Regex-driven text decorations (see below).                 |
| `highlight.regexFlags`                 | Default flags for those regexes; `gi` as in VS Code.        |
| `markdown.extension.toc.orderedList`   | Numbered (`1.`) rather than bulleted table of contents.     |
| `editor.wordWrap`                      | `on` or `off`; the toolbar also toggles it per session.      |
| `editor.fontSize`, `editor.lineNumbers`| Passed to the editor.                                      |

Unknown keys are preserved and ignored, so a real VS Code `settings.json` with
settings for other extensions can be dropped in as-is.

### highlight.regexes

Each key is a regular expression; `decorations[i]` styles **capture group
i + 1** (a pattern with no capture groups styles the whole match). This is the
VS Code Highlight extension's format, so its rules port over unchanged.

```jsonc
{
  "highlight.regexes": {
    "(#PRIORITY\\b)": {
      "filterLanguageRegex": "markdown",
      "decorations": [{ "color": "#FF5555", "fontWeight": "bold" }]
    },
    "(#DONE\\b)(.*)": {
      "decorations": [
        { "color": "#50FA7B", "fontWeight": "bold" },
        { "color": "rgba(255, 255, 255, 0.25)" }
      ]
    }
  }
}
```

Supported per decoration: `color`, `backgroundColor`, `fontWeight`,
`fontStyle`, `textDecoration`, `overviewRulerColor` (a mark on the scrollbar).
A `color` of `theme.<workbenchColorId>` — for example
`theme.textLink.activeForeground` — resolves against the active BB code theme,
so it stays readable in light and dark. Values that are not colour-shaped are
dropped rather than written into the stylesheet. `filterFileRegex` and
`filterLanguageRegex` gate a rule by path and by language; the language is
always `markdown` here.

Scanning is per line, and lines over 2000 characters are skipped — the TODO and
FIXME patterns backtrack superlinearly, and a pasted minified blob would
otherwise stall the editor on every keystroke.

### Built-in Markdown decorations

Separate from `highlight.regexes`, so replacing that setting does not remove
them: a distinct colour per heading level `#` through `######`, and task-list
styling that dims a completed `- [x]` item. Monaco's Markdown grammar tags
every heading level identically, which is why these are decorations rather
than theme rules. They skip fenced code blocks, so a `# comment` in a shell
snippet is not coloured as a heading. The user's own rules deliberately do
still apply inside fences, matching VS Code — that is the point of the TODO
and FIXME patterns.

## Table of contents

The toolbar's table-of-contents button fills the block between
`<!-- toc -->` and `<!-- /toc -->`, rewriting it in place on each press. With
no markers present it inserts the whole block at the cursor. Entries are
numbered when `markdown.extension.toc.orderedList` is true. `#` lines inside
fenced code blocks are not listed, and anchors follow GitHub's rules
(lowercased, punctuation dropped, spaces to hyphens).

## Saving

`Cmd`/`Ctrl` + `S` saves, whether or not the editor itself has focus, and a
Save button appears while a note has unsaved changes. Saves are
compare-and-swap on the file's SHA-256: if the note changed on disk since it
was opened, the panel offers Reload or Overwrite instead of silently winning.
Opening another note with unsaved changes asks first.

## Routing

The open note is part of the URL — `/plugins/notes/notes/<path>` — so a note
can be linked and restored. Segments are percent-encoded, so a note with a
space in its name links correctly.
