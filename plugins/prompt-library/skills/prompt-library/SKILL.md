---
name: prompt-library
description: Search prompt history and manage starred reusable prompts in BB.
---

# Prompt library

Open **+ → Prompts…** or press **Ctrl+R** in a composer. Search matches
saved titles, starred prompt bodies, and recent history. Select **Thread**, **Project**, or **All**;
the scope is remembered per composer kind on this device. The new-thread
composer offers Project and All. Arrow keys select, Tab switches scope, Enter
inserts, and Escape closes. Desktop shows a full Markdown preview beside the
list; narrow layouts open the preview when a row is tapped, with Back and Insert.

Click the star or press Cmd/Ctrl+S to star or unstar the selected prompt.
**Star current draft** saves the draft. Starred prompts keep text and mentions,
deduplicate by text, persist across reloads, and sort by most recent use.
Use **Add title** beside Starred and Insert in the preview footer, or click an
existing title above the preview, to name or
rename it. Titles are optional, trimmed, and limited to 120 characters. Save an
empty title to clear it; Escape cancels an edit. Titles appear above the body
preview and are never inserted into the composer. Renaming preserves the prompt
ID and usage history. Starring an already-saved body keeps its existing title.
History attachments are retained when restoring into an empty composer.
Starred prompts omit attachments. A nonempty composer receives text and mentions
at the kept cursor. Inserting never sends a message.

The server warms the history index when the plugin starts, fetching the newest
100 entries first and then older pages in the background. The picker returns
saved prompts and available history immediately, including in a fresh browser.
It updates while history loads and labels incomplete searches “Searching older
prompts…”. Concurrent requests share one refresh; successful refreshes are reused
for two seconds in the picker. Later refreshes fetch only newer prompts. On a
history failure, available prompts remain usable and Retry resumes loading. Each query word, ignoring case, must match a single word of the
prompt: exactly, as its start, with one typo (words of four or more letters),
inside it, or as an abbreviation that starts at its first letter (`tmln` finds
`timeline`). Letters are never matched across words. Results include up to 20
starred and 30 recent prompts in scope. Without a query, starred prompts come
first, then recent ones. A query returns one ranked list: exact title matches
first, then prompts that start with the query, then by match type in that order,
then starred prompts
and prompts of the composer's kind (prompts that started a thread in the
new-thread composer, follow-ups in a thread composer), then by relevance (rarer
words, repeated words, and shorter prompts score higher) decayed by age with a
seven-day half-life; a starred prompt's age counts from its last use.
A starred
prompt appears once, as its starred row. History contains user prompts; core records them without agent-only input. Prompts stay searchable until the server restarts, even if their
thread is deleted.

## CLI and SDK

- `bb prompts search [query...] [--project ID | --thread ID] [--composer new-thread|follow-up] [--partial] [--json]`; `--composer` defaults to `follow-up`
- `bb prompts list [--json]`
- `bb prompts star <text...> [--title "Title"] [--json]`
- `bb prompts title <id> <title...> [--json]` or `bb prompts title <id> --clear [--json]`
- `bb prompts unstar <id> [--json]`

Use `bb.sdk.plugins.callRpc({ pluginId: "bb--prompt-library", method, input })`:
`search` takes `{ query, scope: "thread" | "project" | "global", projectId, threadId, composer: "new-thread" | "follow-up" }`
with nullable IDs. It also accepts `waitForHistory` (default `true`) and
`refreshHistory` (default `true`). Set `waitForHistory: false` to return available
results immediately. Poll with `refreshHistory: false` while `loading` is true
to observe the in-progress work without starting another refresh. Use
`refreshHistory: true` to refresh or retry a failed background load. It returns `{ prompts, loading, historyError }`,
where `historyError` is null or a failure message. CLI search waits for complete
results by default; `--partial` returns the same progressive snapshot.
Each row has `kind: "starred" | "recent"`; `star` takes `{ prompt: { text, mentions }, title? }`; `setTitle` takes
`{ id, title }` (use `null` to clear) and returns `{ id, title }`. Search returns
`title` and highlighted `titleSnippet` on starred rows; CLI list and star JSON
also include `title`. `unstar` and
`markUsed` take `{ id }`.

The bundled plugin is disabled by default. Enable it in Settings → Plugins or
with `bb plugin enable bb--prompt-library`. Its Search prompts shortcut is
rebindable in Keyboard Settings. Plugins can page through the same core history
with `bb.sdk.experimental_promptHistory.list({ cursor, limit })`.
