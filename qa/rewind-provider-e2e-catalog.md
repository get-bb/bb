# Rewind provider E2E catalog (BB-14)

Purpose: validate the complete exact-conversation-rewind user flow against
current Codex and Claude Code runtimes on a real host (live daemon, real
provider sessions). This catalog is the evidence matrix for BB-14 and must be
run on Adam's Mac (host) — not in a sandbox without provider daemons.

## Environment

- A checkout of `rewind-foundations` (or later) with `pnpm install` and the
  dev server + host daemon running (`pnpm dev`).
- Real `codex` CLI (current) and Claude Code (current Agent SDK) installed and
  logged in.
- A project with a managed worktree; one thread per provider for the happy
  path, plus scratch threads for destructive scenarios.
- Experiment flag for rewind enabled (see BB-15) so the UI entry points
  render.

## Scenario matrix (per provider: Codex, Claude Code)

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 1 | Middle-turn rewind happy path | Start thread, send 3 user turns, edit turn 2 via the pencil, confirm, wait for the edited turn to complete | Turns 3+ leave the active path; edited turn 2 is active; boundary divider rendered; banner offers restore |
| 2 | First-message replacement | Edit turn 1 (thread-start) | Fresh provider session established without generating a first turn; edited message runs; thread ID unchanged |
| 3 | Missing historical checkpoint | On a pre-existing thread created before this build, try to edit a middle turn | Preview denies with `missing-provider-checkpoint`; no pencil renders |
| 4 | Compaction boundary | Force provider compaction, then try to edit a turn before the compaction | Preview denies with `compaction-boundary` |
| 5 | Attachments and mentions | Edit a turn that referenced attachments/mentions | Preview denies with `attachments-not-supported` / `mentions-not-supported`; structured draft round-trip preserves text input |
| 6 | Repeated rewind | Rewind turn 2, then rewind turn 1 of the rewound branch, then restore the original branch, then rewind again | Every projection (timeline, search, output, goals) follows the active branch; no duplicate/missing rows in pagination |
| 7 | Restart mid-branch | Rewind, then restart BB server + host daemon + provider runtime, then continue the edited turn | Resume uses the correct provider branch; no false `starting` state; idempotent retry settles |
| 8 | Provider branch failure | Kill the provider session mid-rewind (or use an unavailable provider) | Original branch stays active; durable abandoned record; structured error surfaced; no orphan provider session left after cleanup sweep |
| 9 | Edited-turn submission failure | Interrupt right after activation (e.g. daemon stop) | Thread lands idle on the rewound branch; draft preserved in composer with recovery copy; retry succeeds |
| 10 | Workspace stability | Run rewinds with uncommitted workspace edits and Claude file checkpoints | Workspace files and Claude file checkpoints untouched; BB thread id/title/section/task links/panes unchanged |
| 11 | Side chats and forks | Open a side chat from a thread, rewind the source thread, verify side chat history still resolves its historical source | Source-fork provenance points at the pre-rewind branch; side chat survives |
| 12 | Accessibility + compact viewport | Keyboard-only rewind (Escape cancels, Enter confirms), narrow viewport with overflow action | Action reachable via keyboard; compact overflow menu exposes edit; banner copy visible |

## Restart resume check (scenario 7 detail)

1. Rewind and commit; wait for the edited turn to be accepted.
2. `pnpm dev:restart` (server + host daemon), and restart the provider CLI
   process if it exited.
3. Continue the edited turn; confirm the provider session is the forked
   branch (Codex: forked thread id; Claude: forked session id) and that the
   timeline shows only the active lineage.
4. Confirm `bb thread log` shows the operation events
   (`provider-branch-pending` → `activated` → `submitted`) without duplicates.

## Evidence required for BB-14

- Pass/fail per scenario per provider, with reproduction notes.
- Log excerpts for any provider-specific failure (no prompt content in
  screenshots; redact raw checkpoint IDs).
- Screenshots: pencil affordance, confirmation banner, boundary divider,
  recovery banner, restore confirmation.
- One restart-resume capture per provider.
- Confirm Claude file checkpoints untouched (list before/after).

## Prerelease gate

BB-14 is complete only when scenarios 1, 2, 6, 7, 10, 11 pass for both
providers, and the remaining scenarios have documented outcomes attached.

