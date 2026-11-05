import type { ProvisioningTranscriptEntry } from "@bb/domain";
import { pathExists } from "@bb/process-utils";
import {
  type CommitOptions,
  type LocalStateSnapshot,
  type CommitResult,
  Workspace,
} from "./host-workspace.js";
import { inspectGitRepository, type SharedGitRefsSnapshot } from "./git.js";
import { throwIfProvisionAborted } from "bb-environment-provider-host/transcript";
import { WorkspaceError } from "bb-environment-provider-host/workspace-git";

type ProvisionProgressCallback = (entry: ProvisioningTranscriptEntry) => void;

interface ProvisionBase {
  onProgress?: ProvisionProgressCallback;
  shellPath?: string;
  signal?: AbortSignal;
}

interface UnmanagedWorkspaceOpts extends ProvisionBase {
  path: string;
}

export type ProvisionWorkspaceArgs = UnmanagedWorkspaceOpts;

export interface HostWorkspace {
  readonly path: string;
  readonly isGitRepo: boolean;
  readonly isWorktree: boolean;
  readonly gitCommonDir: string | null;

  getDefaultBranch(): Promise<string | null>;
  getCurrentBranch(): Promise<string | null>;
  getHeadSha(): Promise<string | null>;
  getLocalStateSnapshot(): Promise<LocalStateSnapshot>;
  getSharedGitRefsSnapshot(): Promise<SharedGitRefsSnapshot>;
  getAdditionalWorkspaceWriteRoots(): Promise<string[]>;
  commit(options: CommitOptions): Promise<CommitResult>;
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
  const { isGitRepo, isWorktree, gitCommonDir } = await inspectGitRepository(
    opts.path,
    {
      ...(opts.shellPath !== undefined ? { shellPath: opts.shellPath } : {}),
    },
  );

  return new Workspace({
    path: opts.path,
    isGitRepo,
    isWorktree,
    gitCommonDir,
    shellPath: opts.shellPath,
  });
}
