# Docs Annotations

A locally maintained fork of BB Official Docs, with comments attached to selected Markdown passages. Annotation data is stored separately from document contents; comments follow document moves and renames, and are removed with deleted documents or vaults.

## Install in the packaged BB desktop

1. Record configured vault locations while official Docs is still enabled: `bb docs vaults --json`.
2. Disable official Docs: `bb plugin disable simple-notes`.
3. Install this fork: `bb plugin install git:https://github.com/robertsinke/bb.git@plugins/docs-annotations/v0.1.0 --subdirectory plugins/docs-annotations`.
4. Re-add the vault locations in the fork's Docs panel.

The fork uses plugin ID `docs-annotations` because BB reserves the official plugin's ID. Disabling official Docs does not delete its plugin data or modify Markdown files; re-enable it to return to the official version. The fork has a separate database and does not import the old vault configuration or proposals.

Select passage text in the Docs editor or an in-thread Docs preview to show BB's anchored **Add to chat** action. Choose it to open the comment card beside the selection. Saved comments highlight their passage; click a highlight to edit or delete it. Saving also adds a uniquely prefixed Docs comment pill to the current chat composer. When sent, the Docs mention resolves by ID into agent context with the quote, comment, and document path.

## Upstream baseline

This fork is based on the Docs plugin in BB commit `dbb247c60f46494579adb40b80efa7c8a861b35c`. Compare `plugins/docs` with `plugins/docs-annotations` when bringing in upstream changes, then keep the fork's distinct manifest, plugin ID, navigation target, SDK compatibility, and annotation changes.
