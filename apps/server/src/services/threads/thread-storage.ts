import path from "node:path";
import { getLatestSessionForHost } from "@bb/db";
import { ApiError } from "../../errors.js";
import type { WorkSessionDeps } from "../../types.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";

interface RequireThreadStoragePathArgs {
  hostId: string;
  threadId: string;
}

export async function requireThreadStoragePath(
  deps: WorkSessionDeps,
  args: RequireThreadStoragePathArgs,
): Promise<string> {
  const session = getLatestSessionForHost(deps.db, { hostId: args.hostId });
  if (session === null) {
    throw new ApiError(
      502,
      "host_unavailable",
      "The host has no known storage location",
      false,
    );
  }
  return path.join(session.dataDir, "thread-storage", args.threadId);
}

export async function requireLiveThreadStoragePath(
  deps: WorkSessionDeps,
  args: RequireThreadStoragePathArgs,
): Promise<string> {
  const session = await ensureHostSessionReadyForWork(deps, {
    hostId: args.hostId,
  });
  return path.join(session.dataDir, "thread-storage", args.threadId);
}
