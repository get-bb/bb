# Code Review Guide

Use this guide to find defects without expanding scope. The best review usually asks: what will break, and what is the smallest correction?

## Scope

- Stay inside the changed behavior.
- Expand only to prove a concrete correctness, security, or data-loss risk.
- Do not ask for architecture work when a local fix would be correct.
- Treat `AGENTS.md` as background guidance, not a checklist.

## Findings

Report findings before summaries. Order them by severity and include file and line references.

A useful finding explains:

- What can go wrong.
- Where it is introduced.
- What user-visible, persisted, security, or maintenance impact it has.
- What evidence supports the claim.

If there are no findings, say so directly and mention any meaningful test gap or residual risk.

## Check

- Does the change do what it claims to do?
- Are authorization, validation, query filters, ordering, pagination, and persistence correct at the layer that enforces them?
- Are changed route, command, event, and database fields implemented end to end?
- Are accepted fields actually used?
- Are defaults applied once at the boundary instead of hidden behind optional internal fields?
- Do tests assert outcomes that would fail for the bug or regression?

## Simplicity Red Flags

Flag these when they are not required for the current change:

- New descriptor tables, registries, coordinators, managers, generators, state machines, or dependency injection.
- New packages or cross-package contract moves.
- Compatibility adapters that keep old and new paths alive together.
- Generic helpers, options, config flags, or abstractions with one real caller.
- Broad migrations or backfills bundled with a local behavior change.
- File splits that increase the number of places a reader must visit without deleting an older path.

Put unrelated cleanup in follow-up notes.
