import { mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import type { ProvisioningTranscriptEntry, WorkspaceStatus } from "@bb/domain";
import type {
  CommitOptions,
  CommitResult,
  CreatePullRequestOptions,
  CreatePullRequestResult,
  DiffOptions,
  DiffResult,
  DiffFilesArgs,
  DiffFilesResult,
  DiffPatchArgs,
  DiffPatchEntry,
  FetchOptions,
  PullRequestActionOptions,
  PushBranchOptions,
  PushBranchResult,
  StatusOptions,
  SquashMergeOptions,
  SquashMergeResult,
} from "./workspace.js";
import { Workspace } from "./workspace.js";
import type { GitHostPullRequestLookup } from "./git-host.js";
import {
  withCheckoutMutationAdmission,
  withCheckoutMutationLock,
} from "./checkout-mutation-lock.js";
import { createWorktree, removeWorktree } from "./provisioning.js";
import { runGitWithWorktreeMetadataLock } from "./worktree-metadata-lock.js";
import {
  detectGitRepo,
  getAbsoluteGitDir,
  getCheckoutRef,
  getGitCommonDir,
  getWorkspaceGitOperation,
  hasUncommittedChanges,
  listBranches,
  pathExists,
  readDefaultBranch,
  runGit,
  WorkspaceError,
} from "./git.js";
import { resolveAdditionalWorkspaceWriteRoots } from "./workspace-write-roots.js";

// ---------------------------------------------------------------------------
// Options (discriminated union on workspaceProvisionType from @bb/domain)
// ---------------------------------------------------------------------------

type ProvisionProgressCallback = (entry: ProvisioningTranscriptEntry) => void;

interface ProvisionBase {
  /** Progress callback for provisioning steps/output */
  onProgress?: ProvisionProgressCallback;
  signal?: AbortSignal;
}

export type UnmanagedCheckoutOpts =
  | {
      /**
       * Runs `git switch <name>` (no-op if HEAD is already there).
       */
      kind: "existing";
      name: string;
    }
  | {
      /**
       * Runs `git switch -C <name> <baseBranch>` so the branch is created or
       * reset from the requested base.
       */
      kind: "new";
      name: string;
      baseBranch: string;
    };

export interface UnmanagedWorkspaceOpts extends ProvisionBase {
  workspaceProvisionType: "unmanaged";
  /** Path to validate. Must exist. */
  path: string;
  /** Pre-provision checkout. When set, the daemon switches branches before opening the workspace. */
  checkout?: UnmanagedCheckoutOpts;
}

export interface ManagedWorkspaceBaseOpts extends ProvisionBase {
  /** Source repo path */
  sourcePath: string;
  /** Target path for worktree/clone creation */
  targetPath: string;
  /** Name of the new branch to create on the workspace. */
  branchName: string;
  /** Exact start point for the managed branch. */
  startPoint: import("./provisioning.js").WorktreeStartPoint;
  /** Setup script timeout in ms. Controlled by the server. */
  timeoutMs: number;
  /** Resolved user-shell PATH for the setup script. */
  setupPath?: string;
}

export interface ManagedWorktreeOpts extends ManagedWorkspaceBaseOpts {
  workspaceProvisionType: "managed-worktree";
}

export interface ReconnectManagedWorktreeOpts extends ProvisionBase {
  workspaceProvisionType: "reconnect-managed-worktree";
  /** Existing worktree path to reconnect */
  path: string;
}

export interface ReconnectDetachedReadOnlyWorkspaceOpts extends ProvisionBase {
  workspaceProvisionType: "reconnect-detached-read-only";
  path: string;
  outputPath: string;
}

export interface PersonalWorkspaceOpts extends ProvisionBase {
  workspaceProvisionType: "personal";
  /** Environment ID that owns the personal scratch workspace. */
  environmentId: string;
  /** Root directory containing bb-managed personal scratch workspaces. */
  personalWorkspaceRoot: string;
  /** Target directory for the scratch workspace. Created if missing. */
  targetPath: string;
}

export interface IsolatedScratchWorkspaceOpts extends ProvisionBase {
  workspaceProvisionType: "isolated-scratch";
  environmentId: string;
  isolatedScratchWorkspaceRoot: string;
  targetPath: string;
}

export interface DetachedReadOnlyWorkspaceOpts extends ProvisionBase {
  workspaceProvisionType: "detached-read-only";
  environmentId: string;
  sourcePath: string;
  targetPath: string;
  outputPath: string;
  detachedReadOnlyWorkspaceRoot: string;
  detachedReadOnlyOutputRoot: string;
  objectFormat: "sha1" | "sha256";
  baseRevision: string;
}

export type ProvisionWorkspaceArgs =
  | UnmanagedWorkspaceOpts
  | ManagedWorktreeOpts
  | PersonalWorkspaceOpts
  | IsolatedScratchWorkspaceOpts
  | DetachedReadOnlyWorkspaceOpts
  | ReconnectManagedWorktreeOpts
  | ReconnectDetachedReadOnlyWorkspaceOpts;

export interface ValidatePersonalWorkspaceTargetPathArgs {
  environmentId: string;
  personalWorkspaceRoot: string;
  targetPath: string;
}

export interface ValidateIsolatedScratchWorkspaceTargetPathArgs {
  environmentId: string;
  isolatedScratchWorkspaceRoot: string;
  targetPath: string;
}

export interface ValidateDetachedReadOnlyWorkspacePathsArgs {
  environmentId: string;
  detachedReadOnlyWorkspaceRoot: string;
  detachedReadOnlyOutputRoot: string;
  targetPath: string;
  outputPath: string;
}

// ---------------------------------------------------------------------------
// HostWorkspace interface
// ---------------------------------------------------------------------------

const WORKSPACE_BRANCH_GIT_TIMEOUT_MS = 15_000;

export interface HostWorkspace {
  /** Absolute path to the workspace directory */
  readonly path: string;
  /** Whether the system manages this workspace's lifecycle */
  readonly managed: boolean;
  /** Whether this is a git repository */
  readonly isGitRepo: boolean;
  /** Whether this is a git worktree (vs. a standalone repo) */
  readonly isWorktree: boolean;

  // Git queries
  getDefaultBranch(): Promise<string | null>;
  getCurrentBranch(): Promise<string | null>;
  getHeadSha(): Promise<string | null>;
  getLocalStateFingerprint(): Promise<string>;
  getSharedGitRefsFingerprint(): Promise<string>;
  getAdditionalWorkspaceWriteRoots(): Promise<string[]>;
  getStatus(options?: StatusOptions): Promise<WorkspaceStatus>;
  getDiff(options?: DiffOptions): Promise<DiffResult>;
  diffFiles(args: DiffFilesArgs): Promise<DiffFilesResult>;
  diffPatch(args: DiffPatchArgs): Promise<DiffPatchEntry[]>;
  getPullRequest(): Promise<GitHostPullRequestLookup>;
  runPullRequestAction(action: PullRequestActionOptions): Promise<void>;
  createPullRequest(
    options: CreatePullRequestOptions,
  ): Promise<CreatePullRequestResult>;
  listBranches(): Promise<string[]>;
  listFiles(): Promise<string[]>;

  // Git mutations
  commit(options: CommitOptions): Promise<CommitResult>;
  pushBranch(options: PushBranchOptions): Promise<PushBranchResult>;
  reset(): Promise<void>;
  fetch(options?: FetchOptions): Promise<void>;
  squashMerge(options: SquashMergeOptions): Promise<SquashMergeResult>;

  // Lifecycle
  destroy(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Detect whether a path is a git worktree
// ---------------------------------------------------------------------------

async function detectWorktree(cwd: string): Promise<boolean> {
  const gitDirResult = await runGit(["rev-parse", "--git-dir"], {
    cwd,
    allowFailure: true,
  });
  if (gitDirResult.exitCode !== 0) return false;

  const gitDir = gitDirResult.stdout.trim();
  // Worktrees have a .git file (not directory) pointing to
  // <common-dir>/worktrees/<name>. The git-dir will contain "/worktrees/".
  return gitDir.includes("/worktrees/");
}

// ---------------------------------------------------------------------------
// ProvisionedHostWorkspace - wraps Workspace + lifecycle cleanup
// ---------------------------------------------------------------------------

class ProvisionedHostWorkspace implements HostWorkspace {
  readonly path: string;
  readonly managed: boolean;
  readonly isGitRepo: boolean;
  readonly isWorktree: boolean;

  private readonly ws: Workspace;
  private readonly destroyFn: () => Promise<void>;
  private readonly readOnly: boolean;
  private readonly additionalWorkspaceWriteRoots: readonly string[];

  constructor(opts: {
    path: string;
    managed: boolean;
    isGitRepo: boolean;
    isWorktree: boolean;
    destroyFn: () => Promise<void>;
    readOnly?: boolean;
    additionalWorkspaceWriteRoots?: readonly string[];
  }) {
    this.path = opts.path;
    this.managed = opts.managed;
    this.isGitRepo = opts.isGitRepo;
    this.isWorktree = opts.isWorktree;
    this.ws = new Workspace(opts.path);
    this.destroyFn = opts.destroyFn;
    this.readOnly = opts.readOnly ?? false;
    this.additionalWorkspaceWriteRoots =
      opts.additionalWorkspaceWriteRoots ?? [];
  }

  async getCurrentBranch(): Promise<string | null> {
    return (await this.ws.currentBranch) ?? null;
  }

  async getDefaultBranch(): Promise<string | null> {
    if (!this.isGitRepo) {
      return null;
    }
    return (
      (await readDefaultBranch(this.path, {
        timeoutMs: WORKSPACE_BRANCH_GIT_TIMEOUT_MS,
      })) ?? null
    );
  }

  getHeadSha(): Promise<string | null> {
    return this.ws.getHeadSha();
  }

  getLocalStateFingerprint(): Promise<string> {
    return this.ws.getLocalStateFingerprint();
  }

  getSharedGitRefsFingerprint(): Promise<string> {
    return this.ws.getSharedGitRefsFingerprint();
  }

  getAdditionalWorkspaceWriteRoots(): Promise<string[]> {
    if (this.additionalWorkspaceWriteRoots.length > 0) {
      return Promise.resolve([...this.additionalWorkspaceWriteRoots]);
    }
    if (!this.isGitRepo || !this.isWorktree) {
      return Promise.resolve([]);
    }
    return resolveAdditionalWorkspaceWriteRoots(this.path);
  }

  getStatus(options?: StatusOptions): Promise<WorkspaceStatus> {
    return this.ws.getStatus(options);
  }

  getDiff(options?: DiffOptions): Promise<DiffResult> {
    return this.ws.getDiff(options);
  }

  diffFiles(args: DiffFilesArgs): Promise<DiffFilesResult> {
    return this.ws.diffFiles(args);
  }

  diffPatch(args: DiffPatchArgs): Promise<DiffPatchEntry[]> {
    return this.ws.diffPatch(args);
  }

  getPullRequest(): Promise<GitHostPullRequestLookup> {
    return this.ws.getPullRequest();
  }

  runPullRequestAction(action: PullRequestActionOptions): Promise<void> {
    this.assertWritable();
    return this.ws.runPullRequestAction(action);
  }

  createPullRequest(
    options: CreatePullRequestOptions,
  ): Promise<CreatePullRequestResult> {
    this.assertWritable();
    return this.ws.createPullRequest(options);
  }

  listBranches(): Promise<string[]> {
    return this.ws.getBranches();
  }

  listFiles(): Promise<string[]> {
    return this.ws.listFiles();
  }

  commit(options: CommitOptions): Promise<CommitResult> {
    this.assertWritable();
    return this.ws.commit(options);
  }

  pushBranch(options: PushBranchOptions): Promise<PushBranchResult> {
    this.assertWritable();
    return this.ws.pushBranch(options);
  }

  reset(): Promise<void> {
    this.assertWritable();
    return this.ws.reset();
  }

  fetch(options?: FetchOptions): Promise<void> {
    this.assertWritable();
    return this.ws.fetch(options);
  }

  squashMerge(options: SquashMergeOptions): Promise<SquashMergeResult> {
    this.assertWritable();
    return this.ws.squashMergeInto(options);
  }

  private assertWritable(): void {
    if (this.readOnly) {
      throw new WorkspaceError(
        "workspace_read_only",
        "Detached read-only workspace does not permit Git mutations",
      );
    }
  }

  destroy(): Promise<void> {
    return this.destroyFn();
  }
}

// ---------------------------------------------------------------------------
// provisionWorkspace
// ---------------------------------------------------------------------------

export interface OpenWorkspaceArgs {
  path: string;
}

export async function openWorkspace(
  args: OpenWorkspaceArgs,
): Promise<HostWorkspace> {
  return provisionWorkspace({
    workspaceProvisionType: "unmanaged",
    path: args.path,
  });
}

export async function provisionWorkspace(
  opts: ProvisionWorkspaceArgs,
): Promise<HostWorkspace> {
  switch (opts.workspaceProvisionType) {
    case "unmanaged":
      return provisionUnmanaged(opts);
    case "managed-worktree":
      return provisionWorktree(opts);
    case "personal":
      return provisionPersonalWorkspace(opts);
    case "isolated-scratch":
      return provisionIsolatedScratchWorkspace(opts);
    case "detached-read-only":
      return provisionDetachedReadOnlyWorkspace(opts);
    case "reconnect-managed-worktree":
      return reconnectManagedWorktree(opts);
    case "reconnect-detached-read-only":
      return reconnectDetachedReadOnlyWorkspace(opts);
  }
}

function isRelativeChildPath(relativePath: string): boolean {
  return (
    relativePath.length > 0 &&
    relativePath !== "." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    relativePath !== ".." &&
    !path.isAbsolute(relativePath)
  );
}

function isSamePathOrNestedUnder(
  candidatePath: string,
  rootPath: string,
): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === "" || isRelativeChildPath(relativePath);
}

async function hasContainedPersonalGitMetadata(
  targetPath: string,
): Promise<boolean> {
  const [resolvedTargetPath, gitDir, commonGitDir] = await Promise.all([
    realpath(targetPath),
    getAbsoluteGitDir(targetPath),
    getGitCommonDir(targetPath),
  ]);
  const [resolvedGitDir, resolvedCommonGitDir] = await Promise.all([
    realpath(gitDir),
    realpath(commonGitDir),
  ]);
  return (
    isSamePathOrNestedUnder(resolvedGitDir, resolvedTargetPath) &&
    isSamePathOrNestedUnder(resolvedCommonGitDir, resolvedTargetPath)
  );
}

export function getPersonalWorkspaceRoot(dataDir: string): string {
  return path.resolve(dataDir, "personal-workspaces");
}

export function getIsolatedScratchWorkspaceRoot(dataDir: string): string {
  return path.resolve(dataDir, "isolated-scratch-workspaces");
}

export function getDetachedReadOnlyWorkspaceRoot(dataDir: string): string {
  return path.resolve(dataDir, "detached-read-only-workspaces");
}

export function getDetachedReadOnlyOutputRoot(dataDir: string): string {
  return path.resolve(dataDir, "detached-read-only-outputs");
}

export function validateIsolatedScratchWorkspaceTargetPath(
  args: ValidateIsolatedScratchWorkspaceTargetPathArgs,
): string {
  return validateManagedEmptyWorkspaceTargetPath({
    environmentId: args.environmentId,
    root: args.isolatedScratchWorkspaceRoot,
    targetPath: args.targetPath,
    errorCode: "invalid_isolated_scratch_workspace_path",
    workspaceLabel: "Isolated scratch workspace",
  });
}

export function validatePersonalWorkspaceTargetPath(
  args: ValidatePersonalWorkspaceTargetPathArgs,
): string {
  return validateManagedEmptyWorkspaceTargetPath({
    environmentId: args.environmentId,
    root: args.personalWorkspaceRoot,
    targetPath: args.targetPath,
    errorCode: "invalid_personal_workspace_path",
    workspaceLabel: "Personal workspace",
  });
}

export function validateDetachedReadOnlyWorkspacePaths(
  args: ValidateDetachedReadOnlyWorkspacePathsArgs,
): { targetPath: string; outputPath: string } {
  if (
    path.basename(args.environmentId) !== args.environmentId ||
    args.environmentId === "." ||
    args.environmentId === ".."
  ) {
    throw new WorkspaceError(
      "invalid_detached_read_only_workspace_path",
      "Detached read-only environmentId must be a single path segment",
    );
  }
  const workspaceRoot = path.resolve(args.detachedReadOnlyWorkspaceRoot);
  const environmentRoot = path.resolve(workspaceRoot, args.environmentId);
  const targetPath = path.resolve(args.targetPath);
  if (
    path.dirname(targetPath) !== environmentRoot ||
    !isRelativeChildPath(path.relative(workspaceRoot, targetPath))
  ) {
    throw new WorkspaceError(
      "invalid_detached_read_only_workspace_path",
      "Detached read-only checkout must be directly under its environment root",
    );
  }
  const outputRoot = path.resolve(args.detachedReadOnlyOutputRoot);
  const outputPath = path.resolve(args.outputPath);
  if (outputPath !== path.resolve(outputRoot, args.environmentId)) {
    throw new WorkspaceError(
      "invalid_detached_read_only_output_path",
      "Detached read-only output path must match the environment id",
    );
  }
  return { targetPath, outputPath };
}

function validateManagedEmptyWorkspaceTargetPath(args: {
  environmentId: string;
  root: string;
  targetPath: string;
  errorCode: string;
  workspaceLabel: string;
}): string {
  if (
    path.basename(args.environmentId) !== args.environmentId ||
    args.environmentId === "." ||
    args.environmentId === ".."
  ) {
    throw new WorkspaceError(
      args.errorCode,
      `${args.workspaceLabel} environmentId must be a single path segment`,
    );
  }

  const root = path.resolve(args.root);
  const expectedTargetPath = path.resolve(root, args.environmentId);
  const rootRelativeExpectedPath = path.relative(root, expectedTargetPath);
  if (!isRelativeChildPath(rootRelativeExpectedPath)) {
    throw new WorkspaceError(
      args.errorCode,
      `${args.workspaceLabel} target path must be under its workspace root`,
    );
  }

  const targetPath = path.resolve(args.targetPath);
  if (targetPath !== expectedTargetPath) {
    throw new WorkspaceError(
      args.errorCode,
      `${args.workspaceLabel} target path must match the environment id`,
    );
  }

  return targetPath;
}

interface ApplyUnmanagedCheckoutArgs {
  cwd: string;
  checkout: UnmanagedCheckoutOpts;
  onProgress: ProvisionProgressCallback | undefined;
  signal: AbortSignal | undefined;
}

interface ValidateUnmanagedCheckoutArgs {
  cwd: string;
  checkout: UnmanagedCheckoutOpts;
  signal: AbortSignal | undefined;
}

interface CheckoutCompletedTextArgs {
  checkout: UnmanagedCheckoutOpts;
  alreadyOnTarget: boolean;
}

type UnmanagedCheckoutPreflightResult =
  | { kind: "already-current" }
  | { kind: "ready" };

function formatOperationKind(kind: string): string {
  switch (kind) {
    case "cherry-pick":
      return "cherry-pick";
    default:
      return kind;
  }
}

function getCheckoutCompletedText(args: CheckoutCompletedTextArgs): string {
  const { checkout, alreadyOnTarget } = args;
  if (alreadyOnTarget) {
    return `Already on branch ${checkout.name}`;
  }
  if (checkout.kind === "new") {
    return `Created branch ${checkout.name}`;
  }
  return `Switched to branch ${checkout.name}`;
}

function createProvisionCancelledError(cause?: unknown): WorkspaceError {
  return new WorkspaceError(
    "provision_cancelled",
    "Workspace provisioning was cancelled",
    { cause },
  );
}

function throwIfProvisionAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createProvisionCancelledError(signal.reason);
  }
}

async function validateUnmanagedCheckout(
  args: ValidateUnmanagedCheckoutArgs,
): Promise<UnmanagedCheckoutPreflightResult> {
  const { cwd, checkout } = args;
  throwIfProvisionAborted(args.signal);
  const checkoutRef = await getCheckoutRef(cwd);
  if (
    checkoutRef.kind === "branch" &&
    checkoutRef.branchName === checkout.name
  ) {
    return { kind: "already-current" };
  }
  if (
    checkoutRef.kind === "unborn" &&
    checkoutRef.branchName === checkout.name
  ) {
    return { kind: "already-current" };
  }

  switch (checkoutRef.kind) {
    case "branch":
      break;
    case "detached":
      throw new WorkspaceError(
        "checkout_detached",
        "Cannot checkout branch while the workspace is on a detached HEAD",
      );
    case "unborn":
      throw new WorkspaceError(
        "checkout_unborn",
        "Cannot checkout branch before the current branch has an initial commit",
      );
    case "unknown":
      throw new WorkspaceError(
        "checkout_unknown",
        `Cannot inspect current checkout: ${checkoutRef.reason}`,
      );
  }

  if (checkout.kind === "existing") {
    const branches = await listBranches(cwd);
    if (!branches.includes(checkout.name)) {
      throw new WorkspaceError(
        "checkout_missing_branch",
        `Cannot checkout missing branch ${checkout.name}`,
      );
    }
  }

  const operation = await getWorkspaceGitOperation(cwd);
  if (operation.kind !== "none" && operation.hasConflicts) {
    throw new WorkspaceError(
      "checkout_conflicts",
      `Cannot checkout branch while ${formatOperationKind(
        operation.kind,
      )} has unresolved conflicts`,
    );
  }
  if (operation.kind !== "none") {
    throw new WorkspaceError(
      "checkout_in_progress_operation",
      `Cannot checkout branch while ${formatOperationKind(
        operation.kind,
      )} is in progress`,
    );
  }

  if (await hasUncommittedChanges(cwd)) {
    throw new WorkspaceError(
      "checkout_dirty",
      "Cannot checkout branch while the workspace has uncommitted changes",
    );
  }

  return { kind: "ready" };
}

async function applyUnmanagedCheckout(
  args: ApplyUnmanagedCheckoutArgs,
): Promise<void> {
  const { cwd, checkout, onProgress, signal } = args;
  throwIfProvisionAborted(signal);
  // `switch -C` for new (create-or-reset from base) and `switch` for existing.
  const switchArgs =
    checkout.kind === "new"
      ? ["switch", "-C", checkout.name, checkout.baseBranch]
      : ["switch", checkout.name];
  const waitingStartedAt = Date.now();
  onProgress?.({
    type: "step",
    key: "git-checkout-waiting",
    text:
      checkout.kind === "new"
        ? `Waiting to create branch ${checkout.name}`
        : `Waiting to switch to branch ${checkout.name}`,
    status: "started",
    startedAt: waitingStartedAt,
  });
  let startedAt = waitingStartedAt;
  let waitingCompleted = false;
  let alreadyOnTarget = false;
  try {
    await withCheckoutMutationAdmission(
      cwd,
      async () => {
        throwIfProvisionAborted(signal);
        if (!(await pathExists(cwd))) {
          throw new WorkspaceError(
            "path_not_found",
            `Unmanaged workspace path does not exist: ${cwd}`,
          );
        }
        if (!(await detectGitRepo(cwd))) {
          throw new WorkspaceError(
            "not_git_repo",
            `Cannot checkout branch on non-git workspace: ${cwd}`,
          );
        }

        await withCheckoutMutationLock(
          cwd,
          async () => {
            throwIfProvisionAborted(signal);
            const lockAcquiredAt = Date.now();
            onProgress?.({
              type: "step",
              key: "git-checkout-waiting",
              text:
                checkout.kind === "new"
                  ? `Ready to create branch ${checkout.name}`
                  : `Ready to switch to branch ${checkout.name}`,
              status: "completed",
              startedAt: waitingStartedAt,
              metadata: { durationMs: lockAcquiredAt - waitingStartedAt },
            });
            waitingCompleted = true;
            startedAt = lockAcquiredAt;
            const preflightResult = await validateUnmanagedCheckout({
              cwd,
              checkout,
              signal,
            });
            if (preflightResult.kind === "already-current") {
              alreadyOnTarget = true;
              return;
            }
            onProgress?.({
              type: "step",
              key: "git-checkout-started",
              text:
                checkout.kind === "new"
                  ? `Creating branch ${checkout.name}`
                  : `Switching to branch ${checkout.name}`,
              status: "started",
              startedAt,
            });
            await runGit(switchArgs, { cwd, signal });
          },
          signal,
        );
      },
      signal,
    );
    waitingCompleted = true;
    onProgress?.({
      type: "step",
      key: "git-checkout-completed",
      text: getCheckoutCompletedText({ checkout, alreadyOnTarget }),
      status: "completed",
      startedAt,
      metadata: { durationMs: Date.now() - startedAt },
    });
  } catch (error) {
    const failedAt = Date.now();
    if (!waitingCompleted) {
      onProgress?.({
        type: "step",
        key: "git-checkout-waiting",
        text:
          checkout.kind === "new"
            ? `Failed waiting to create branch ${checkout.name}`
            : `Failed waiting to switch to branch ${checkout.name}`,
        status: "failed",
        startedAt: waitingStartedAt,
        metadata: { durationMs: failedAt - waitingStartedAt },
      });
    }
    onProgress?.({
      type: "step",
      key: "git-checkout-failed",
      text:
        checkout.kind === "new"
          ? `Failed to create branch ${checkout.name}`
          : `Failed to switch to branch ${checkout.name}`,
      status: "failed",
      startedAt,
      metadata: { durationMs: failedAt - startedAt },
    });
    throw error;
  }
}

async function provisionUnmanaged(
  opts: UnmanagedWorkspaceOpts,
): Promise<HostWorkspace> {
  let isGitRepo: boolean;
  throwIfProvisionAborted(opts.signal);
  if (opts.checkout) {
    await applyUnmanagedCheckout({
      cwd: opts.path,
      checkout: opts.checkout,
      onProgress: opts.onProgress,
      signal: opts.signal,
    });
    isGitRepo = true;
  } else {
    throwIfProvisionAborted(opts.signal);
    if (!(await pathExists(opts.path))) {
      throw new WorkspaceError(
        "path_not_found",
        `Unmanaged workspace path does not exist: ${opts.path}`,
      );
    }
    isGitRepo = await detectGitRepo(opts.path);
  }
  const isWorktree = isGitRepo ? await detectWorktree(opts.path) : false;

  return new ProvisionedHostWorkspace({
    path: opts.path,
    managed: false,
    isGitRepo,
    isWorktree,
    destroyFn: async () => {
      // no-op for unmanaged workspaces
    },
  });
}

async function provisionWorktree(
  opts: ManagedWorktreeOpts,
): Promise<HostWorkspace> {
  throwIfProvisionAborted(opts.signal);
  const { path: wsPath } = await createWorktree({
    sourcePath: opts.sourcePath,
    targetPath: opts.targetPath,
    branchName: opts.branchName,
    startPoint: opts.startPoint,
    timeoutMs: opts.timeoutMs,
    setupPath: opts.setupPath,
    onProgress: opts.onProgress,
    pruneEmptyParent: true,
    signal: opts.signal,
  });

  return new ProvisionedHostWorkspace({
    path: wsPath,
    managed: true,
    isGitRepo: true,
    isWorktree: true,
    destroyFn: () =>
      removeWorktree({ path: wsPath, force: true, pruneEmptyParent: true }),
  });
}

async function provisionPersonalWorkspace(
  opts: PersonalWorkspaceOpts,
): Promise<HostWorkspace> {
  const targetPath = validatePersonalWorkspaceTargetPath(opts);
  return provisionManagedEmptyWorkspace(opts, targetPath);
}

async function provisionIsolatedScratchWorkspace(
  opts: IsolatedScratchWorkspaceOpts,
): Promise<HostWorkspace> {
  const targetPath = validateIsolatedScratchWorkspaceTargetPath(opts);
  return provisionManagedEmptyWorkspace(opts, targetPath);
}

async function requireExactRevision(
  opts: Pick<
    DetachedReadOnlyWorkspaceOpts,
    "sourcePath" | "objectFormat" | "baseRevision" | "signal"
  >,
): Promise<void> {
  const format = await runGit(["rev-parse", "--show-object-format"], {
    cwd: opts.sourcePath,
    allowFailure: true,
    signal: opts.signal,
  });
  const revision = await runGit(
    ["rev-parse", "--verify", `${opts.baseRevision}^{commit}`],
    {
      cwd: opts.sourcePath,
      allowFailure: true,
      signal: opts.signal,
    },
  );
  if (
    format.exitCode !== 0 ||
    format.stdout.trim() !== opts.objectFormat ||
    revision.exitCode !== 0 ||
    revision.stdout.trim() !== opts.baseRevision
  ) {
    throw new WorkspaceError(
      "repository_revision_unavailable",
      "The exact repository revision is unavailable",
    );
  }
}

async function provisionDetachedReadOnlyWorkspace(
  opts: DetachedReadOnlyWorkspaceOpts,
): Promise<HostWorkspace> {
  const { targetPath, outputPath } =
    validateDetachedReadOnlyWorkspacePaths(opts);
  throwIfProvisionAborted(opts.signal);
  if (
    !(await pathExists(opts.sourcePath)) ||
    !(await detectGitRepo(opts.sourcePath))
  ) {
    throw new WorkspaceError(
      "repository_revision_unavailable",
      "The registered repository is unavailable",
    );
  }
  await requireExactRevision(opts);

  const targetExisted = await pathExists(targetPath);
  if (!targetExisted) {
    await mkdir(path.dirname(targetPath), { recursive: true });
    try {
      await runGitWithWorktreeMetadataLock(
        ["worktree", "add", "--detach", targetPath, opts.baseRevision],
        { cwd: opts.sourcePath, signal: opts.signal },
      );
    } catch (error) {
      await removeWorktree({
        path: targetPath,
        force: true,
        pruneEmptyParent: true,
      });
      throw error;
    }
  }

  const [isGitRepo, checkoutRef] = await Promise.all([
    detectGitRepo(targetPath),
    getCheckoutRef(targetPath),
  ]);
  const head = await runGit(["rev-parse", "HEAD"], {
    cwd: targetPath,
    allowFailure: true,
    signal: opts.signal,
  });
  if (
    !isGitRepo ||
    checkoutRef.kind !== "detached" ||
    head.exitCode !== 0 ||
    head.stdout.trim() !== opts.baseRevision
  ) {
    if (!targetExisted) {
      await removeWorktree({
        path: targetPath,
        force: true,
        pruneEmptyParent: true,
      });
    }
    throw new WorkspaceError(
      "repository_revision_unavailable",
      "Detached checkout does not match the exact repository revision",
    );
  }

  await mkdir(outputPath, { recursive: true });
  return new ProvisionedHostWorkspace({
    path: targetPath,
    managed: true,
    isGitRepo: true,
    isWorktree: true,
    readOnly: true,
    additionalWorkspaceWriteRoots: [outputPath],
    destroyFn: async () => {
      await removeWorktree({
        path: targetPath,
        force: true,
        pruneEmptyParent: true,
      });
      await rm(outputPath, { recursive: true, force: true });
    },
  });
}

async function provisionManagedEmptyWorkspace(
  opts: ProvisionBase,
  targetPath: string,
): Promise<HostWorkspace> {
  throwIfProvisionAborted(opts.signal);
  const targetExisted = await pathExists(targetPath);
  await mkdir(targetPath, { recursive: true });
  try {
    throwIfProvisionAborted(opts.signal);
  } catch (error) {
    if (!targetExisted) {
      await rm(targetPath, { recursive: true, force: true });
    }
    throw error;
  }
  const detectedGitRepo = targetExisted
    ? await detectGitRepo(targetPath)
    : false;
  const isGitRepo = detectedGitRepo
    ? await hasContainedPersonalGitMetadata(targetPath)
    : false;
  const isWorktree = isGitRepo ? await detectWorktree(targetPath) : false;
  return new ProvisionedHostWorkspace({
    path: targetPath,
    managed: true,
    isGitRepo,
    isWorktree,
    destroyFn: () => rm(targetPath, { recursive: true, force: true }),
  });
}

async function reconnectManaged(
  wsPath: string,
  destroyFn: () => Promise<void>,
  signal: AbortSignal | undefined,
): Promise<HostWorkspace> {
  throwIfProvisionAborted(signal);
  if (!(await pathExists(wsPath))) {
    throw new WorkspaceError(
      "path_not_found",
      `Managed workspace path does not exist: ${wsPath}`,
    );
  }

  const isGitRepo = await detectGitRepo(wsPath);
  const isWorktree = isGitRepo ? await detectWorktree(wsPath) : false;

  return new ProvisionedHostWorkspace({
    path: wsPath,
    managed: true,
    isGitRepo,
    isWorktree,
    destroyFn,
  });
}

async function reconnectManagedWorktree(
  opts: ReconnectManagedWorktreeOpts,
): Promise<HostWorkspace> {
  return reconnectManaged(
    opts.path,
    () =>
      removeWorktree({ path: opts.path, force: true, pruneEmptyParent: true }),
    opts.signal,
  );
}

async function reconnectDetachedReadOnlyWorkspace(
  opts: ReconnectDetachedReadOnlyWorkspaceOpts,
): Promise<HostWorkspace> {
  const workspace = await reconnectManaged(
    opts.path,
    () =>
      removeWorktree({ path: opts.path, force: true, pruneEmptyParent: true }),
    opts.signal,
  );
  if ((await workspace.getCurrentBranch()) !== null) {
    throw new WorkspaceError(
      "repository_revision_unavailable",
      "Detached read-only checkout is no longer detached",
    );
  }
  await mkdir(opts.outputPath, { recursive: true });
  return new ProvisionedHostWorkspace({
    path: workspace.path,
    managed: true,
    isGitRepo: workspace.isGitRepo,
    isWorktree: workspace.isWorktree,
    readOnly: true,
    additionalWorkspaceWriteRoots: [opts.outputPath],
    destroyFn: async () => {
      await workspace.destroy();
      await rm(opts.outputPath, { recursive: true, force: true });
    },
  });
}
