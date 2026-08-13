# Quick Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user or agent send the current thread and workspace evidence to one independently selected model for a structured adversarial review, while the current thread remains usable.

**Architecture:** Extend the builtin Workflows plugin rather than creating another orchestration engine. A review-specific facade builds a neutral, bounded evidence pack from SDK timeline/diff APIs, starts one fixed workflow through the existing durable service, and persists a small review record keyed to the workflow run. The worker receives only the evidence pack and a strict structured-output schema. The plugin app, CLI, and shared “Bring in another model” launcher all call the same facade.

**Tech Stack:** TypeScript, BB plugin SDK, Workflows QuickJS runtime, plugin SQLite migrations, Zod/JSON Schema, React, host-owned `experimental_ProviderModelPicker`, Vitest, Testing Library, Turbo.

---

## Product invariants

- This is a one-model adversarial review. Multi-model debate remains out of scope until usage proves the need.
- Evidence is assembled by BB from bounded APIs. The current model does not summarize or choose evidence for the reviewer.
- The reviewer must return `sound`, `revise`, or `stop`, evidence-linked findings, minimal recommended changes, and uncertainty.
- An empty evidence observation is a failed review, never a green review.
- Truncation and unavailable evidence are explicit in both the worker prompt and result card.
- The reviewer is told not to edit files or take external action. It receives only `bb_workflow_result` as an agent tool.
- A Git-backed review worker uses a disposable isolated managed worktree. Any review-worker workspace change marks the review contaminated. Non-Git/personal workspaces use the existing environment and report the weaker contamination guarantee explicitly.
- App and CLI call the same `startQuickReview` service path. There is no second hand-authored workflow.
- The provider/model picker prerequisite is PR #1469. Do not build a duplicate picker.

## Task 1: Land the host provider/model picker prerequisite

**Files owned by prerequisite PR #1469:**

- `packages/plugin-sdk/src/app-contract.ts`
- `packages/plugin-sdk/src/app.ts`
- `packages/plugin-sdk/src/testing/app.tsx`
- `packages/plugin-sdk/src/testing/__tests__/app-harness.test.tsx`
- `packages/plugin-sdk/bundled-types/bb-plugin-sdk-app.d.ts`
- `packages/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts`
- `apps/app/src/components/plugin/PluginProviderModelPicker.tsx`
- `apps/app/src/components/plugin/PluginProviderModelPicker.test.tsx`
- `apps/app/src/lib/plugin-sdk-app-impl.tsx`
- `docs/api_to_audit.md`
- `packages/domain/src/plugin-sdk-version.ts`
- `packages/templates/src/generated/plugin-sdk-dts.generated.ts`

- [ ] **Step 1: Rebase this implementation branch onto the commit containing PR #1469**

Verify the prerequisite, using its landed commit rather than copying code:

```sh
rg -n "experimental_ProviderModelPicker" packages/plugin-sdk/src/app-contract.ts apps/app/src/lib/plugin-sdk-app-impl.tsx
```

Expected: both the public component contract and host implementation are present. The controlled value is exactly `{ providerId, model }`, with optional `hostId` routing.

- [ ] **Step 2: Run the prerequisite's contract checks**

```sh
pnpm exec turbo run test --filter=@bb/plugin-sdk --filter=@bb/app --force
pnpm exec turbo run typecheck --filter=@bb/plugin-sdk --filter=@bb/app
```

Expected: PASS before Quick Review code is added.

- [ ] **Step 3: Record the prerequisite commit in the branch history**

Do not squash or duplicate the picker implementation. If PR #1469 is still unmerged, stack this branch on its exact head and state that dependency in the draft PR.

## Task 2: Define review evidence and result contracts

**Files:**

- Create: `plugins/workflows/src/quick-review-contract.ts`
- Create: `plugins/workflows/src/quick-review-script.ts`
- Test: `plugins/workflows/src/quick-review-contract.test.ts`
- Test: `plugins/workflows/src/workflow-validation.test.ts`

- [ ] **Step 1: Write failing schema and boundary tests**

Cover strict parsing, bounded question length, evidence references, truncation notices, allowed verdicts, minimum one finding for `revise`/`stop`, uncertainty, and rejection of extra properties.

```ts
it("rejects a revise verdict without an evidence-linked finding", () => {
  expect(() => quickReviewResultSchema.parse({
    verdict: "revise",
    strongestChallenge: "The acceptance test proves only completion.",
    findings: [],
    recommendedChanges: ["Add a planted contradiction canary."],
    uncertainty: [],
  })).toThrow();
});
```

- [ ] **Step 2: Run the focused tests and prove the types are absent**

Run: `pnpm exec turbo run test --filter=bb-plugin-workflows --force`

Expected: FAIL because the Quick Review contracts do not exist.

- [ ] **Step 3: Add strict domain schemas**

```ts
export const quickReviewFindingSchema = z
  .object({
    severity: z.enum(["critical", "important", "minor"]),
    claim: z.string().min(1).max(2_000),
    evidenceRefs: z.array(z.string().min(1).max(120)).min(1).max(8),
    rationale: z.string().min(1).max(4_000),
  })
  .strict();

export const quickReviewResultSchema = z
  .object({
    verdict: z.enum(["sound", "revise", "stop"]),
    strongestChallenge: z.string().min(1).max(4_000),
    findings: z.array(quickReviewFindingSchema).max(12),
    recommendedChanges: z.array(z.string().min(1).max(2_000)).max(8),
    uncertainty: z.array(z.string().min(1).max(2_000)).max(8),
  })
  .strict();
```

Define an evidence pack with stable reference IDs, source metadata, ordered conversation entries, plan/goal state, diff summary, changed files/patches, and notices. Include `observedSignals` and require it to be greater than zero before starting a review.

- [ ] **Step 4: Add one static fixed workflow source**

`quick-review-script.ts` exports a literal script string. User evidence/question live in `args`; never interpolate them into executable source.

```ts
const quickReviewMetadata = {
  name: "Quick Review",
  description: "Independent adversarial review of one BB thread",
  phases: [
    { title: "Review", detail: "Challenge claims against the evidence pack" },
  ],
  inputSchema: quickReviewInputJsonSchema,
  outputSchema: quickReviewResultJsonSchema,
} as const;

export const QUICK_REVIEW_WORKFLOW_SOURCE = `
export const meta = ${JSON.stringify(quickReviewMetadata)};

const result = await phase("Review", () => agent(args.prompt, {
  title: "Adversarial review",
  selection: args.selection,
  outputSchema: ${JSON.stringify(quickReviewResultJsonSchema)}
}));
return result;
`;
```

Use the parser-supported literal JSON schema form; the implementation test must parse this exact source with `parseWorkflowSource` and execute it in the existing runtime harness.

- [ ] **Step 5: Run contract/runtime tests**

```sh
pnpm exec turbo run test --filter=bb-plugin-workflows --force
pnpm exec turbo run typecheck --filter=bb-plugin-workflows
```

Expected: PASS.

- [ ] **Step 6: Commit the review domain**

```sh
git add plugins/workflows/src/quick-review-contract.ts plugins/workflows/src/quick-review-script.ts plugins/workflows/src/quick-review-contract.test.ts plugins/workflows/src/workflow-validation.test.ts
git commit -m "feat(workflows): define Quick Review contract"
```

## Task 3: Build the neutral bounded evidence pack

**Files:**

- Create: `plugins/workflows/src/quick-review-evidence.ts`
- Test: `plugins/workflows/src/quick-review-evidence.test.ts`
- Modify: `plugins/workflows/src/service.ts`
- Modify test: `plugins/workflows/src/service-policy.test.ts`

- [ ] **Step 1: Write the failing evidence matrix**

Cover:

- source metadata and environment/host identity;
- multiple timeline pages in chronological order;
- conversation rows only, with stable `conversation:<sourceSeqStart>` refs;
- current goal, pending plan/todos, and explicit “not present” facts;
- changed-file TOC and bounded initial/on-demand patches;
- binary/too-large/unavailable files as notices, not silent omissions;
- aggregate byte/row/file limits;
- `timelinePage.hasOlderRows`, oversized timeline placeholders, diff truncation, and patch truncation;
- source changing after review start does not enter the frozen pack;
- zero observed conversation/goal/diff signals throws a typed evidence error.

```ts
it("fails rather than green-lighting an empty observation", async () => {
  await expect(buildQuickReviewEvidence(sdk, input)).rejects.toMatchObject({
    code: "quick_review_evidence_empty",
  });
});

it("names every truncated boundary", async () => {
  const pack = await buildQuickReviewEvidence(sdk, input);
  expect(pack.notices).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "conversation_truncated" }),
      expect.objectContaining({ kind: "diff_patch_truncated" }),
    ]),
  );
});
```

- [ ] **Step 2: Run focused tests and prove the collector is absent**

Run: `pnpm exec turbo run test --filter=bb-plugin-workflows --force`

Expected: FAIL with missing collector.

- [ ] **Step 3: Implement deterministic evidence budgets**

Use named constants and test boundary values:

```ts
export const QUICK_REVIEW_LIMITS = {
  maxConversationRows: 200,
  maxConversationBytes: 256_000,
  maxChangedFiles: 100,
  maxPatchFiles: 25,
  maxPatchBytes: 256_000,
  maxTotalBytes: 640_000,
} as const;
```

Read:

1. `threads.get({ threadId, include: "environment,host" })`.
2. `threads.timeline` with bounded `segmentLimit` and older cursors until a limit is reached.
3. `environments.diffFiles({ target: "all" })` and `diffPatch` in batches no larger than 25 paths.
4. Goal/todos from the timeline tail response.

Do not call `diffFile` for every file. The patch API already provides bounded text and explicit truncation.

- [ ] **Step 4: Render one neutral worker prompt**

The prompt contains the user question, evidence pack as delimited JSON, schema instructions, and this fixed rule:

```text
You are an independent reviewer. Challenge the work using only the supplied evidence.
Do not edit files, run commands that change state, send messages, or take external action.
Absence of evidence is uncertainty, not proof. Cite evidenceRefs exactly as supplied.
```

- [ ] **Step 5: Run evidence tests and typecheck**

```sh
pnpm exec turbo run test --filter=bb-plugin-workflows --force
pnpm exec turbo run typecheck --filter=bb-plugin-workflows
```

Expected: PASS.

- [ ] **Step 6: Commit the evidence module**

```sh
git add plugins/workflows/src/quick-review-evidence.ts plugins/workflows/src/quick-review-evidence.test.ts plugins/workflows/src/service.ts plugins/workflows/src/service-policy.test.ts
git commit -m "feat(workflows): assemble neutral review evidence"
```

## Task 4: Persist and run Quick Review through the existing workflow service

**Files:**

- Modify: `plugins/workflows/src/data.ts`
- Modify: `plugins/workflows/src/data.test.ts`
- Create: `plugins/workflows/src/quick-review-service.ts`
- Modify: `plugins/workflows/src/service.ts`
- Modify: `plugins/workflows/src/server.ts`
- Modify test: `plugins/workflows/src/server-harness.test.ts`
- Modify test: `plugins/workflows/src/service-policy.test.ts`

- [ ] **Step 1: Write failing persistence and orchestration tests**

Cover one durable review record per run, exact source thread/start sequence, selected provider/model/reasoning, evidence notices, hidden worker creation, isolated environment selection for Git projects, inherited source permission ceiling, structured result enforcement, retry/cancel, and terminal result lookup.

```ts
it("uses one normal Workflow run with the selected reviewer", async () => {
  const review = await service.startQuickReview(input);
  await workerTick();
  expect(spawnedThread).toMatchObject({
    visibility: "hidden",
    providerId: input.providerId,
    model: input.model,
    reasoningLevel: input.reasoningLevel,
  });
  expect(service.inspectQuickReview(review.runId)?.kind).toBe("quick_review");
});
```

- [ ] **Step 2: Run tests and prove review-specific persistence is absent**

Run: `pnpm exec turbo run test --filter=bb-plugin-workflows --force`

Expected: FAIL.

- [ ] **Step 3: Append a plugin DB migration**

Add `quick_review_runs` keyed by `run_id` with source thread ID, review question, evidence summary JSON, source max sequence, workspace guarantee (`isolated` or `shared`), contamination state, contamination detail JSON, and timestamps. Keep review metadata out of generic `workflow_runs`.

```sql
CREATE TABLE quick_review_runs (
  run_id TEXT PRIMARY KEY REFERENCES workflow_runs(id) ON DELETE CASCADE,
  source_thread_id TEXT NOT NULL,
  source_max_seq INTEGER NOT NULL,
  question TEXT NOT NULL,
  evidence_summary_json TEXT NOT NULL,
  workspace_guarantee TEXT NOT NULL CHECK (workspace_guarantee IN ('isolated','shared')),
  contamination_state TEXT NOT NULL DEFAULT 'pending'
    CHECK (contamination_state IN ('pending','clean','contaminated','unknown')),
  contamination_detail_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

- [ ] **Step 4: Add the review facade, not a second engine**

```ts
export interface QuickReviewService {
  start(input: StartQuickReviewInput): Promise<QuickReviewInspection>;
  inspect(runId: string): QuickReviewInspection | null;
}
```

`start` builds evidence and validates the exact selection through a pure validator extracted from the existing `validateSelection` seam. Add a `createQuickReviewRun` data function that inserts `workflow_runs` and `quick_review_runs` in one SQLite transaction, using the same parsing, bounds, settings snapshot, and hashes as generic `service.start`. The normal workflow worker then schedules the single agent call; the facade never executes an agent itself.

- [ ] **Step 5: Isolate the worker where the project supports it**

When `runAgentCall` finds a `quick_review_runs` record for the current run, it uses the review record's engine-owned workspace policy instead of adding a public workflow DSL option. For a Git project, spawn on the source host with:

```ts
environment: {
  type: "host",
  hostId: sourceHostId,
  workspace: {
    type: "managed-worktree",
    baseBranch: { kind: "default" },
  },
}
```

The evidence pack carries source uncommitted/branch changes, so the review does not depend on sharing the source checkout. For personal/non-Git projects, use the existing environment and persist `workspaceGuarantee: "shared"`; the result card must disclose that weaker guarantee.

- [ ] **Step 6: Verify exact provider selection**

Explicit review selection must reject unavailable providers, missing/retired models, and unsupported reasoning levels. It must not fall back silently. Use the source environment catalog even when the worker will execute in an isolated worktree on the same host.

- [ ] **Step 7: Run service and harness checks**

```sh
pnpm exec turbo run test --filter=bb-plugin-workflows --force
pnpm exec turbo run typecheck --filter=bb-plugin-workflows
```

Expected: PASS, and existing generic workflow tests remain unchanged.

- [ ] **Step 8: Commit orchestration/persistence**

```sh
git add plugins/workflows/src
git commit -m "feat(workflows): run durable Quick Reviews"
```

## Task 5: Detect and surface reviewer contamination

**Files:**

- Modify: `plugins/workflows/src/quick-review-service.ts`
- Modify: `plugins/workflows/src/service.ts`
- Modify: `plugins/workflows/src/data.ts`
- Modify test: `plugins/workflows/src/service-policy.test.ts`
- Modify test: `plugins/workflows/src/server-harness.test.ts`

- [ ] **Step 1: Write a deliberate contamination test**

Use the fake provider to emit a file-change event and write a file in the reviewer's environment. Prove the workflow may structurally succeed while the review inspection is `contaminated`.

```ts
expect(run.status).toBe("succeeded");
expect(service.inspectQuickReview(run.id)).toMatchObject({
  contamination: {
    state: "contaminated",
    changedPaths: ["reviewer-note.txt"],
  },
});
```

Also prove a clean review passes, an unavailable post-run diff produces `unknown` rather than clean, and legitimate source-thread changes during an isolated review do not contaminate it.

- [ ] **Step 2: Run tests and prove contamination is not detected**

Run: `pnpm exec turbo run test --filter=bb-plugin-workflows --force`

Expected: FAIL.

- [ ] **Step 3: Reconcile the worker's own environment after terminal state**

On the Quick Review child becoming idle/failed:

1. Read the child thread and its own environment ID.
2. Read its bounded timeline for `workKind: "file-change"` evidence.
3. Query its own environment `diffFiles({ target: "all" })`.
4. `available` with zero changed files and zero file-change rows → `clean`.
5. Any changed file or file-change row → `contaminated`, persist paths and evidence refs.
6. Unavailable/too-many-files/empty observation → `unknown`, never clean.

For `workspaceGuarantee: "shared"`, compare baseline and terminal diff fingerprints and mark changes `contaminated` with a race disclosure. Never revert, commit, or delete reviewer changes automatically.

- [ ] **Step 4: Prove the detector fails on a planted edit**

Temporarily disable the terminal reconciliation call and run the deliberate edit test. It must fail. Restore the call and rerun to green.

- [ ] **Step 5: Run verification**

```sh
pnpm exec turbo run test --filter=bb-plugin-workflows --force
pnpm exec turbo run typecheck --filter=bb-plugin-workflows
```

- [ ] **Step 6: Commit contamination detection**

```sh
git add plugins/workflows/src
git commit -m "feat(workflows): flag contaminated reviews"
```

## Task 6: Add plugin RPC, CLI, and agent documentation

**Files:**

- Modify: `plugins/workflows/src/ui-contract.ts`
- Modify: `plugins/workflows/src/ui-view.ts`
- Modify: `plugins/workflows/src/server.ts`
- Modify: `plugins/workflows/src/cli.ts`
- Modify: `plugins/workflows/src/cli.test.ts`
- Modify: `plugins/workflows/src/server-harness.test.ts`
- Modify: `plugins/workflows/src/README.md`
- Modify: `plugins/workflows/skills/workflows/SKILL.md`
- Modify: `apps/server/src/services/skills/builtin-skills/bb-cli/SKILL.md`
- Modify: `packages/templates/src/templates/bb-guide-plugins.md`
- Generated: `packages/templates/src/generated/templates.generated.ts`

- [ ] **Step 1: Write failing RPC/CLI tests**

Cover strict RPC input, authorization to the source thread/project, default question, exact provider/model/reasoning forwarding, run ID output, review inspection/result, cancellation through existing workflow stop, the `bb_quick_review` agent tool, JSON output, and CLI help.

- [ ] **Step 2: Run tests and prove the surfaces are absent**

Run: `pnpm exec turbo run test --filter=bb-plugin-workflows --force`

Expected: FAIL.

- [ ] **Step 3: Add strict review RPC methods**

```ts
quickReviewStart: {
  input: z.object({
    threadId: z.string().min(1),
    providerId: z.string().min(1),
    model: z.string().min(1),
    reasoningLevel: reasoningLevelSchema,
    question: z.string().trim().min(1).max(8_000),
  }).strict(),
  output: z.object({ run: quickReviewViewSchema }).strict(),
},
quickReviewView: {
  input: z.object({ threadId: z.string().min(1), runId: z.string().min(1) }).strict(),
  output: z.object({ review: quickReviewViewSchema.nullable() }).strict(),
},
```

The server verifies the run belongs to the supplied source thread before returning it.

- [ ] **Step 4: Add the agent and SDK-facing adapters**

Register `bb_quick_review` with the same strict input as `quickReviewStart`. Return the run ID, state, and `::workflow-preview{run="…"}` directive; add the tool alongside `bb_workflow_run` for ordinary source threads. The tool calls `quickReviewService.start` and does not synthesize evidence or workflow source.

Document the SDK route through the existing generic plugin RPC surface:

```ts
await sdk.plugins.callRpc({
  pluginId: "workflows",
  method: "quickReviewStart",
  input,
  outputSchema: quickReviewStartOutputSchema,
});
```

No new core SDK method is required because `plugins.callRpc` is the typed SDK boundary for plugin-owned capabilities.

- [ ] **Step 5: Add one CLI adapter**

```text
bb workflows quick-review --thread <id> --provider <id> --model <id>
  [--reasoning-level <level>] [--question <text>] [--json]
```

Inside a thread, `--thread` may default to `BB_THREAD_ID`; outside one it is required. The command calls `quickReviewService.start` and prints the run ID, initial state, selected reviewer, and evidence notices. It does not inline or duplicate the workflow source.

- [ ] **Step 6: Update docs and generated guide**

Document the agent tool, SDK RPC, CLI command, evidence/truncation, no-edit contract, contamination semantics, result shape, and the difference between Quick Review and a takeover. Then run:

```sh
node packages/templates/scripts/generate-templates.mjs
```

- [ ] **Step 7: Run plugin/guide verification**

```sh
pnpm exec turbo run test --filter=bb-plugin-workflows --filter=@bb/templates --force
pnpm exec turbo run typecheck --filter=bb-plugin-workflows
```

Expected: PASS.

- [ ] **Step 8: Commit CLI and RPC surfaces**

```sh
git add plugins/workflows apps/server/src/services/skills packages/templates
git commit -m "feat(workflows): expose Quick Review"
```

## Task 7: Build the Quick Review launcher and result card

**Files:**

- Modify: `plugins/workflows/src/app.tsx`
- Modify: `plugins/workflows/src/app.test.tsx`
- Create: `plugins/workflows/src/quick-review-app.tsx`
- Create: `apps/app/src/lib/workflows-plugin.ts`
- Modify: `apps/app/src/components/thread/BringInModelDrawer.tsx`
- Modify: `apps/app/src/components/thread/BringInModelDrawer.test.tsx`
- Modify: `apps/app/src/views/thread-detail/ThreadDetailPromptArea.tsx`
- Modify: `apps/app/src/views/thread-detail/ThreadDetailPromptArea.test.tsx`

- [ ] **Step 1: Write failing plugin UI tests**

Cover provider/model selection through `experimental_ProviderModelPicker`, reasoning selection returned by the review-catalog RPC, default/custom question, start/close, progress, cancellation, terminal verdict states, evidence links, truncation, clean/contaminated/unknown labels, shared-workspace disclosure, and RPC errors.

- [ ] **Step 2: Write failing shared-launcher integration tests**

The core **Bring in another model** drawer must show **Review this work** only when the builtin Workflows `quick-review` thread-panel action is registered. Selecting it opens that panel action for the current thread. If Workflows is disabled, takeover remains usable and the drawer explains that reviews require the Workflows plugin.

- [ ] **Step 3: Run app/plugin tests and prove the experience is absent**

```sh
pnpm exec turbo run test --filter=bb-plugin-workflows --filter=@bb/app --force
```

Expected: FAIL.

- [ ] **Step 4: Register the plugin-owned review panel**

```ts
app.slots.threadPanelAction({
  id: "quick-review",
  title: "Quick Review",
  icon: "SearchCheck",
  component: QuickReviewPanel,
  layout: "padded",
});
```

The panel uses the host picker with the source host ID, a small reasoning selector populated from RPC, the question editor, and the start button. Keep state controlled and preserve the question after a failed start.

- [ ] **Step 5: Connect the core launcher to the builtin action**

`workflows-plugin.ts` owns the stable IDs:

```ts
export const WORKFLOWS_PLUGIN_ID = "workflows";
export const QUICK_REVIEW_PANEL_ACTION_ID = "quick-review";
```

The core drawer checks `usePluginSlots().threadPanelActions` for that exact pair and invokes the existing plugin panel open handler. Core code does not import plugin React code or call review RPC directly.

- [ ] **Step 6: Render the terminal Quick Review card**

Show:

- verdict chip;
- strongest challenge;
- ordered findings with clickable source/evidence references;
- recommended changes;
- uncertainty and evidence notices;
- contamination state.

**Ask current model to respond** inserts a structured quote/reference into the source composer via `useComposer`; it never calls send/steer automatically.

- [ ] **Step 7: Verify compact drawer/panel pixels**

Use the existing persistent responsive drawer behavior inherited by the thread panel. Run component tests, then launch the dev app and capture desktop plus compact-width screenshots. Verify the picker, question, action button, and terminal card are visibly painted and not clipped.

- [ ] **Step 8: Run UI checks**

```sh
pnpm exec turbo run test --filter=bb-plugin-workflows --filter=@bb/app --force
pnpm exec turbo run typecheck --filter=bb-plugin-workflows --filter=@bb/app
```

Expected: PASS.

- [ ] **Step 9: Commit the user experience**

```sh
git add plugins/workflows apps/app
git commit -m "feat(app): add one-model Quick Review"
```

## Task 8: Prove review quality and prepare review

**Files:**

- Modify: `plugins/workflows/src/server-harness.test.ts`
- Modify: `docs/superpowers/specs/2026-08-13-model-takeover-and-quick-review-design.md`

- [ ] **Step 1: Add the planted-contradiction acceptance test**

Create a disposable source thread whose stated conclusion contradicts one supplied evidence item. Start Quick Review with the fake/real provider harness. The gate passes only if the structured result cites the planted evidence ref and returns `revise` or `stop`; mere successful completion is a failure.

- [ ] **Step 2: Add the planted-edit acceptance test**

Make the reviewer write one disposable file. The gate passes only if the review is marked contaminated and the path is shown. Then remove the edit from the fixture and prove a clean isolated review reports clean.

- [ ] **Step 3: Run the complete affected suite**

```sh
pnpm exec turbo run test --filter=bb-plugin-workflows --filter=@bb/plugin-sdk --filter=@bb/templates --filter=@bb/app --force
pnpm exec turbo run typecheck --filter=bb-plugin-workflows --filter=@bb/plugin-sdk --filter=@bb/app
pnpm exec turbo run lint --filter=bb-plugin-workflows --filter=@bb/app
pnpm bb plugin build plugins/workflows
```

- [ ] **Step 4: Run a real cross-model canary**

From a disposable Codex thread, start Quick Review with Claude Code; then reverse the providers. Verify selected models, progress card, structured result, evidence references, source usability during the run, and clean isolated workspace. A generic “looks good” answer without engaging the planted challenge does not pass.

- [ ] **Step 5: Read the final diff and update implementation status**

Confirm no second workflow engine/picker was introduced, no source workspace changes were applied automatically, and every public surface is documented. Update only the verified Quick Review portion of the approved spec.

- [ ] **Step 6: Commit verification and update the stacked draft PR**

```sh
git add plugins/workflows docs
git commit -m "test(workflows): verify adversarial Quick Review"
git push
```

If this is a separate stacked PR, create its body from a checked-in temporary file under `$BB_THREAD_STORAGE`, ending with:

```text
> AGENT GENERATED: by GPT-5
```

Do not merge or publish a BB release without the approval required by the repository instructions.
