# Plan: thread provider/model visibility (issue #8099)

Expose a thread's stored model override and reasoning level override on the
Thread DTO and through the plugin SDK / `bb thread show` CLI output.

## Files

1. `packages/domain/src/thread.ts` — add optional nullable strings
   `modelOverride` and `reasoningLevelOverride` to `threadSchema` (~lines 112-135),
   mirroring the existing field style (e.g. `title: z.string().nullable()`).
   `threadListEntrySchema` inherits them via `threadWithRuntimeSchema`.
2. `packages/db/src/schema.ts` — no change; columns `model_override` and
   `reasoning_level_override` already exist on the threads table (confirmed
   via `grep -n "model_override\|reasoning_level_override" packages/db/src/schema.ts`).
3. `packages/db/src/data/threads.ts` — row->domain mapper
   (`toThreadWithPendingInteractionState`, ~line 800) spreads the row, which
   already includes the two columns; verify the new DTO fields flow through and
   extend the row->domain mapping if anything is dropped.
4. `packages/server-contract/src/api/threads.ts` — `threadResponseSchema` and
   the `threadListEntrySchema`-based response(s) the CLI consumes inherit the
   two fields via `threadWithRuntimeSchema`/`threadListEntrySchema`; confirm
   the optional fields survive the response schema.
5. `apps/server/src/services/threads/thread-runtime-display.ts` —
   `toPublicThread` (~line 147) explicitly picks fields; pass `modelOverride`
   and `reasoningLevelOverride` through.
6. `apps/cli/src/commands/thread/show.ts` — print `Model: <modelOverride>` and
   `Reasoning: <reasoningLevelOverride>` lines when non-null, following the
   existing label-column style in `printThreadStatus`.
7. Tests — extend `apps/cli/src/__tests__/command-output/thread-show.test.ts`
   (fixture helper `makeThread` in
   `apps/cli/src/__tests__/helpers/command-output-fixtures.ts` — add the two
   fields there) covering: values shown when set, omitted when null. If
   `packages/db` has a mapper test file for `data/threads.ts`, extend it too.

## Deferred

Reading the *effective* model from the host daemon's ACP session state
(turn requests store execution options per #7958) is explicitly deferred — not
implemented in this change.

## Test plan

- `pnpm --filter @bb/domain test` (or targeted vitest run for the domain)
- `pnpm --filter @bb/db test` (targeted mapper test if present)
- `pnpm --filter @bb/server-contract test` if a schema test exists
- `pnpm --filter bb-cli test` — `thread-show.test.ts` (targeted)
