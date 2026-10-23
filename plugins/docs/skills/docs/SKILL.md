---
name: docs
description: "Read, edit, or save documents in BB Docs vaults, including documents supplied through Docs mentions."
---

# Docs

Docs is the user's filesystem-first document library. Documents can live on
the server machine or another connected host, but the `bb docs` command
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
bb docs pull plans/release-plan.md --vault personal --into ./docs-work
# Edit ./docs-work/plans/release-plan.md with normal file tools.
bb docs status ./docs-work --diff
bb docs push ./docs-work
```

`bb docs status` exits 0 when no changes exist. It exits 4 when it finds
changes that the output describes. Exit 4 is a successful status result.
Review that output, then run `bb docs push` as a separate command. Do not
connect the status and push commands with `&&`.

Pull a folder subtree with `--folder`, or the whole selected vault with
`--all`:

```sh
bb docs pull plans --folder --vault personal --into ./docs-work
bb docs pull --all --vault personal --into ./docs-work
```

Always edit the pulled files with ordinary workspace tools, then run `status`
before `push`. The manifest in `.bb-docs-state.json` records stable vault paths
and remote SHA-256 versions; do not edit it. Pull and push fail closed with
exit 3 when both the local and vault copies changed. Resolve the content
manually, then pull or push again. `push --dry-run --diff` previews without
writing. Inside a thread the workspace is on the thread's host; a standalone
CLI call targets the server machine unless it passes `--workspace-host <id>`.

Local file and empty-directory deletions are ignored by default. Only use
`push --delete` when the user explicitly asked to delete the corresponding
vault paths. A pulled folder root is intentionally retained; pull its parent or
the whole vault to remove that folder. Binary assets round-trip with their
original bytes. If state is malformed, preserve the directory for recovery and
pull into a new clean `--into` directory.

The direct `write`, `mkdir`, `move`, and `remove` commands are deprecated. Do
not use them for agent edits; they remain temporarily available only for
backward compatibility.

Run `bb docs --help` for the command list and `bb docs <command> --help` for a
command's arguments, options, and rules. Each command accepts only the options
its help lists; an unknown command, unknown option, or stray argument exits 2
before touching a vault, and with `--json` the failure also prints
`{"ok":false,"error":{"code","message","hint"?}}` on stdout.

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
known. Markdown cards are editable and autosave in the timeline; Open in tab opens
the same document in Docs. Use the directive for both
Markdown documents and full HTML artifacts.

## Propose changes for approval

When the user asks to update a mentioned document or revise a pending proposal,
keep the saved file intact and propose the revision for approval. Read the
current file and proposal first, write the complete candidate into a workspace
Markdown file, then run:

```sh
bb docs read letter.md --vault personal --json
bb docs proposal letter.md --vault personal --json
bb docs propose letter.md --vault personal --file ./candidate.md --expected-sha256 HASH --version N --json
```

Use `--version none` only when `proposal` returned null. Otherwise pass its exact
version, including when the previous proposal was rejected or accepted. Use the
hash from the current document read. A conflict means the user changed the
file or proposal while you worked: read again and reconcile your revision;
never retry automatically using a newer version. A Docs mention includes the
current file and proposal metadata to support this workflow.

Return the usual `::docs` directive. The user can accept, reject, edit the
candidate, or ask for further changes. Do not run `accept` on the user's behalf
unless explicitly asked.

```sh
bb docs proposal-update <path> --content <markdown> --version N [--vault <id>] [--json]
bb docs accept|reject|undo|redo <path> --version N [--vault <id>] [--json]
```

`proposal-update` replaces only the pending candidate. The resolution commands
perform the same actions as the card's buttons. Existing pull/edit/push remains available for direct
changes the user requested without proposal review.

## Inline comments

When asked to address feedback, list comments first:

```sh
bb docs comments list <path> --vault <id> --status all --json
bb docs comments add <path> --vault <id> --quote "exact visible text" --body "…" --json
bb docs comments reply <path> <comment-id> --vault <id> --body "…" --json
bb docs comments resolve <path> <comment-id> --vault <id> [--reopen] --json
bb docs comments list <folder> --vault <id> --folder --json
bb docs comments keep <path> --vault <id> --json
bb docs comments leave <path> --vault <id> --json
bb docs comments read-file <sidecar-path> --vault <id> [--json]
```

The default list status is `open`; use `resolved` or `all` to include resolved
threads. JSON includes the sidecar hash, messages, and each anchor's state,
quote, source line, and visible UTF-16 offsets. A comment re-anchors only when
its quote and surrounding context appear exactly once; edited or duplicated
text makes it `orphaned` with null offsets, never a different sentence. Its
discussion still exists and can be replied to, resolved, or deleted.

Comments stay bound to a document only while Docs knows its identity: Docs
records the document hash it last saw. **Edit commented documents with
`bb docs write`, `bb docs push`, or `bb docs propose`, never by writing the
file directly**, so their comments stay bound. After an outside change, list
returns no threads and `outsideChange: N`; ask the user before running
`comments keep` (bind them to the current text) or `comments leave`. Renames
and moves through Docs or `bb docs move` carry comments. Deletions through
Docs or `push --delete` move them to the vault's orphan area, and external
moves leave them stranded. `--folder` lists these comments without a document
(`.` means vault root), and `comments read-file` shows one. They are
read-only; only the user deletes them.

Use visible text, without Markdown syntax or frontmatter, for `--quote`.
Repeated quotes fail with `ambiguous_quote` and occurrence numbers with source
lines; select one using `--occurrence N` (1-based). Missing quotes fail with
`quote_not_found`. Mutations retry sidecar hash conflicts up to three times,
then exit 3 with `conflict`. Malformed sidecars are never overwritten.

Authorship comes from the invoking `BB_THREAD_ID`. A mention written as
`@[Thread title](thread:thr_ID)` sends the saved comment to that thread with
attribution. A comment context names the vault, path, and comment ID: answer
with `bb docs comments reply`. Reply to questions and unclear requests and
leave them open. For a clear request, propose the document edit with
`bb docs propose`, reply with what changed, and resolve the comment.

Comments on files opened outside a vault accept `--source '<JSON>'` instead
of `--vault`, using the source object supplied in the comment context.
Never edit `.bb-comments/` files directly and never delete comments. Comments
live in hidden JSON sidecars beside Markdown files; document bytes, vault sync,
and existing vault settings are unaffected. HTML pages do not support comments.
