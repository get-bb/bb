# bb-plugin-notes

An Obsidian-style markdown notes plugin — the hero example for the
`bb.sdk.files` host file API and the `fileOpener` / `useComposer()` /
navPanel-`subPath` frontend surfaces.

- **Notes nav panel** (`chrome: "none"`): mounted-directory tree + a
  [Milkdown Crepe](https://milkdown.dev/) WYSIWYG editor, deep-linked via
  the panel's `subPath` (`/plugins/notes/notes/<mount>/<path>`).
- **Mounted directories** come from the `directories` setting
  (comma-separated, `~` expands). Reads and saves go through
  `bb.sdk.files` with `expectedSha256` compare-and-swap — a save that
  races an agent editing the same file surfaces a reload/overwrite banner
  instead of clobbering.
- **File opener**: registers as an opener for `md`/`mdx`/`markdown`, so
  right-clicking a markdown file tab offers "Open with Notes editor" (and
  "Always open .md with…"). Links clicked in rendered markdown then land
  in the editor instead of the read-only preview.
- **Chat integration**: "Add to chat" quotes the current selection (or the
  whole note) into the composer draft via `useComposer().addQuote`;
  "@-mention" inserts a pill that resolves the note's content at send time
  through the plugin's mention provider. Typing `@` in the composer also
  searches notes directly.
- **Live refresh**: a background fs watcher publishes `notes-changed` over
  `bb.realtime`, keeping the tree current while agents write notes.
- Crepe's stylesheet is served from the plugin's own `bb.http` route
  (`/api/v1/plugins/notes/http/crepe.css`) because plugin bundles ship only
  Tailwind-compiled CSS; `--crepe-*` variables are remapped to host theme
  tokens so the editor follows light/dark and custom palettes.

Install from a bb checkout:

```
bb plugin install examples/plugins/notes
bb plugin config notes set directories "~/Notes"
bb plugin reload notes
```
