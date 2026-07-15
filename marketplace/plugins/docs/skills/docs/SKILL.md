---
name: docs
description: Access and update the user's Docs vaults. Use whenever the user asks to read, find, create, update, or store a note, document, plan, or HTML artifact; when a Docs @-mention appears in context; or when an answer should link to a document the user can open in Docs.
---

# Docs

Docs is the user's filesystem-first document library. Documents can live on
the primary machine or another connected host, but the `bb docs` command
handles that routing through named vaults.

## Access documents

Start with the smallest useful lookup:

```sh
bb docs vaults --json
bb docs list --vault <vault-id> --json
bb docs read <path> --vault <vault-id>
```

Use the path and vault exactly as returned. Paths are relative to the vault;
do not guess an absolute host path or inspect the vault outside `bb docs`.

## Docs @-mentions

A Docs mention resolves at send time and appears in agent context as a
`Docs document (<vault>/<path>)` block. Treat that block as user-provided
source material from their document library:

- Read and use its current contents even if the prompt only says “this” or
  “the attached doc.”
- Preserve its meaning and distinguish its claims from your own inference.
- Do not rewrite the mentioned document unless the user asks you to change it.
- When your answer refers the user back to it, emit a Docs directive rather
  than an opaque filesystem path.

## Create and update documents

Docs is a good destination for durable plans, specifications, write-ups, and
HTML artifacts the user should be able to reopen.

```sh
bb docs write plans/release-plan.md --vault personal --content '# Release plan'
bb docs mkdir artifacts --vault personal
bb docs write artifacts/report.html --vault personal --content '<!doctype html>…'
bb docs remove artifacts --vault personal --recursive
```

`remove` deletes files and empty directories without a flag. Use
`--recursive` only when deleting a non-empty directory tree.

Use Markdown for documents and plans. Use a self-contained `.html` file for a
visual artifact or interactive report; relative assets can live beside it.
Only write into Docs when the user asks to create, save, store, or update
something there.

## Link documents in responses

Emit this leaf directive on its own line:

```md
::docs{vault="personal" path="plans/release-plan.md" title="Release plan"}
```

`vault` and `path` are required. Include a short human-readable `title` when
known. The rendered card opens an editable, autosaving document in the thread
side panel; its secondary action opens the full Docs editor. Use the directive for both
Markdown documents and full HTML artifacts.
