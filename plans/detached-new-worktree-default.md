# Detached New Worktree Default

## Goal

Add an explicit checkout mode for managed "New worktree" environments:

- Detached HEAD worktrees are the default for "New worktree".
- A branch-backed worktree remains available as an explicit option for callers
  that want the current behavior.
- The selected base ref behavior stays intact: users can still choose which
  branch/ref the new worktree starts from.

This plan covers the app composer, CLI `--new-environment worktree`, server
request/provisioning flow, daemon command contract, and host worktree creation.

Out of scope:

- Branch cleanup/deletion.
- A broader environment identity/display refactor.
- Changing existing reused worktrees.
- Adding a DB migration unless implementation discovers one is unavoidable.

## Current Flow

- The app encodes "New worktree" as `host:<hostId>:worktree` in
  `apps/app/src/components/pickers/environment-picker-value.ts`.
- `RootComposeView` treats the branch picker as a base-branch picker when the
  environment mode is `worktree`.
- `resolveRootComposeThreadEnvironment()` emits:

  ```ts
  {
    type: "host",
    hostId,
    workspace: {
      type: "managed-worktree",
      baseBranch,
    },
  }
  ```

- `packages/server-contract/src/api/shared.ts` requires `baseBranch` for every
  managed worktree request, but has no checkout mode.
- `apps/server/src/services/threads/thread-create.ts` resolves the base branch
  and creates a `direct-managed` provisioning intent.
- `thread-provisioning-environment.ts` always mints a branch name with
  `buildManagedBranchName()`.
- `packages/host-daemon-contract/src/commands.ts` requires `branchName` on
  every managed worktree provision command.
- `packages/host-workspace/src/provisioning.ts` creates managed worktrees with:

  ```sh
  git worktree add -B <branchName> <targetPath> <baseBranch>
  ```

That means every new managed worktree creates or resets a local branch in the
source repository.

## Desired Behavior

Default "New worktree" behavior:

- User selects "New worktree".
- User optionally chooses a base ref using the existing base-branch picker.
- BB provisions the target with:

  ```sh
  git worktree add --detach <targetPath> <baseRef>
  ```

- The provisioned environment records:
  - `branchName: null`
  - `baseBranch: <chosen base branch or null for default>`
  - `defaultBranch` from daemon discovery

Explicit branch-backed behavior:

- User selects "New worktree".
- User switches checkout mode from "Detached HEAD" to "Create branch".
- User optionally chooses the base ref.
- BB provisions the target with the current branch-backed behavior:

  ```sh
  git worktree add -B <bb-generated-branch> <targetPath> <baseRef>
  ```

- The provisioned environment records the daemon-observed branch name.

## Data Model

Do not add a DB column in the first implementation.

Use existing fields this way:

- `environments.branchName` remains the actual daemon-observed current branch.
  Detached worktrees store `null`.
- `environments.baseBranch` remains the base ref selected for managed worktree
  provisioning.
- Reprovisioning a ready managed worktree should not mint a branch when
  `environment.branchName` is `null`; it should reprovision detached from the
  stored base branch/default.

This matches the current branch-tracking direction: `branchName` is an
observation, not a durable desired branch identity.

## Contract Changes

### Server API Contract

Update `managedWorktreeWorkspaceSchema` in
`packages/server-contract/src/api/shared.ts` to carry an explicit checkout
mode.

Recommended shape:

```ts
const managedWorktreeCheckoutSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("detached") }).strict(),
  z.object({ kind: z.literal("branch") }).strict(),
]);

const managedWorktreeWorkspaceSchema = z.object({
  type: z.literal("managed-worktree"),
  baseBranch: baseBranchSpecSchema,
  checkout: managedWorktreeCheckoutSchema,
});
```

For compatibility, the HTTP boundary may accept omitted `checkout` and normalize
it once to `{ kind: "detached" }`. After request normalization, internal server
code should carry an explicit checkout mode.

### Host Daemon Command Contract

Update `packages/host-daemon-contract/src/commands.ts` so managed worktree
provision commands do not require `branchName` unless branch mode is selected.

Recommended shape:

```ts
const managedWorktreeCheckoutCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("detached") }).strict(),
  z.object({
    kind: z.literal("branch"),
    branchName: gitBranchNameSchema,
  }).strict(),
]);
```

Then replace the top-level managed `branchName` field with:

```ts
checkout: managedWorktreeCheckoutCommandSchema
```

Keep `baseBranch: gitBranchNameSchema.nullable()` as the start ref input.

## App Changes

### Root Compose

Update `apps/app/src/views/root-compose-thread-environment.ts`:

- Add a `worktreeCheckout` argument with `"detached" | "branch"`.
- For `parsed.mode === "worktree"`, include:

  ```ts
  checkout: { kind: worktreeCheckout }
  ```

- Default `worktreeCheckout` to `"detached"` from `RootComposeView`.

Keep the existing base branch resolution logic. The selected branch continues to
mean "base ref" in worktree mode.

### UI Control

Add a compact worktree checkout mode control that appears only when the
environment picker is in "New worktree" mode.

Recommended labels:

- `Detached HEAD` - default
- `Create branch`

The base branch picker remains visible in both modes:

- Detached mode trigger copy: `Detached at: <base>`
- Branch mode trigger copy: `Branch from: <base>`

Implementation options:

- Extend `BranchPicker`'s `base` mode with an optional checkout-mode section.
- Or add a small segmented control next to the base picker in
  `NewThreadPromptBox.tsx`.

Prefer the smaller change once the component boundaries are clear. Do not encode
the checkout mode into `host:<id>:worktree`; keep it as separate scoped composer
state so the environment picker still means "new managed worktree".

### App Tests And Stories

Update:

- `apps/app/src/views/root-compose-thread-environment.test.ts`
- `apps/app/src/components/promptbox/NewThreadPromptBox.stories.tsx`
- `apps/app/src/components/promptbox/NewThreadEnvironmentOptions.stories.tsx`
  if the story is still the right surface
- Any BranchPicker story touched by the checkout-mode UI

Required test cases:

- Worktree mode defaults to `{ checkout: { kind: "detached" } }`.
- Worktree mode with `Create branch` sends `{ checkout: { kind: "branch" } }`.
- Base branch selection still sends the selected base ref in both modes.
- Personal project still resolves to a personal workspace.

## CLI Changes

Update `apps/cli/src/commands/thread/spawn.ts`:

- `bb thread spawn --new-environment worktree` should send detached checkout by
  default.
- Add an explicit option for branch-backed worktrees, for example:

  ```sh
  --worktree-checkout <detached|branch>
  ```

- Keep `--base-branch <branch>` as the base/start ref for both detached and
  branch-backed worktrees.
- Reject `--worktree-checkout` unless `--new-environment worktree` is present.

Update:

- `apps/cli/src/__tests__/spawn-helpers.test.ts`
- `apps/cli/src/__tests__/command-output/thread-spawn.test.ts`
- `packages/templates/src/templates/bb-guide-threads.md`
- regenerated templates if this repo requires generated guide updates

## Server Changes

### Request Resolution

Update the server-side managed worktree request path:

- `apps/server/src/services/threads/thread-create.ts`
- `apps/server/src/services/threads/thread-provisioning-context.ts`
- `apps/server/src/services/threads/thread-provisioning-environment.ts`
- `apps/server/src/services/threads/thread-create-helpers.ts`

Carry checkout mode through:

1. Public request/environment args.
2. Resolved create-thread environment.
3. Thread provisioning context.
4. Direct managed environment intent.
5. Daemon provision command.

Branch mode:

- Mint `buildManagedBranchName()` only when checkout mode is `branch`.
- Send daemon command checkout `{ kind: "branch", branchName }`.

Detached mode:

- Do not mint a branch name.
- Send daemon command checkout `{ kind: "detached" }`.
- Create the environment row with `branchName: null`.

### Default Policy And Child Work

Audit callers that construct managed worktrees without going through root
compose:

- `resolveCreateThreadEnvironment()` in
  `apps/server/src/services/threads/thread-default-policy.ts`
- `resolveChildThreadEnvironment()` in
  `apps/app/src/lib/child-thread-environment.ts`
- fork and side-chat builders that use child-thread environment resolution
- CLI spawn helper

Decision for the first implementation:

- Explicit user "New worktree" surfaces default to detached.
- Preserve fork/side-chat child-thread behavior unless product explicitly wants
  those flows to change too. If preserving, have those builders send
  `{ checkout: { kind: "branch" } }` explicitly.

### Reprovision

Update `dispatchManagedEnvironmentReprovision()` in
`apps/server/src/services/environments/environment-provisioning-internal.ts`:

- If `environment.branchName` is non-null, reprovision in branch mode using that
  branch name.
- If `environment.branchName` is null, reprovision in detached mode.
- Do not fall back to `buildManagedBranchName()` for null-branch managed
  worktrees.

This is required because detached worktrees intentionally have no branch name.

## Host Workspace Changes

Update:

- `packages/host-workspace/src/provision.ts`
- `packages/host-workspace/src/provisioning.ts`

Replace `branchName`-only managed worktree creation with explicit checkout
mode:

```ts
type ManagedWorktreeCheckout =
  | { kind: "detached" }
  | { kind: "branch"; branchName: string };
```

Creation behavior:

- Branch mode:

  ```sh
  git worktree add -B <branchName> <targetPath> <baseRef>
  ```

- Detached mode:

  ```sh
  git worktree add --detach <targetPath> <baseRef>
  ```

Existing target validation:

- Branch mode should keep validating that an existing target is on the expected
  branch.
- Detached mode should validate that an existing target is a git repo and not on
  an unexpected branch. If practical, validate the current HEAD matches the
  expected start ref; otherwise keep idempotency conservative and fail with a
  clear error when the existing checkout cannot be proven safe.

Setup scripts, progress streaming, cancellation, and rollback should stay
unchanged.

Progress copy can remain generic (`Creating worktree`) or become explicit
(`Creating detached worktree` / `Creating branch worktree`) if tests are updated.

## Environment Metadata And Status

No special branch metadata write is needed beyond the normal provisioning
result:

- The daemon already reports `branchName` from the created workspace.
- Detached worktrees should report `branchName: null`.
- `recordProvisionedEnvironmentWorkspace()` should persist that null value.
- The status route branch-tracking path should continue to refresh
  `environments.branchName` from daemon-observed checkout state.

Diff and merge-base behavior should continue to use `baseBranch` /
`mergeBaseBranch`, not `branchName`, for detached worktrees.

## Risks

- Some code currently treats managed worktree `branchName` as always present
  after provisioning. Tests should catch the main server/app/CLI paths, but
  manual review should search for assumptions after implementation.
- Reprovision is easy to regress because the old fallback minted a branch when
  `branchName` was null.
- `git worktree add --detach <baseRef>` starts from the current commit of the
  base ref. If the base branch advances later, the detached environment remains
  on the original commit until the user or reprovision changes it.
- Branch-backed worktrees still have the existing branch collision/reset risk
  from `git worktree add -B`. This plan does not solve branch hygiene.

## Implementation Steps

1. Add managed worktree checkout mode to `@bb/server-contract`.
2. Normalize omitted checkout mode to detached at the server request boundary.
3. Carry checkout mode through thread create, provisioning context, and managed
   environment plans.
4. Update daemon command contract to carry managed checkout mode.
5. Update host workspace provisioner to support detached managed worktrees.
6. Update root compose state/request building and add the checkout mode UI.
7. Update CLI `--new-environment worktree` default and add explicit branch mode
   flag.
8. Update reprovision so null-branch managed worktrees stay detached.
9. Update tests and guide text.
10. Search for stale branch-required assumptions around managed worktrees and
    fix only the assumptions that break detached worktree creation.

## Exit Criteria

- Creating a new worktree from the app default path provisions a detached HEAD
  worktree.
- The same app flow can explicitly request a branch-backed worktree and creates
  the generated `bb/...` branch as before.
- `bb thread spawn --new-environment worktree` defaults to detached checkout.
- The CLI branch-backed flag creates a branch-backed managed worktree.
- Detached worktree provisioning persists `environments.branchName = null`.
- Detached worktree reprovision stays detached and does not mint a generated
  branch.
- Existing setup-script, cancellation, rollback, and cleanup behavior still
  works for both checkout modes.
- Fork/side-chat behavior is either explicitly preserved or intentionally
  changed with tests documenting the decision.

## Validation

Run targeted checks through Turbo:

```sh
pnpm exec turbo run typecheck --filter=@bb/server-contract --filter=@bb/host-daemon-contract --filter=@bb/host-workspace --filter=@bb/server --filter=@bb/app --filter=@bb/cli
pnpm exec turbo run test --filter=@bb/host-workspace --force > /tmp/host-workspace-detached-worktree-test-out.txt 2>&1
pnpm exec turbo run test --filter=@bb/server --force > /tmp/server-detached-worktree-test-out.txt 2>&1
pnpm exec turbo run test --filter=@bb/app --force > /tmp/app-detached-worktree-test-out.txt 2>&1
pnpm exec turbo run test --filter=@bb/cli --force > /tmp/cli-detached-worktree-test-out.txt 2>&1
```

Manual smoke test:

1. Start the dev app with `scripts/bb-dev-app current`.
2. Create a project thread with `New worktree` and no checkout-mode changes.
3. Confirm the workspace is detached:

   ```sh
   git -C <new-worktree-path> branch --show-current
   git -C <new-worktree-path> rev-parse --short HEAD
   ```

4. Confirm the DB row has `branchName` null and the expected `baseBranch`.
5. Create another `New worktree`, choose `Create branch`, and confirm
   `git branch --show-current` prints the generated BB branch.
