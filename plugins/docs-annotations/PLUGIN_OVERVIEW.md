BB Official Docs fork with comments attached to selected Markdown passages. Annotations are stored separately from documents, follow document moves and renames, and are removed with deleted documents or vaults.

- Selecting text in Docs or an in-thread Docs preview shows the anchored `Add to chat` action; it opens a comment card beside the passage.
- Saved passages highlight in the editor and reopen on click.
- Each comment gets a `doc-`-prefixed ID, persists separately from Markdown, and is added as a Docs pill to the current chat composer. Sending resolves the quote, comment, and document path into agent context.
- Preserves the official Docs vault, editor, file opener, mentions, and proposal workflows.
- Runs as `docs-annotations` beside BB's reserved `simple-notes` ID; disable official Docs before installation to avoid a duplicate `bb docs` command.
- Fork baseline: BB commit `dbb247c60f46494579adb40b80efa7c8a861b35c`.
