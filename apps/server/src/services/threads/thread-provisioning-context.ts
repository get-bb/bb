import { readThreadProvisionContext } from "./thread-startup-store.js";
import {
  getEnvironment,
  getPreparingEnvironment,
  getThread,
  type DbConnection,
  type DbTransaction,
} from "@bb/db";

export function readThreadProvisioningStage(
  db: DbConnection | DbTransaction,
  threadId: string,
) {
  const thread = getThread(db, threadId);
  if (thread === null || thread.status !== "starting") return "inactive";
  const request = readThreadProvisionContext(db, threadId)?.request;
  const environment =
    getPreparingEnvironment(db, threadId) ??
    (request?.environmentIntent.type !== "reuse" ||
    thread.environmentId === null
      ? null
      : getEnvironment(db, thread.environmentId));
  if (environment === null)
    return thread.title === null ? "metadata-pending" : "environment-pending";
  return environment.status;
}
