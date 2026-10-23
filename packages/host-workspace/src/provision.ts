import {
  inspectGitRepository,
  readRepoDefaultBranch,
  readWorkTreeLocation,
  WorkspaceError,
} from "bb-environment-provider-host/git";
import type {
  ProvisioningTranscriptEntry,
  WorkspaceDescriptor,
  WorkspaceRepositoryLocation,
  WorkspaceStatus,
} from "@bb/domain";
import { pathExists } from "@bb/process-utils";
import type {
  CommitOptions,
  LocalStateSnapshot,
  CommitResult,
  DiffOptions,
  DiffResult,
  DiffFilesArgs,
  DiffFilesResult,
  DiffPatchArgs,
  DiffPatchEntry,
  StatusOptions,
} from "./workspace.js";
import { Workspace } from "./workspace.js";
import type { SharedGitRefsSnapshot, GitProcessOptions } from "./git.js";
import { resolveAdditionalWorkspaceWriteRoots } from "./workspace-write-roots.js";

type ProvisionProgressCallback = (entry: ProvisioningTranscriptEntry) => void;

function createProvisionCancelledError(cause?: unknown): WorkspaceError {
  return new WorkspaceError(
    "provision_cancelled",
    "Workspace provisioning was cancelled",
    { cause },
  );
}

export function throwIfProvisionAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createProvisionCancelledError(signal.reason);
  }
}

interface ProvisionBase {
  onProgress?: ProvisionProgressCallback;
  shellPath?: string;
  signal?: AbortSignal;
}

interface UnmanagedWorkspaceOpts extends ProvisionBase {
  path: string;
}

export type ProvisionWorkspaceArgs = UnmanagedWorkspaceOpts;

const WORKSPACE_BRANCH_GIT_TIMEOUT_MS = 15_000;

export interface HostWorkspace {
  readonly path: string;
  readonly repository: WorkspaceRepositoryLocation | null;
  readonly isGitRepo: boolean;
  readonly isWorktree: boolean;

  getDefaultBranch(): Promise<string | null>;
  getCurrentBranch(): Promise<string | null>;
  getHeadSha(): Promise<string | null>;
  getLocalStateSnapshot(): Promise<LocalStateSnapshot>;
  getSharedGitRefsSnapshot(): Promise<SharedGitRefsSnapshot>;
  getAdditionalWorkspaceWriteRoots(): Promise<string[]>;
  getStatus(options?: StatusOptions): Promise<WorkspaceStatus>;
  getDiff(options?: DiffOptions): Promise<DiffResult>;
  diffFiles(args: DiffFilesArgs): Promise<DiffFilesResult>;
  diffPatch(args: DiffPatchArgs): Promise<DiffPatchEntry[]>;

  commit(options: CommitOptions): Promise<CommitResult>;
}

class ProvisionedHostWorkspace implements HostWorkspace {
  readonly path: string;
  readonly repository: WorkspaceRepositoryLocation | null;
  readonly isGitRepo: boolean;
  readonly isWorktree: boolean;

  private readonly ws: Workspace;
  private readonly gitProcessOptions: GitProcessOptions;

  constructor(opts: {
    path: string;
    repository: WorkspaceRepositoryLocation | null;
    isWorktree: boolean;
    gitProcessOptions: GitProcessOptions;
  }) {
    this.path = opts.path;
    this.repository = opts.repository;
    this.isGitRepo = opts.repository !== null;
    this.isWorktree = opts.isWorktree;
    this.gitProcessOptions = opts.gitProcessOptions;
    this.ws = new Workspace(
      opts.repository?.root ?? opts.path,
      this.gitProcessOptions,
      this.isGitRepo,
    );
  }

  async getCurrentBranch(): Promise<string | null> {
    return (await this.ws.currentBranch) ?? null;
  }

  async getDefaultBranch(): Promise<string | null> {
    if (!this.isGitRepo) {
      return null;
    }
    return (
      (await readRepoDefaultBranch(this.path, {
        timeoutMs: WORKSPACE_BRANCH_GIT_TIMEOUT_MS,
        ...this.gitProcessOptions,
      })) ?? null
    );
  }

  getHeadSha(): Promise<string | null> {
    return this.ws.getHeadSha();
  }

  getLocalStateSnapshot(): Promise<LocalStateSnapshot> {
    return this.ws.getLocalStateSnapshot();
  }

  getSharedGitRefsSnapshot(): Promise<SharedGitRefsSnapshot> {
    return this.ws.getSharedGitRefsSnapshot();
  }

  getAdditionalWorkspaceWriteRoots(): Promise<string[]> {
    if (!this.isGitRepo || !this.isWorktree) {
      return Promise.resolve([]);
    }
    return resolveAdditionalWorkspaceWriteRoots(
      this.path,
      this.gitProcessOptions,
    );
  }

  async getStatus(options?: StatusOptions): Promise<WorkspaceStatus> {
    if (this.repository === null) {
      throw new WorkspaceError(
        "not_git_repo",
        `Path is not a git repository: ${this.path}`,
      );
    }
    return {
      repository: this.repository,
      ...(await this.ws.getStatus(options)),
    };
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

  commit(options: CommitOptions): Promise<CommitResult> {
    return this.ws.commit(options);
  }
}

export function provisionWorkspace(
  opts: ProvisionWorkspaceArgs,
): Promise<HostWorkspace> {
  return provisionUnmanaged(opts);
}

async function provisionUnmanaged(
  opts: UnmanagedWorkspaceOpts,
): Promise<HostWorkspace> {
  throwIfProvisionAborted(opts.signal);
  if (!(await pathExists(opts.path))) {
    throw new WorkspaceError(
      "path_not_found",
      `Unmanaged workspace path does not exist: ${opts.path}`,
    );
  }
  const gitProcessOptions = {
    ...(opts.shellPath !== undefined ? { shellPath: opts.shellPath } : {}),
  };
  const [inspection, location] = await Promise.all([
    inspectGitRepository(opts.path, gitProcessOptions),
    readWorkTreeLocation(opts.path, gitProcessOptions),
  ]);
  if (inspection.isGitRepo && location === null) {
    throw new WorkspaceError(
      "git_command_failed",
      `Could not read the repository root: ${opts.path}`,
    );
  }
  return new ProvisionedHostWorkspace({
    path: opts.path,
    repository: inspection.isGitRepo ? location : null,
    isWorktree: inspection.isWorktree,
    gitProcessOptions,
  });
}

export async function describeHostWorkspace(
  workspace: HostWorkspace,
): Promise<WorkspaceDescriptor> {
  if (!workspace.isGitRepo) {
    return {
      path: workspace.path,
      repoRoot: null,
      isGitRepo: false,
      isWorktree: false,
      branchName: null,
      defaultBranch: null,
    };
  }
  const [branchName, defaultBranch] = await Promise.all([
    workspace.getCurrentBranch(),
    workspace.getDefaultBranch(),
  ]);
  return {
    path: workspace.path,
    repoRoot: workspace.repository?.root ?? null,
    isGitRepo: true,
    isWorktree: workspace.isWorktree,
    branchName,
    defaultBranch: defaultBranch ?? branchName,
  };
}
