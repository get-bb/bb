import { environments, type EnvironmentRow } from "@bb/db";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import type { AppDeps, WorkSessionDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";

export function isManagedWorktree(row: EnvironmentRow): boolean {
  return row.providerOwnsPath && row.isWorktree && row.status !== "destroyed";
}

export async function readArchiveWorktreeState(
  deps: WorkSessionDeps,
  row: EnvironmentRow,
): Promise<"clean" | "changes" | "unavailable"> {
  if (row.path === null || row.status !== "ready") return "unavailable";
  try {
    const status = await callHostRetryableOnlineRpc(deps, {
      hostId: row.hostId,
      timeoutMs: 20_000,
      command: {
        type: "workspace.archive_status",
        environmentId: row.id,
        workspaceContext: { workspacePath: row.path },
      },
    });
    return status.hasUncommittedChanges || status.hasUnpushedCommits
      ? "changes"
      : "clean";
  } catch (error) {
    deps.logger.warn(
      { environmentId: row.id, error },
      "Worktree safety check unavailable; keeping worktree",
    );
    return "unavailable";
  }
}

export function retainArchivedWorktree(
  deps: Pick<AppDeps, "db" | "hub">,
  environmentId: string,
): boolean {
  const written = deps.db
    .update(environments)
    .set({ archiveRetained: true, archiveDiscard: false, retireAt: null })
    .where(
      and(
        eq(environments.id, environmentId),
        or(
          isNull(environments.teardownStatus),
          ne(environments.teardownStatus, "running"),
        ),
      ),
    )
    .returning({ id: environments.id })
    .all();
  if (written.length === 0) return false;
  deps.hub.notifyEnvironment(environmentId, ["metadata-changed"]);
  return true;
}
