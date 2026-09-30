The sidebar thread list, as a plugin.

## What you get

- **Pinned** and **Threads** sections, plus the custom sections you create.
- Organize by project, by machine, or chronologically, with sort by updated, created, or title.
- Nested child threads, worktree grouping, drag to reorder, pin, nest, and move between sections.
- Inline rename, keyboard jump shortcuts, and the same status glyphs bb draws elsewhere.
- Agent provider icons before thread titles, controlled by Organize → Rows → Provider icons.

## How it works

The plugin reads bb's live thread view through the plugin SDK and stores your layout choices (organization, sort, section order, collapsed groups) in its own storage, synced to every open window. Sections and thread moves go through bb's public API, so `bb thread section` and this list always agree.

Disable the plugin to hide the list; another thread-list plugin can take its place under Settings → Appearance.
