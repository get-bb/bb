# Docs vaults and editing

Status: **source-documented; live execution pending**.

## Setup and entry points

Open the Docs panel; bb docs --help. Add a disposable local vault containing Markdown, HTML, a folder, and an image; use a second host only when available.

Use the main skill’s isolated targets and evidence rules. A plugin can be present
in this checkout but disabled in an installation. Enable it only in the test
store before checking its surfaces. Read its current command/schema definitions
from the source below; CLI references use the matching source CLI described in
SKILL.md. Inspect nested `--help` before selecting flags and IDs.

## Source

- `plugins/docs/package.json`
- `plugins/docs/server.ts`
- `plugins/docs/app.tsx`

## Feature recipes

| Feature | Drive | Observable success |
| --- | --- | --- |
| Vault management | Add/list a local and a test-host vault, switch active vault, and remove one. | Vault name/root/host remain distinct; removing registration does not delete unrelated disk data. |
| Tree, search, and folders | Expand folders, search by name/content, create nested folders, and reload. | Tree and search resolve the correct vault path and reflect persisted files. |
| Create, edit, autosave | Create a note and edit paragraphs, headings, lists, code, links, tables, images, and frontmatter. | Saved Markdown retains supported content after reopening; UI save state matches disk completion. |
| Rename, move, delete | Rename/move a note and folder, cancel one deletion, then delete a fixture. | Paths and navigation update coherently; canceled deletion changes nothing. |
| HTML and openers | Open a synthetic HTML document and Markdown via file links and Docs routing. | Correct renderer opens at the selected vault/path; errors do not substitute another document. |
| Mentions and thread cards | Mention a note with @ and render a Docs directive; edit after selecting but before sending. | Resolved agent context follows send-time content; card/panel opens the referenced note and autosave reaches that file. |
| CLI read/write | List/read/write/mkdir/move/remove a fixture through bb docs; compare bytes in UI. | CLI and UI operate on the same vault revision and path. |
| Pull, status, push | Pull into a fresh directory, edit locally, inspect status, push, then exercise a remote revision conflict and explicit deletion. | Only intended changes reach the vault; stale writes conflict and deletion requires the documented explicit action. |
| Unavailable vault and invalid path | Disconnect the test host and request missing/out-of-root paths. | Errors identify the unavailable resource; no write escapes the vault root. |

## Evidence and cleanup

Record each row’s UI/tool/CLI action and observed result separately. Inspect the
registered plugin command and SDK call before claiming agent parity; do not
invent a plugin CLI where the feature uses a core command instead. Preserve
failed attempts and missing prerequisites as unverified results. Restore plugin
configuration and remove only this run’s fixtures, registrations, and workers.
External account changes use authorized disposable targets.
