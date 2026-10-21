import { getThread, getThreadPluginMetadata, type DbConnection } from "@bb/db";
import { ApiError } from "../../errors.js";

export function threadNetworkAccess(
  db: DbConnection,
  threadId: string,
): boolean {
  const thread = getThread(db, threadId);
  if (!thread?.originPluginId) return true;
  const stored = getThreadPluginMetadata(db, threadId, thread.originPluginId);
  if (stored.corrupt) {
    throw new ApiError(
      409,
      "thread_policy_unavailable",
      "The thread's execution policy could not be read.",
    );
  }
  if (stored.metadata.networkAccess !== false) return true;
  return false;
}
