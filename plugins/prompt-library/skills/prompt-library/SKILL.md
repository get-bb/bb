---
name: prompt-library
description: Search prompt history and manage starred reusable prompts in BB.
---

# Prompt library

Open **+ → Prompts…** or press **Ctrl+R** in a composer. Search fuzzy-matches
starred prompts and recent history. Select **Thread**, **Project**, or **All**;
the scope is remembered per composer kind on this device. The new-thread
composer offers Project and All. Arrow keys select, Tab switches scope, Enter
inserts, and Escape closes. Desktop shows a full Markdown preview beside the
list; narrow layouts open the preview when a row is tapped, with Back and Insert.

Click the star or press Cmd/Ctrl+S to star or unstar the selected prompt.
**Star current draft** saves the draft. Starred prompts keep text and mentions,
deduplicate by text, persist across reloads, and sort by most recent use.
History attachments are retained when restoring into an empty composer.
Starred prompts omit attachments. A nonempty composer receives text and mentions
at the kept cursor. Inserting never sends a message.

The plugin loads the newest 1000 prompts, fetches only newer prompts on later
searches, and loads older pages only when a search finds fewer than 30 matches.
It fuzzy-ranks the loaded prompts in scope, returning up to 20 starred and 30
recent results. History contains user prompts; core records them without agent-only input. Prompts stay searchable until the server restarts, even if their
thread is deleted.

## CLI and SDK

- `bb prompts search [query...] [--project ID | --thread ID] [--json]`
- `bb prompts list [--json]`
- `bb prompts star <text...> [--json]`
- `bb prompts unstar <id> [--json]`

Use `bb.sdk.plugins.callRpc({ pluginId: "bb--prompt-library", method, input })`:
`search` takes `{ query, scope: "thread" | "project" | "global", projectId, threadId }`
with nullable IDs; `star` takes `{ prompt: { text, mentions } }`; `unstar` and
`markUsed` take `{ id }`.

The bundled plugin is disabled by default. Enable it in Settings → Plugins or
with `bb plugin enable bb--prompt-library`. Its Search prompts shortcut is
rebindable in Keyboard Settings. Plugins can page through the same core history
with `bb.sdk.experimental_promptHistory.list({ cursor, limit })`.
