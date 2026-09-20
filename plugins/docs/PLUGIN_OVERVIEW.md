Keep your notes, plans, and reports as plain Markdown files on disk, and edit them inside bb. Documents stay ordinary files in folders you choose, on this machine or on any connected host.

## What you get

- A Docs panel with a folder tree, search, and a rich Markdown editor. Tables, images, and YAML frontmatter are supported.
- Vaults. Each vault is a folder on a host. A new install starts with a Personal vault at `~/Notes`. Add vaults on other machines that are enrolled as bb hosts.
- Full HTML pages and embedded HTML blocks render in a sandboxed frame. Keep interactive reports next to your notes.
- A Markdown opener for `.md` files from file links. Make it the default under Settings.
- `@` mentions. Type `@` in the composer to attach a document. The agent gets its current content at send time.
- Editable document cards in agent replies. Edit Markdown directly in the timeline or open the same document in a tab, with shared autosave.
- Review agent proposals with live diffs. Edit the proposed text, accept or reject it, undo or redo, or ask the agent for changes through a document mention.
- Copy the current draft from the header. Progress appears during saves and proposal actions, and recent documents stay visible when returning to a thread.

## For agents

Agents get the `docs` skill and the `bb docs` command. They list vaults with `bb docs vaults` and read files with `bb docs read`. They edit with `bb docs pull`, `bb docs status`, and `bb docs push`. Push uses version checks, so a concurrent edit is reported as a conflict instead of being overwritten.

Agents can propose changes with `bb docs propose` without replacing the saved document. Proposal updates and approval actions check versions to protect concurrent edits.
