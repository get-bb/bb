A Markdown editor for your notes folder, in its own panel. It opens the files in `~/Notes` and shows the Markdown as you wrote it, with colouring, rather than as a rendered document.

## What you get

- A file tree for your notes folder. Create notes and folders, rename, delete, and filter by name. Only Markdown files appear, so the folder's other files are left alone.
- Markdown colouring built for prose instead of code: a different colour for each heading level, dimmed text on finished `- [x]` tasks, and distinct styling for links, quotes, tables, bold, italic, and inline code. The colours follow your bb theme in light and dark.
- Your own highlight rules. Notes understands the `highlight.regexes` format from VS Code's Highlight extension, so tags such as `#PRIORITY`, `#DONE`, `TODO`, and `FIXME` can be coloured, given a background, struck through, or marked on the scrollbar. A useful set is applied out of the box.
- A table of contents button that fills the block between `<!-- toc -->` and `<!-- /toc -->` and refreshes it whenever you press it again.
- Find in note, folding, word navigation, and word wrap, from the same editor VS Code uses.
- Save with Cmd+S, or Ctrl+S on Linux and Windows. If the note changed on disk since you opened it, the save stops and offers Reload or Overwrite.

## How it works

Notes reads one folder on your primary machine. Change which folder under Plugins, or with `bb plugin config notes set rootDirectory ~/Vault`. The folder is created if it is not there yet.

To change how the editor behaves, put a `settings.json` in your notes folder under `.vscode/`, exactly where VS Code would look. Comments and trailing commas are allowed. It overrides the shipped defaults one setting at a time, so you only write the keys you want to change. Notes reads `highlight.regexes`, `markdown.extension.toc.orderedList`, `editor.wordWrap`, `editor.fontSize`, and `editor.lineNumbers`, and ignores settings meant for other extensions.

Notes is for Markdown only, and there is no language server or spell check. For rendered, rich-text notes across several folders and machines, use the Docs plugin instead.

Everything in the panel is also available from the command line with `bb notes`.
