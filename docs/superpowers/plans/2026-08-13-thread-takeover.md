# Thread Takeover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user or agent move an existing BB thread to a chosen provider/model in one action, while keeping the source recoverable until the replacement provider has genuinely started.

**Architecture:** Add one deep server-owned handoff module behind a typed public route. The module validates the source and target execution tuple, creates a normal visible thread in the same environment with a typed source-thread mention, and persists a small handoff record. Existing thread lifecycle events settle that record: the first accepted root `turn/started` archives the source, while terminal start failure leaves it live. SDK, CLI, and app are thin adapters over the same operation.

**Tech Stack:** TypeScript, Hono typed routes, Zod, Drizzle/SQLite, BB SDK, Commander, React, TanStack Query, Vitest, Testing Library, Turbo.

---

## Product invariants

- The replacement is a fresh normal thread, not a native provider fork. Cross-provider private session state is never claimed to transfer.
- Source archival is server-owned and occurs only after the replacement's accepted root `turn/started` event.
- Creation failure, provider start failure, server restart, and duplicate submission cannot archive the source early or mint duplicate replacements.
- The source is archived, never deleted, and can be restored from the replacement UI.
- The opening input contains a real typed `@thread` mention plus any still-addressable attachments selected by the server helper.
- The same server operation powers app, SDK, and CLI.
- No host-daemon payload changes are planned. If the implementation changes a wire contract, increment `HOST_DAEMON_PROTOCOL_VERSION` before merging.

## Task 1: Define the public handoff contract and durable record

**Files:**

- Modify: `packages/server-contract/src/api/threads.ts`
- Modify: `packages/server-contract/src/public-api.ts`
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/src/data/thread-handoffs.ts`
- Modify: `packages/db/src/data/index.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/ids.ts`
- Test: `packages/db/test/data/thread-handoffs.test.ts`
- Test: `packages/db/test/schema.test.ts`
- Generated: the migration SQL and snapshot produced under `packages/db/drizzle/` by Drizzle
- Generated: `packages/db/drizzle/meta/_journal.json`

- [ ] **Step 1: Write the failing DB lifecycle tests**

Cover insert/read, unique idempotency, compare-and-set `provisioning -> started`, compare-and-set `provisioning -> failed`, and the rule that a settled record cannot be settled again.

```ts
it("returns one provisioning handoff for repeated idempotent creation", () => {
  const first = createThreadHandoff(db, fixture);
  const second = createThreadHandoff(db, fixture);
  expect(second).toEqual(first);
});

it("does not overwrite a started handoff with failure", () => {
  expect(markThreadHandoffStarted(db, replacementId, now)).toBe(true);
  expect(markThreadHandoffFailed(db, replacementId, failure, now + 1)).toBe(false);
  expect(getThreadHandoffByReplacementId(db, replacementId)?.status).toBe(
    "started",
  );
});
```

- [ ] **Step 2: Run the tests and prove the contract is missing**

Run: `pnpm exec turbo run test --filter=@bb/db --force`

Expected: FAIL because `threadHandoffs` and its data functions do not exist.

- [ ] **Step 3: Add strict request/response schemas**

Add these shapes to `packages/server-contract/src/api/threads.ts` and export them through the public contract:

```ts
export const threadHandoffLifecycleStateSchema = z.enum([
  "provisioning",
  "started",
  "failed",
]);

export const threadHandoffRequestSchema = z
  .object({
    sourceThreadId: z.string().min(1),
    providerId: z.string().min(1),
    model: z.string().min(1),
    reasoningLevel: reasoningLevelSchema,
    serviceTier: serviceTierSchema.optional(),
    permissionMode: permissionModeInputSchema,
    continuationText: z.string().trim().max(8_000).optional(),
    archiveSource: z.boolean(),
    idempotencyKey: z.string().min(16).max(128),
    origin: threadCreateOriginSchema,
  })
  .strict();

export const threadHandoffResponseSchema = z
  .object({
    sourceThreadId: z.string().min(1),
    replacementThreadId: z.string().min(1),
    state: threadHandoffLifecycleStateSchema,
    sourceArchived: z.boolean(),
    failure: z
      .object({ code: z.string().min(1), message: z.string().min(1) })
      .strict()
      .nullable(),
  })
  .strict();
```

Declare `POST /threads/handoff` and `GET /threads/handoffs/:id` in `public-api.ts`. The `:id` status lookup is the replacement thread ID.

- [ ] **Step 4: Add the schema and deep data interface**

Use a generated `thd_` ID, `replacementThreadId` as a unique foreign key, and a unique `(sourceThreadId, idempotencyKey)` index. Store the chosen execution tuple, archive policy, status, nullable failure fields, and timestamps. Keep all compare-and-set SQL in `thread-handoffs.ts`; callers must not update the table directly.

```ts
export interface ThreadHandoffRow {
  id: string;
  sourceThreadId: string;
  replacementThreadId: string;
  projectId: string;
  environmentId: string;
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel;
  serviceTier: ServiceTier | null;
  permissionMode: PermissionMode;
  archiveSource: boolean;
  idempotencyKey: string;
  status: "provisioning" | "started" | "failed";
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: number;
  updatedAt: number;
  settledAt: number | null;
}
```

- [ ] **Step 5: Generate and review the migration**

Run: `pnpm --filter @bb/db db:generate`

Review the generated SQL. Do not hand-edit the Drizzle snapshot JSON.

- [ ] **Step 6: Run DB tests and typecheck**

Run:

```sh
pnpm exec turbo run test --filter=@bb/db --force
pnpm exec turbo run typecheck --filter=@bb/db
pnpm exec turbo run typecheck --filter=@bb/server-contract
```

Expected: PASS.

- [ ] **Step 7: Commit the contract and persistence seam**

```sh
git add packages/server-contract packages/db
git commit -m "feat(threads): add durable takeover contract"
```

## Task 2: Build the server-owned handoff module

**Files:**

- Create: `apps/server/src/services/threads/thread-handoff.ts`
- Modify: `apps/server/src/routes/threads/base.ts`
- Modify: `apps/server/src/services/system/execution-options.ts`
- Modify: `apps/server/src/services/threads/thread-create-helpers.ts`
- Modify: `packages/db/src/data/threads.ts`
- Test: `apps/server/test/threads/thread-handoff.test.ts`
- Test: `apps/server/test/public/public-thread-handoff.test.ts`

- [ ] **Step 1: Write failing pure-helper and route tests**

Cover invalid/deleted/archived source, source without an environment, offline host, unavailable provider, retired or missing model, unsupported reasoning or permission, project mismatch, typed mention offsets, attachment preservation, normal fresh-thread creation, and double submit.

```ts
it("creates one fresh replacement with a typed source mention", async () => {
  const response = await handoff(app, request);
  expect(response.state).toBe("provisioning");
  expect(createdRequest.environment).toEqual({
    type: "reuse",
    environmentId: source.environmentId,
  });
  expect(createdRequest.originKind).toBeNull();
  expect(createdRequest.input[0]).toMatchObject({
    type: "text",
    mentions: [{ resource: { kind: "thread", threadId: source.id } }],
  });
});

it("does not create a second replacement for one idempotency key", async () => {
  const [first, second] = await Promise.all([
    handoff(app, request),
    handoff(app, request),
  ]);
  expect(second.replacementThreadId).toBe(first.replacementThreadId);
  expect(listThreads(db)).toHaveLength(before + 1);
});
```

- [ ] **Step 2: Run the server tests and prove the operation is absent**

Run: `pnpm exec turbo run test --filter=@bb/server --force`

Expected: FAIL with missing handoff route/module.

- [ ] **Step 3: Extract exact execution-catalog validation**

Add a reusable validator in `execution-options.ts` that resolves providers/models on the source environment's actual host and rejects selected-only/retired models for an explicit takeover. It must validate service tier, reasoning effort, permission support, and the machine permission ceiling without silently substituting a different model.

```ts
export async function validateExplicitThreadExecution(
  deps: AppDeps,
  input: {
    environmentId: string;
    providerId: string;
    model: string;
    reasoningLevel: ReasoningLevel;
    serviceTier?: ServiceTier;
    permissionMode: PermissionMode;
  },
): Promise<ResolvedExecutionOptions>;
```

- [ ] **Step 4: Implement `thread-handoff.ts` as the policy module**

The exported interface should remain small:

```ts
export async function createThreadHandoff(
  deps: AppDeps,
  request: ThreadHandoffRequest,
): Promise<ThreadHandoffResponse>;

export function getThreadHandoffStatus(
  deps: Pick<AppDeps, "db">,
  replacementThreadId: string,
): ThreadHandoffResponse;
```

Internally:

1. Look up an existing record by `(sourceThreadId, idempotencyKey)` before doing work.
2. Validate a live public source and a usable source environment.
3. Validate the exact target execution tuple on that environment's host.
4. Build `Continue from @thread…` as a text input with exact mention offsets and append the optional continuation text.
5. Preserve addressable local files/images and image URLs from the latest accepted source user input; pass them through existing attachment validation.
6. Refactor the thread-record helper to accept a pre-generated thread ID. Add one data function that inserts the replacement thread row plus handoff row in the same immediate transaction, then continue through the existing provisioning path with `environment: { type: "reuse" }`, `visibility: "visible"`, `originKind: null`, explicit execution provenance, and no provider fork descriptor.
7. Use the unique `(sourceThreadId, idempotencyKey)` index as the concurrency gate. A losing request reads and returns the winning record before any provider provisioning command is sent. A post-record provisioning failure settles the handoff failed and leaves the source live.

- [ ] **Step 5: Register the thin public adapters**

`POST /threads/handoff` calls `createThreadHandoff`; `GET /threads/handoffs/:id` calls `getThreadHandoffStatus`. Route code performs validation/HTTP translation only.

- [ ] **Step 6: Run focused server verification**

Run:

```sh
pnpm exec turbo run test --filter=@bb/server --force
pnpm exec turbo run typecheck --filter=@bb/server
```

Expected: PASS, including tests that unavailable execution fails before a replacement or handoff row exists.

- [ ] **Step 7: Commit the server creation path**

```sh
git add apps/server
git commit -m "feat(threads): create restart-safe takeovers"
```

## Task 3: Settle and reconcile handoff lifecycle state

**Files:**

- Modify: `apps/server/src/internal/events.ts`
- Modify: `apps/server/src/services/threads/thread-lifecycle.ts`
- Modify: `apps/server/src/services/threads/thread-archive.ts`
- Modify: `apps/server/src/services/system/periodic-sweeps.ts`
- Modify: `packages/db/src/data/thread-handoffs.ts`
- Test: `apps/server/test/internal/events.test.ts`
- Test: `apps/server/test/threads/thread-handoff-lifecycle.test.ts`
- Test: `apps/server/test/services/periodic-sweeps.test.ts`

- [ ] **Step 1: Write the failing lifecycle matrix**

Prove:

- source is live after handoff creation;
- non-root/nested `turn/started` does nothing;
- the first accepted root `turn/started` atomically marks started and archives the source;
- repeated start events are idempotent;
- start-command/provider terminal failure marks failed and leaves source live;
- `archiveSource: false` marks started without archiving;
- manually archived source is treated as already satisfied;
- restart reconciliation repairs `provisioning + replacement running/idle/error` truthfully.

Include a deliberate-break assertion: temporarily route settlement on thread creation and demonstrate the “not before `turn/started`” test fails.

- [ ] **Step 2: Run the failing lifecycle tests**

Run: `pnpm exec turbo run test --filter=@bb/server --force`

Expected: FAIL because handoffs never settle.

- [ ] **Step 3: Add one settlement seam**

Keep lifecycle policy out of `internal/events.ts`:

```ts
export function settleThreadHandoffStarted(
  deps: AppDeps,
  replacementThreadId: string,
): ThreadHandoffSettlement;

export function settleThreadHandoffFailed(
  deps: AppDeps,
  replacementThreadId: string,
  failure: { code: string; message: string },
): ThreadHandoffSettlement;
```

`settleThreadHandoffStarted` must use an immediate transaction to compare-and-set the row and archive the source DB state together. Reuse the existing thread archive module for notifier/provider cleanup after the transaction. Do not duplicate archive policy in the event router.

- [ ] **Step 4: Wire accepted lifecycle facts**

In `applyEventEffects`, call the started settlement only after the existing checks confirm an accepted, non-stale, root `turn/started`. In the existing terminal thread-start failure paths, call failed settlement with the structured failure code/message. Do not infer failure from a timeout in the browser.

- [ ] **Step 5: Add startup/periodic reconciliation**

Page through provisioning handoffs. For each replacement:

- stored root `turn/started` exists → settle started;
- terminal error/deleted replacement with no start → settle failed;
- still starting/running and no start fact → leave provisioning.

Assert a minimum observation floor before a sweep reports success.

- [ ] **Step 6: Run lifecycle verification**

Run:

```sh
pnpm exec turbo run test --filter=@bb/server --force
pnpm exec turbo run typecheck --filter=@bb/server
```

Expected: PASS, including restart and deliberate-break coverage.

- [ ] **Step 7: Commit lifecycle settlement**

```sh
git add apps/server packages/db
git commit -m "feat(threads): settle takeover lifecycle"
```

## Task 4: Expose the same operation through SDK and CLI

**Files:**

- Modify: `packages/sdk/src/areas/threads.ts`
- Test: `packages/sdk/test/sdk.test.ts`
- Test: `packages/sdk/test/public-types.test.ts`
- Create: `apps/cli/src/commands/thread/handoff.ts`
- Modify: `apps/cli/src/commands/thread/index.ts`
- Test: `apps/cli/src/__tests__/command-output/thread-handoff.test.ts`
- Modify: `packages/templates/src/templates/bb-guide-threads.md`
- Modify: `apps/server/src/services/skills/builtin-skills/bb-cli/SKILL.md`
- Modify: `docs/cli-guide-and-skill.md`
- Generated: `packages/templates/src/generated/templates.generated.ts`

- [x] **Step 1: Write failing SDK transport tests**

```ts
await sdk.threads.handoff({
  sourceThreadId: "thr_source",
  providerId: "claudeCode",
  model: "claude-opus-5",
  reasoningLevel: "high",
  permissionMode: "auto",
  archiveSource: true,
  idempotencyKey: "takeover-1234567890",
  origin: "sdk",
});

expect(request).toMatchObject({
  method: "POST",
  path: "/v1/threads/handoff",
});
```

Also test `handoffStatus({ replacementThreadId })` and public type exports.

- [x] **Step 2: Write failing CLI tests**

Cover required source/provider/model flags, execution flags, `--no-archive-source`, generated idempotency key, waiting through `turn/started` or failure, human output, JSON output, and source defaulting from `BB_THREAD_ID` when `--self` is used.

- [x] **Step 3: Run SDK/CLI tests and prove the adapters are absent**

Run:

```sh
pnpm exec turbo run test --filter=@bb/sdk --force
pnpm exec turbo run test --filter=@bb/cli --force
```

Expected: FAIL with missing methods/command.

- [x] **Step 4: Add SDK methods as thin route adapters**

```ts
export interface ThreadsArea {
  handoff(args: ThreadHandoffArgs): Promise<ThreadHandoffResult>;
  handoffStatus(
    args: ThreadHandoffStatusArgs,
  ): Promise<ThreadHandoffStatusResult>;
}
```

Parse request/response through the server-contract schemas; do not reimplement validation or lifecycle policy.

- [x] **Step 5: Add `bb thread handoff`**

Usage:

```text
bb thread handoff <source-id> --provider <id> --model <id>
  [--reasoning-level <level>] [--service-tier <tier>]
  [--permission-mode <mode>] [--continuation <text>]
  [--no-archive-source] [--json]
```

The command submits once, then polls `handoffStatus` until `started` or `failed`. Its terminal output always includes both thread IDs, lifecycle state, and whether the source is archived. A CLI process timeout reports “still provisioning”; it must not mark the handoff failed itself.

- [x] **Step 6: Update discoverable documentation and generated templates**

Update the source guide and builtin skill, then run:

```sh
node packages/templates/scripts/generate-templates.mjs
```

- [x] **Step 7: Verify SDK, CLI, and docs**

Run:

```sh
pnpm exec turbo run test --filter=@bb/sdk --force
pnpm exec turbo run typecheck --filter=@bb/sdk
pnpm exec turbo run test --filter=@bb/cli --force
pnpm exec turbo run typecheck --filter=@bb/cli
pnpm exec turbo run test --filter=@bb/templates --force
```

Expected: PASS.

- [ ] **Step 8: Commit the agent-facing surfaces**

```sh
git add packages/sdk apps/cli packages/templates apps/server/src/services/skills docs/cli-guide-and-skill.md
git commit -m "feat(cli): expose thread takeover"
```

## Task 5: Replace the manual app shortcut with the takeover drawer

**Files:**

- Create: `apps/app/src/components/thread/BringInModelDrawer.tsx`
- Create: `apps/app/src/components/thread/ThreadTakeoverBanner.tsx`
- Create: `apps/app/src/hooks/mutations/thread-handoff-mutations.ts`
- Create: `apps/app/src/hooks/queries/thread-handoff-query.ts`
- Modify: `apps/app/src/views/thread-detail/ThreadDetailPromptArea.tsx`
- Modify: `apps/app/src/views/thread-detail/ThreadDetailView.tsx`
- Modify: `apps/app/src/lib/query-keys.ts`
- Keep: `apps/app/src/lib/thread-handoff-request.ts`
- Test: `apps/app/src/components/thread/BringInModelDrawer.test.tsx`
- Test: `apps/app/src/components/thread/ThreadTakeoverBanner.test.tsx`
- Modify test: `apps/app/src/views/thread-detail/ThreadDetailPromptArea.test.tsx`
- Test: `apps/app/src/views/thread-detail/thread-takeover.integration.test.tsx`

- [ ] **Step 1: Write failing interaction tests**

Cover opening **Bring in another model**, choosing **Take over this thread**, provider/model/reasoning/service-tier/permission selection, `Continue with {model}`, stable idempotency across retries, immediate navigation to replacement, provisioning banner, failed banner with return/retry, started banner with source link, restore source, and retained old location-state fallback.

For compact layout, assert the shared `PersistentResponsiveDrawerShell` is used and content is deferred by its existing two-frame contract. Add a screenshot test/canary later; DOM-only coverage is not sufficient for the shipped UI.

- [ ] **Step 2: Run app tests and prove the UI is absent**

Run: `pnpm exec turbo run test --filter=@bb/app --force`

Expected: FAIL because the drawer and mutations do not exist.

- [ ] **Step 3: Implement the mutation/query adapters**

The mutation calls `sdk.threads.handoff`, invalidates source/replacement/sidebar caches, and returns the replacement ID. The status query polls only while `state === "provisioning"`. Generate one idempotency key when the drawer submission begins and retain it for retrying that submission.

- [ ] **Step 4: Build the shared persistent drawer flow**

Use BB's native execution controls and sanctioned typography/theme tokens. Do not introduce a modal drawer. The first screen contains the two intent cards; in this plan only **Take over** is live. **Review this work** becomes live when the separate Quick Review plan lands.

- [ ] **Step 5: Wire truthful navigation and recovery banners**

Navigate to the replacement as soon as the POST succeeds. Render status from the persisted server record. “Restore source thread” calls the existing unarchive mutation and updates both thread caches. Never archive from React code.

- [ ] **Step 6: Run app checks**

Run:

```sh
pnpm exec turbo run test --filter=@bb/app --force
pnpm exec turbo run typecheck --filter=@bb/app
```

Expected: PASS.

- [ ] **Step 7: Commit the app experience**

```sh
git add apps/app
git commit -m "feat(app): add one-action thread takeover"
```

## Task 6: Prove the end-to-end outcome and prepare review

**Files:**

- Create: `tests/integration/fake/multi-thread/thread-handoff.test.ts`
- Modify: `docs/superpowers/specs/2026-08-13-model-takeover-and-quick-review-design.md`

- [ ] **Step 1: Add an integration test that crosses the real public boundary**

Create a source thread, submit a handoff, assert source live while provisioning, post/observe replacement root `turn/started`, then assert source archived and status started. Add the mirror failure case.

- [ ] **Step 2: Run all affected tests/typechecks**

```sh
pnpm exec turbo run test --filter=@bb/db --filter=@bb/server-contract --filter=@bb/server --filter=@bb/sdk --filter=@bb/cli --filter=@bb/app --force
pnpm exec turbo run typecheck --filter=@bb/db --filter=@bb/server-contract --filter=@bb/server --filter=@bb/sdk --filter=@bb/cli --filter=@bb/app
pnpm exec turbo run lint --filter=@bb/server --filter=@bb/sdk --filter=@bb/cli --filter=@bb/app
```

- [ ] **Step 3: Verify the final diff and protocol boundary**

Read the full diff. Search changed files for daemon session/WebSocket/RPC payload changes. If any exist, bump and test `HOST_DAEMON_PROTOCOL_VERSION`; otherwise record that no wire change occurred.

- [ ] **Step 4: Run two real disposable canaries**

1. Codex source → Claude Code replacement.
2. Claude Code source → Codex replacement.

For each, visibly verify the replacement sees the typed source reference/context, the replacement turn starts, the source becomes archived only afterward, and restoring the source works. Capture screenshots for desktop and compact width so the shipped pixels are verified.

- [ ] **Step 5: Mark the spec implementation state accurately**

Change only the takeover portion from “implementation not started” to its verified state. Quick Review remains unimplemented until its separate plan is complete.

- [ ] **Step 6: Commit verification artifacts and open a draft PR**

```sh
git add tests docs
git commit -m "test(threads): verify cross-provider takeover"
git push -u origin codex/model-takeover-quick-review
gh pr create --draft --title "Add cross-provider thread takeover" --body-file "$BB_THREAD_STORAGE/thread-takeover-pr.md"
```

The PR body must end with:

```text
> AGENT GENERATED: by GPT-5
```

Do not merge or publish a BB release without the approval required by the repository instructions.
