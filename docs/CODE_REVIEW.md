# Code Review Guide

Use this guide to find defects without expanding scope. Prefer the simplest correct change.

## Review Scope

- Review the diff against the intended base. Use `git merge-base main <branch>` when reviewing a branch that may have diverged from main.
- Stay inside the changed behavior. Expand only to prove a concrete correctness, security, data, or lifecycle risk.
- If you are verifying a known fix and also doing a fresh review, keep those tasks separate so the known issue does not narrow the review.
- Treat `AGENTS.md` as background repo guidance, not a standalone checklist item.

## Findings First

Report findings before summaries. Order them by severity and include file and line references.

A useful finding explains:

- What can go wrong.
- Where it is introduced.
- What user-visible, persisted, security, or maintenance impact it has.
- What evidence supports the claim.

If there are no findings, say so directly and mention any meaningful test gap or residual risk.

## Correctness And Data Safety

- Does the change do what it claims to do?
- Trace edge cases: nulls, empty collections, missing rows, concurrent requests, retries, reconnects, and error paths.
- Follow untrusted input from the boundary through validation, mutation, persistence, and response.
- Check query filters, joins, pagination, ordering, authorization, and data-loss risk at the layer that enforces them.

## Contracts And Lifecycles

Review this section when the change touches routes, commands, events, database fields, async work, or the server/daemon boundary.

- Are changed fields implemented end to end?
- Are accepted fields actually used?
- Are defaults applied once at the boundary instead of hidden behind optional internal fields?
- For async work, is ownership clear, recovery idempotent, and lost command-result handling defined?
- Did responsibility stay on the correct side of the server/daemon boundary?

## Security

- Are authorization checks enforced server-side?
- Is user input validated before it reaches queries, commands, templates, or filesystem paths?
- Are secrets kept out of logs, errors, telemetry, and client responses?

## Tests

- Do tests assert outcomes instead of call sequences?
- Would the tests fail for the bug or regression the change is meant to prevent?
- Are database paths tested with in-memory SQLite rather than mocks?
- Are external systems mocked only at true boundaries such as network providers or timers?
- If a risky path is untested, is the reason explicit and credible?

## Simplicity

Default to fewer concepts, fewer surfaces, and fewer knobs.

- Flag complexity only when it affects this change or creates a real maintenance risk.
- Reject single-use abstractions, options, configuration, interfaces, registries, dependency injection, generics, or shared components.
- Direct local code is better than a shared helper that bends unrelated callers together.
- A small scoped workaround can be better than a broad architectural fix. Ask for the architecture change only when the workaround is riskier, larger, or leaks into future callers.
- Do not request cleanup unrelated to the changed behavior. If adjacent debt matters, call it out as follow-up.
