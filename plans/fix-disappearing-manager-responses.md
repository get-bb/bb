# Keep manager responses visible across child lifecycle steers

## Goal

Prevent a child lifecycle notification from removing a parent assistant response that the user already saw. Preserve each Pi assistant output as a separate canonical timeline item when one steered turn contains several assistant messages.

## Scope

### Completed-turn projection

- Treat these accepted system-steer message kinds as visible exchange boundaries:
  - `child-needs-attention`
  - `child-completed`
  - `child-failed`
  - `child-interrupted`
  - `child-outcome-batch`
- Keep the assistant or error message immediately before the boundary visible when the turn changes from active to completed.
- Keep the child lifecycle message visible in source order.
- Continue to fold `unlabeled` system steers and other housekeeping or reconnect messages.
- Do not change ordinary tool/activity collapsing or broaden this change to every system or agent steer.

### Pi assistant item identity

- Use Pi's assistant `message_start` boundary to close any open assistant stream before the new assistant message starts.
- Let the shared delta assembler mint a new item id for the new assistant stream.
- Keep `agent_end` as the terminal close for the last assistant message.
- Do not add provider-specific item ids or weaken resolved-delta pruning.

This boundary rule must support two assistant messages in one steered turn with no tool call between them. The first completion must not prune the second message or replace the first message's text.

## Implementation seams

- `packages/thread-view/src/timeline-message-helpers.ts`
  - Add a narrow helper for the five child lifecycle system-message kinds.
  - Use the helper when deciding whether a system steer is groupable and whether a boundary preserves the preceding terminal message.
- `packages/thread-view/src/completed-turn-grouping.ts`
  - Preserve the preceding terminal assistant/error at a child lifecycle boundary.
- `packages/agent-runtime/src/pi/delta-translation.ts`
  - Parse assistant `message_start` events.
  - Emit an assistant `message.close` without final text. The assembler will close an existing stream from its accumulated text and do nothing when no stream is open.
- Tests should use existing helpers and public routes rather than test-only production hooks.

## Regression tests

1. Pi translator regression
   - Start one Pi turn.
   - Stream a detailed assistant response.
   - Emit a second assistant `message_start` without a tool boundary.
   - Stream a short second response and finish the turn.
   - Assert the first and second assistant events use different item ids and both complete with their own text.

2. Thread-view cproxy regression
   - Child agent tell starts the parent turn.
   - Parent emits a detailed assistant response.
   - Accepted `child-completed` system auto-steer enters the same turn.
   - Parent emits a short final response and the turn completes.
   - Assert the detailed response, lifecycle message, and short response remain top-level and in order.

3. Thread-view Terminal-Bench regression
   - Stream the first assistant item across the accepted child lifecycle request.
   - Add a tool boundary and a later assistant item.
   - Complete the turn.
   - Assert the full first response remains top-level rather than moving under the completed-turn summary.

4. Control regression
   - Repeat the completed-turn shape with an accepted `unlabeled` system steer.
   - Assert the housekeeping message remains folded under the completed-turn summary.

5. Public timeline regression
   - Persist provider-shaped cproxy and Terminal-Bench event sequences through the real database and timeline route.
   - Assert the completed public timeline keeps the previously visible assistant response and uses distinct row ids.
   - Where the test runs resolved-delta pruning, assert both assistant texts remain recoverable after pruning.

## Validation

Run with Turbo:

```bash
pnpm exec turbo run test --filter=@bb/agent-runtime --force -- --run src/pi/delta-translation.test.ts
pnpm exec turbo run test --filter=@bb/thread-view --force -- --run test/completed-turn-grouping.test.ts test/completed-turn-summary-rendering.test.ts
pnpm exec turbo run test --filter=@bb/server --force -- --run <public timeline regression test>
pnpm exec turbo run typecheck --filter=@bb/agent-runtime --filter=@bb/thread-view --filter=@bb/server
pnpm exec turbo run lint --filter=@bb/agent-runtime --filter=@bb/thread-view --filter=@bb/server
git diff --check
```

If Turbo does not forward focused Vitest arguments for a package, run the package's full Turbo test task instead of bypassing Turbo.

## Acceptance checks

- A child lifecycle auto-steer cannot remove a parent assistant response from the completed top-level timeline.
- All five child lifecycle kinds use the same boundary rule.
- `unlabeled` and reconnect/housekeeping system steers keep their current folded behavior.
- Two Pi assistant messages in one steered turn without a tool have different item and timeline row ids.
- Resolved-delta pruning cannot replace the first assistant text with the second assistant completion.
- Public timeline output agrees with thread-view unit projection.
- No running BB process is restarted or reloaded.
- No commit, push, issue, PR, merge, deployment, or release is created.
