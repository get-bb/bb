# Goals Feature — Implementation Plan

## Objective
Surface Codex "goal" events in the bb app as a collapsible **goal card** in the
prompt stack above the composer, matching the approved mockup
(`goals-mockup-v2.html`: collapsed + expanded states, light/dark).

Codex's app-server already emits `thread/goal/updated` and `thread/goal/cleared`
notifications (generated type `ThreadGoal`), but bb currently **discards** them
(visibility = "noise", `translateCodexEvent` returns `[]`, and
`adapter.test.ts` asserts they are ignored). We will:
1. Regenerate the Codex app-server bindings.
2. Translate goal events into bb's internal event model and expose the current
   goal as a **tail-only timeline projection** (mirroring `pendingTodos`).
3. Render the goal card in the frontend.

## Division of labor
- **Codex worker** (provider `codex`, runs in env `env_q9sv4is5we`): all
  server/daemon work below. Does NOT touch `apps/app`. Does NOT commit/push.
- **Claude (me)**: frontend UI in `apps/app`, final integration, typecheck,
  commit, PR.

## Authoritative contract (both sides build against this)

New domain schema `packages/domain/src/thread-timeline-goal.ts`:
```ts
export const threadTimelineGoalStatusSchema = z.enum([
  "active", "paused", "budgetLimited", "complete",
]);
export const threadTimelineGoalSchema = z.object({
  sourceSeq: z.number().int().nonnegative(),
  updatedAt: z.number(),
  objective: z.string(),
  status: threadTimelineGoalStatusSchema,
  tokenBudget: z.number().nullable(),
  tokensUsed: z.number(),
  timeUsedSeconds: z.number(),
});
export type ThreadTimelineGoal = z.infer<typeof threadTimelineGoalSchema>;
```

Add to `threadTimelineResponseSchema`
(`packages/server-contract/src/api/threads.ts`), alongside `pendingTodos`:
```ts
goal: threadTimelineGoalSchema.nullable(),
```
`null` when no goal is active (none set, or last event was `cleared`). Populated
only on `latest`-page requests, exactly like `pendingTodos`.

New provider events (`packages/domain/src/provider-event.ts`,
`providerEventTypeValues` + data map):
- `thread/goal/updated` — data = `{ objective, status, tokenBudget, tokensUsed, timeUsedSeconds }`
  (the bb-facing subset of Codex `ThreadGoal`).
- `thread/goal/cleared` — data = `{}`.

## Tasks — Server (codex worker)
1. **Regenerate** Codex app-server bindings per
   `packages/agent-runtime/src/codex/generated/codex-app-server/README.md`
   (`codex app-server generate-ts --out <tmp>`, copy into `schema/`, rewrite
   imports to `.js`, re-prune to the reachable subset, drop barrels). Best
   effort: if the local `codex` binary lacks `generate-ts`, note it and proceed
   — the goal types (`ThreadGoal`, `ThreadGoalUpdatedNotification`,
   `ThreadGoalClearedNotification`, `ThreadGoalStatus`) already exist in the
   committed schema.
2. **Domain**: add `thread-timeline-goal.ts` (above) and export it from the
   domain index. Add the two provider event types + data schemas to
   `provider-event.ts`.
3. **Server contract**: add `goal: threadTimelineGoalSchema.nullable()` to
   `threadTimelineResponseSchema`.
4. **Translate**: in `packages/agent-runtime/src/codex/event-translation.ts`,
   map Codex `thread/goal/updated` → bb `thread/goal/updated` and
   `thread/goal/cleared` → bb `thread/goal/cleared` (instead of `[]`). Flip
   visibility for both from "noise" to "normalized" in `visibility.ts`.
5. **Projection**: add a tail-only goal projection mirroring
   `todo-snapshot-extraction.ts` + wherever `pendingTodos` is assembled into the
   timeline response. Latest `goal/updated` wins; a later `goal/cleared` resets
   to `null`.
6. **Tests**: update `adapter.test.ts` (goals now translate, not ignored) + add
   a projection test (updated → goal present; cleared → null).
7. Typecheck + test the touched server packages (see Validation). Leave all
   changes in the working tree (no commit). Report the FINAL contract actually
   shipped (field names/types) and the list of changed files.

## Tasks — UI (me, Claude)
1. Presentational `ThreadGoalCard` in
   `apps/app/src/components/promptbox/banner/`, following `PromptStackCard` +
   `ThreadPromptContextBanner` patterns (Hugeicons via `components/ui/icon`,
   `text-xs`/sanctioned tokens, collapse/expand like the todo section). Collapsed
   = objective + status chip; expanded = objective + token/time usage. Match
   `goals-mockup-v2.html`.
2. Thread `goal` from `useThreadTimelinePages` → `ThreadDetailView` →
   `ThreadDetailPromptArea`, and add `<ThreadGoalCard>` to the `promptStack`
   memo (before `QueuedMessagesList`).
3. Typecheck `@bb/app`.

## Exit criteria
- `pnpm exec turbo run typecheck` passes for `@bb/agent-runtime`, `@bb/domain`,
  `@bb/server-contract`, the server package, and `@bb/app`.
- `pnpm exec turbo run test --filter=@bb/agent-runtime` passes (goal translation
  + projection tests).
- Codex goal events flow: app-server → translate → stored event → tail
  projection → `ThreadTimelineResponse.goal` → goal card renders.
- No edits to the "set goal" affordance (display-only; goals originate from the
  provider).

## Validation
```bash
pnpm install   # fresh worktree has no node_modules
pnpm exec turbo run typecheck --filter=@bb/domain --filter=@bb/server-contract --filter=@bb/agent-runtime --filter=@bb/app
pnpm exec turbo run test --filter=@bb/agent-runtime > /tmp/agent-runtime-test.txt 2>&1
```

Delete this plan file once the feature is merged.
