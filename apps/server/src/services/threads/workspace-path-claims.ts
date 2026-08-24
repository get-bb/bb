import {
  findForeignManagedEnvironmentAtHostPath,
  findProjectEnvironmentByHostPath,
  hasLiveThreadAtHostPath,
  type DbConnection,
} from "@bb/db";
import { isBbManagedWorkspacePath } from "./worktree-paths.js";

/**
 * A workspace path is claimed per project: two projects may each hold their own
 * environment for one folder. Safety questions about the folder itself are not
 * project-scoped, though — the directory is shared physically. These helpers
 * answer those questions across every project.
 */

interface UnmanagedAttachRefusal {
  reason: "foreign-managed" | "live-thread";
  message: string;
}

interface UnmanagedAttachCheckArgs {
  /** Host data directory, for recognizing bb's own workspace roots. */
  dataDir: string | null;
  /** Set when the request also checks out a branch, which rewrites the tree. */
  checksOutBranch: boolean;
  hostId: string;
  path: string;
  projectId: string;
}

/**
 * Why an unmanaged attach to this directory must be refused, or null when it is
 * safe. Two hazards survive project scoping:
 *
 * 1. The directory is a bb-managed workspace owned by another project. Cleanup
 *    of the owner deletes it out from under the attached thread. A managed
 *    environment stores its path only after the host reports success, so the
 *    row alone is not a reliable claim — bb's workspace roots close that
 *    window.
 * 2. A branch checkout rewrites the working tree while another project's agent
 *    is working in the same folder.
 */
export function unmanagedAttachRefusal(
  db: DbConnection,
  args: UnmanagedAttachCheckArgs,
): UnmanagedAttachRefusal | null {
  const foreignManagedMessage =
    "Workspace path is a bb-managed workspace owned by another project";

  if (
    findForeignManagedEnvironmentAtHostPath(db, {
      hostId: args.hostId,
      path: args.path,
      projectId: args.projectId,
    })
  ) {
    return { reason: "foreign-managed", message: foreignManagedMessage };
  }

  // A path under bb's workspace roots belongs to a managed environment even
  // when that environment has not stored its path yet.
  if (
    args.dataDir !== null &&
    isBbManagedWorkspacePath({ dataDir: args.dataDir, path: args.path }) &&
    !findProjectOwnsPath(db, args)
  ) {
    return { reason: "foreign-managed", message: foreignManagedMessage };
  }

  if (
    args.checksOutBranch &&
    hasLiveThreadAtHostPath(db, { hostId: args.hostId, path: args.path })
  ) {
    return {
      reason: "live-thread",
      message:
        "Cannot checkout branch while another thread is using this workspace",
    };
  }

  return null;
}

/**
 * A project may still attach to a bb-managed path it already owns — that is a
 * plain reuse of its own workspace, not a cross-project alias.
 */
function findProjectOwnsPath(
  db: DbConnection,
  args: Pick<UnmanagedAttachCheckArgs, "hostId" | "path" | "projectId">,
): boolean {
  return (
    findProjectEnvironmentByHostPath(
      db,
      args.projectId,
      args.hostId,
      args.path,
    ) !== null
  );
}
