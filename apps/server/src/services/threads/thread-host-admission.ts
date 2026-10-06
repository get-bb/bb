import { getEnvironment, getHost, type DbQueryConnection } from "@bb/db";
import type { Thread } from "@bb/domain";
import { ApiError } from "../../errors.js";

export function assertThreadHostAcceptsWork(
  db: DbQueryConnection,
  thread: Pick<Thread, "environmentId">,
): void {
  if (thread.environmentId === null) return;
  const environment = getEnvironment(db, thread.environmentId);
  if (environment === null) return;
  const host = getHost(db, environment.hostId);
  if (host?.phase === "removing") {
    throw new ApiError(
      409,
      "machine_removing",
      "Machine removal has begun; this thread is read-only",
    );
  }
  if (
    host !== null &&
    (host.destroyedAt !== null || host.phase === "destroyed")
  ) {
    throw new ApiError(404, "host_not_found", "Host not found");
  }
}
