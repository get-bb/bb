# bb-plugin-monaco-editor

Opens files in BB using [Monaco](https://microsoft.github.io/monaco-editor/),
the editor from VS Code, instead of BB's read-only file preview.

It applies everywhere BB opens a file: links clicked in chat, the secondary
panel's file search, and `bb thread open`.

## Features

- **Edit and save.** <kbd>⌘S</kbd> writes the file. If it changed on disk
  since you opened it — often because the agent edited it — the save stops and
  offers Reload or Overwrite rather than clobbering the change.
- **Find in file** with <kbd>⌘F</kbd>, plus Monaco's usual editing: multiple
  cursors, block selection, bracket matching, code folding.
- **Syntax highlighting** for ~86 common file types.
- **File tree.** Toggle it from the file bar to browse the project, filter by
  path, expand and collapse directories, and jump to another file. It opens
  with the current file revealed. Right-click any row to copy its absolute
  path, relative path, or filename.
- **Quick palette commands.** Open the quick palette (<kbd>⌘⇧P</kbd>) and
  type "fold", "sort", or "copy" to reach *fold level 1–5*, *fold
  recursively*, *unfold all*, *unfold recursively*, *unfold at cursor*,
  *sort selected lines ascending/descending*, and *copy the path / relative
  path of the current file*. The sort rows appear only with a multi-line
  selection, and every row acts on the Monaco tab you last worked in.
- **Follows your theme,** including light/dark switches and custom palettes.

## Development

Ships with BB as a builtin; there is nothing to install.

```
pnpm exec turbo run typecheck test --filter=bb-plugin-monaco-editor
```

`scripts/stage-assets.mjs` builds the Monaco bundle the editor loads, into
`dist/monaco`. Packaging runs it (`apps/server/scripts/copy-builtin-plugins.ts`),
since only a builtin's `dist/` ships. A source checkout never runs that path —
the dev server loads builtins straight from `plugins/<name>` — so the plugin
builds the bundle itself when it is missing or older than `monaco-bundle/`,
which makes that one file open a few seconds slow.
`pnpm --filter bb-plugin-monaco-editor build:monaco` does it up front.

The dev loop already rebuilds `dist/app.js` and reloads `server.ts` on save,
so editing `app.tsx`, `components/`, `lib/`, or `server.ts` needs nothing
extra. It knows nothing about the Monaco bundle, which is why the staleness
check exists: edit `monaco-bundle/` and the next file open rebuilds.

Monaco is built rather than bundled into `app.js` because `bb plugin build`
emits one file with no code splitting: Monaco would parse at app boot for
everyone, including users who never open a file, and its worker could not be
emitted at all. `lib/monaco-loader.ts` loads the built files from a
`files.createPreview` URL the first time a file tab opens.

`monaco-bundle/editor.js` is the entry: Monaco's own `editor.main`, which is
the API plus its contribution modules (find, folding, word navigation,
sorting, …) and every Monarch grammar. What it leaves out is the language
*services* for CSS, HTML, JSON, and TypeScript — completion and type checking
this plugin has no use for. esbuild proves what is reachable, so the result is
4.6 MB rather than the 24 MB of Monaco's prebuilt tree.

Do not trim that entry to `editor.api` to save the difference. The API without
the contributions still opens files and still types, so the editor looks fine
while find, word navigation, and folding silently do not exist. The build
script asserts each of those is present for that reason.

## Which files it opens

The plugin claims the extensions listed in `lib/languages.ts` — common code,
config, and text formats. Binaries like `png` and `pdf` are left to BB's own
preview, which renders them properly.

To change any file type back, use **Settings → File openers**, which offers
Automatic, BB's built-in preview, or Monaco per extension. Right-clicking a
file link also offers a one-off "Open with…".

## Roadmap

- **Language intelligence.** There is no language server, so no
  go-to-definition, find-references, or type checking. Monaco ships a
  TypeScript checker, but it can only see the one open file, so every import
  looks unresolved — it is switched off rather than showing errors that are
  wrong.
- **File operations.** The tree is read-only; renaming, creating, and
  deleting files are not implemented yet.
- **Hidden files and `node_modules`** never appear in the tree. BB's path
  listing excludes them and offers no way to ask for them
  ([#2093](https://github.com/get-bb/bb/issues/2093)).
- **Opening a file from the tree reuses the current tab,** so the tab title
  keeps naming the file it was opened with. A plugin cannot ask BB to open a
  file or retitle its tab ([#2102](https://github.com/get-bb/bb/issues/2102)).
- **No "open in editor" button** like BB's preview has; that capability is not
  available to plugins.
- **Thread-storage files on a remote machine** fail to open.
