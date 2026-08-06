import {
  hasNonTerminalThreadInEnvironment,
  listEnvironmentsByHostPath,
  type DbConnection,
} from "@bb/db";
import type { Environment } from "@bb/domain";

/**
 * A workspace path is claimed per project: two projects may each hold their own
 * environment for one folder. Safety questions about the folder itself are not
 * project-scoped, though — the directory is shared physically. These helpers
 * answer those questions across every project.
 */

interface HostPathArgs {
  hostId: string;
  path: string;
}

/**
 * A bb-managed workspace (a worktree bb created and will destroy) owned by a
 * different project. Attaching to it in place is unsafe: cleanup of the owning
 * environment deletes the directory out from under the attached thread.
 */
export function foreignManagedEnvironmentAtHostPath(
  db: DbConnection,
  args: HostPathArgs & { projectId: string },
): Environment | null {
  return (
    listEnvironmentsByHostPath(db, args.hostId, args.path).find(
      (environment) =>
        environment.managed &&
        environment.status !== "destroyed" &&
        environment.projectId !== args.projectId,
    ) ?? null
  );
}

/**
 * Whether any project has a live thread working in this directory. A branch
 * checkout rewrites the working tree, so it must not run while another
 * project's agent is using the same folder.
 */
export function hasLiveThreadAtHostPath(
  db: DbConnection,
  args: HostPathArgs,
): boolean {
  return listEnvironmentsByHostPath(db, args.hostId, args.path).some(
    (environment) =>
      hasNonTerminalThreadInEnvironment(db, { environmentId: environment.id }),
  );
}
