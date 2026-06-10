# Environment Branch Display

## Goal

Make environment labels truthful and useful after checkout drift. Users should
be able to tell the difference between the stable branch/work-ref that identifies
an environment and the checkout state that is currently on disk.

This plan covers display, labels, and read models. New-thread checkout intent
and mutation safety are covered in `plans/local-checkout-creation.md`.

## Problem

- `environments.branchName` is stored as provisioning-time metadata, but UI
  surfaces use it as if it were both the environment name and the current
  branch.
- Thread lists join `environments.branchName` as `environmentBranchName`; the
  sidebar, worktree reuse picker, and follow-up composer use it as a recognizable
  label.
- Thread detail often derives branch from live `workspaceStatus.branch`, so
  detail can disagree with sidebar/reuse/follow-up surfaces after manual
  checkout drift.
- Detached HEAD, mid-rebase, conflicts, and unknown checkout states are not
  represented clearly in the display model.
- Branch divergence exists in workspace status, but labels do not consistently
  explain what branch/ref the comparison belongs to.

## Design

### Split Identity From Observation

Introduce two explicit concepts:

- Initial checkout identity: the branch/ref observed or created when BB first
  provisioned or attached the environment. This is stable and can remain the
  recognizable environment label.
- Current checkout observation: the latest daemon-observed checkout kind,
  branch/head SHA, dirty state, operation state, conflict state, divergence
  summary, and observed timestamp.

Migration can keep `environments.branchName` as a compatibility
denormalization for initial identity, but new display code should not treat it
as the current branch.

### Observation Shape

Reuse the shared checkout observation from the creation plan for environment
display:

```ts
type GitCheckoutRef =
  | { kind: "branch"; branchName: string; headSha: string | null }
  | { kind: "detached"; headSha: string | null }
  // HEAD names a branch, but the repository has no commit yet.
  | { kind: "unborn"; branchName: string | null }
  | { kind: "unknown"; reason: string };

type EnvironmentCheckoutObservation = {
  checkout: GitCheckoutRef;
  defaultBranch: string | null;
  hasUncommittedChanges: boolean;
  operation: WorkspaceGitOperation;
  observedAt: number;
};
```

The display model can add merge-base/ahead/behind information from existing
workspace status where appropriate.

### Label Rules

Use compact visible labels and move explanation into tooltips/details. For
unmanaged primary checkouts, current state is the primary signal:

- `Working locally` `main`
- `Working locally` `detached abc1234`
- `Working locally` `main` `Dirty`
- `Working locally` `feature/foo` `Rebase`
- `Working locally` `feature/foo` `Conflicts`
- `Working locally` `empty repo`

For managed worktrees, keep the stable work-ref label but show drift:

- No drift: `Worktree` `bb/my-task-thr_123`
- Drift: `Worktree` `bb/my-task-thr_123 -> feature/manual`
- Detached: `Worktree` `bb/my-task-thr_123 -> detached abc1234`
- Unhealthy: add `Dirty`, `Conflicts`, or `Rebase`.

For remote environments, use the same checkout chips:

- `Working remotely` `main`
- `Working remotely` `detached abc1234`

### Follow-Up Prompt Labels

`apps/app/src/components/promptbox/FollowUpPromptBox.tsx` should keep its
bottom row read-only. The `ThreadEnvironmentSummary` slot should evolve from a
naked optional `environmentBranchName` chip to structured chips:

- mode label: `Working locally`, `Working remotely`, or `Worktree`;
- stable identity chip when useful: `bb/my-task-thr_123`;
- current checkout chip when different or primary: `<branch>` or
  `detached <short-sha>`;
- compact state chips: `Dirty`, `Conflicts`, `Rebase`, etc.;
- copy actions should copy the specific value shown by each chip, not a stale
  generic branch field.

For worktrees with no drift and a healthy checkout, it is acceptable to keep a
compact single branch/work-ref chip to preserve density.

### Other Surfaces

Update these surfaces to use the same display model:

- sidebar project/thread grouping and worktree headers;
- `WorktreePicker` reuse options;
- thread detail environment/branch rows;
- secondary-panel git metadata;
- CLI `thread show` and `environment` output;
- git action dialogs where branch and merge-base information appears.

Each surface should choose density-appropriate rendering, but the semantics
must be consistent: stable identity is not current checkout.

### Drift Feedback

Drift should be shown only when meaningful:

- current branch differs from initial/work-ref branch;
- current checkout is detached/unborn/unknown;
- dirty/conflict/in-progress operation exists;
- observation is stale or unavailable and the UI would otherwise imply current
  state.

Do not over-label normal healthy managed worktrees. Preserve scanability.

## Implementation Phases

1. Add durable initial checkout/work-ref identity read model. Keep
   `environments.branchName` as compatibility during migration.
2. Add current checkout observation read model for environment/workspace
   display.
3. Build a shared display formatter in `@bb/core-ui` or a shared app/domain
   helper so labels are canonical.
4. Update `ThreadEnvironmentSummary` props from a single branch string to a
   structured environment checkout display model.
5. Update sidebar grouping, `WorktreePicker`, thread detail rows, secondary
   panel, and CLI output to use the formatter.
6. Add stories/tests for healthy, drifted, detached, dirty, conflicted, and
   rebase-in-progress environments.
7. Add realtime/cache invalidation so manual checkout changes refresh display
   observations.

## Exit Criteria

- A managed worktree created on `bb/task` and manually checked out to
  `feature/manual` shows both stable identity and current checkout.
- A local primary checkout shows `Current: <branch>` rather than a stale stored
  branch.
- Detached HEAD is shown as detached with short SHA where available.
- Mid-rebase and conflicted worktrees have explicit visible status chips.
- Follow-up prompt, sidebar/reuse picker, thread detail, and CLI use consistent
  language for stable identity vs current checkout.
- Users never have to infer from an env id when branch/work-ref identity is
  available.

## Validation

- `pnpm exec turbo run typecheck --filter=@bb/domain`
- `pnpm exec turbo run typecheck --filter=@bb/core-ui`
- `pnpm exec turbo run test --filter=@bb/core-ui --force > /tmp/core-ui-test-out.txt 2>&1`
- `pnpm exec turbo run test --filter=@bb/app --force > /tmp/app-test-out.txt 2>&1`
- `pnpm exec turbo run test --filter=@bb/server --force > /tmp/server-display-test-out.txt 2>&1`
- `pnpm exec turbo run test --filter=@bb/cli --force > /tmp/cli-test-out.txt 2>&1`
