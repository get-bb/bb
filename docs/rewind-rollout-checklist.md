# Rewind rollout checklist

This is the release runbook for graduating native thread rewind from the
`rewind` experiment. It names owners, evidence, rollback steps, and
graduation thresholds. User and developer context: [rewind.md](rewind.md) and
[rewind-developer.md](rewind-developer.md).

## Owners

| Role                                                    | Owner                                             |
| ------------------------------------------------------- | ------------------------------------------------- |
| Experiment gate + metrics                               | Server team (apps/server rewind service + routes) |
| Provider adapters (Codex fork, Claude point-in-history) | Provider adapters team                            |
| Migrations + projections                                | DB team (@bb/db)                                  |
| UI entry points + recovery banner                       | Frontend team (apps/app)                          |
| Rollout decision                                        | Product owner of BB core                          |

## Gate status

**Current state (2026-08-10):** experiment gate, privacy-safe metrics, and
docs landed on the `rewind-rollout` branch at the integrated tip `a77dfb5`.
The experiment defaults to off. Do not flip the default until the soak
thresholds below pass.

## Evidence required before internal enablement

- [ ] `pnpm exec turbo run typecheck --filter=@bb/db --filter=@bb/domain
--filter=@bb/server-contract --filter=@bb/server --filter=@bb/app
--filter=@bb/cli` passes on the rollout branch.
- [ ] `@bb/db` full suite passes (migration 0090 applies cleanly on a copied
      production database and on a fresh database).
- [ ] Server rewind tests pass: gate (403 `experiment_disabled`), preview
      denial counter, provider-branch failure counter, activation failure
      counter, edited-turn failure counter, restore counter, orphan-cleanup
      counter.
- [ ] UI: pencil action absent while the experiment is off; recovery banner
      still renders for threads with branch history; Settings → Experiments
      shows the Rewind toggle.
- [ ] CLI: `bb thread rewind --preview` works; `bb thread rewind` with
      `--prompt` and `--idempotency-key` returns `experiment_disabled` while the
      experiment is off.

## Internal soak (2 weeks, real threads)

- Enable the experiment for internal users. Keep the default off for
  everyone else.
- Exercise on real Codex and Claude Code threads: rewind mid-thread, rewind
  the second message, restore after a rewind, and kill/restart BB between
  provider branching and edited-turn submission.
- Track `GET /api/v1/system/rewind-rollout-metrics` daily.

## Graduation thresholds

Remove the experiment only when ALL of the following hold:

- [ ] At least 20 rewinds on real Codex threads and 20 on real Claude Code
      threads, with zero unresolved `activation_failure` or
      `edited_turn_failure` events.
- [ ] At least 5 restores exercised in live use (the recovery path the
      experiment exists to prove).
- [ ] `provider_branch_failure` rate below 5% of commit attempts, and every
      failure left the original branch untouched (verified via branch lineage).
- [ ] No orphaned provider sessions left behind after restart recovery:
      `orphan_cleanup` count matches abandoned branches with pending cleanup
      within 24 hours.
- [ ] Zero data-loss incidents: no thread lost events, active pointer, or
      branch history across the soak.
- [ ] UI/UX sign-off on the confirmation copy, the rewind boundary row, and
      the recovery banner.

## Rollback procedures

### Disable the experiment (fast path, no deploy)

Turn the Rewind toggle off (Settings → Experiments, or
`bb settings experiment rewind false`):

- New rewinds stop immediately (UI hides the pencil; API returns
  `403 experiment_disabled`; the denial is counted).
- Existing branch history remains visible and restorable; nothing is
  deleted. The active pointer is unchanged.
- Migrations stay applied; no data is lost or reverted.

### Roll back the code (deploy path)

1. Revert the `rewind-rollout` merge with `git revert`, or cherry-pick the
   pre-rollout tip back onto `main`.
2. Migrations are additive only (0090 adds a column and a metrics table).
   If a full downgrade is required, drop the `rewind` column and
   `rewind_rollout_metrics` table only after confirming no thread depends on
   an active rewound branch; downgrades that would strand active branches
   are not supported — restore the affected threads to a pre-rewind branch
   first.
3. Verify `bb status`, server startup, and one send/turn cycle before
   announcing.

### Incident triggers for automatic disable

- Any `activation_failure` or `edited_turn_failure` that left a thread stuck
  in `starting` for more than one hour.
- Any lost event, missing active pointer, or missing branch history on a
  rewound thread.
- Any leak of provider checkpoint/session identifiers into logs, events, or
  API responses.

## Post-graduation

- Remove the experiment gate (default the flag to on and drop the gate
  checks after the feature is proven) in a separate change.
- Keep the metrics counters; they become operational telemetry.
- Update this checklist with the actual soak evidence and dates.
