# bb-plugin-simple-notes

Simple Notes is an Apple Notes-style local markdown notebook plugin, promoted
from the installed notes plugin used in bb.

- **Simple Notes nav panel** (`chrome: "none"`): a recent-first note list
  beside a focused Tiptap markdown editor. The selected note is stored in the
  panel's `subPath`, so deep links and browser back/forward work.
- **Local notebook folder**: the `directory` setting defaults to `~/Notes`
  and is created on load. Each note is a flat `.md` file in that folder.
- **Safe saves**: reads and writes go through `bb.sdk.files` with
  `expectedSha256` compare-and-swap. If the file changes on disk while it is
  open, the editor shows reload/overwrite controls instead of clobbering.
- **Autosave and title rename**: edits autosave after a short debounce and
  on Cmd/Ctrl+S. After saves, the backend renames the file to a kebab-case
  version of the first markdown line.
- **Markdown todos**: typing `[ ]`, `[x]`, or `- [ ]` creates task-list
  checkboxes in the rich editor.

Install from a bb checkout:

```
bb plugin install examples/plugins/simple-notes
bb plugin config simple-notes set directory "~/Notes"
bb plugin reload simple-notes
```
