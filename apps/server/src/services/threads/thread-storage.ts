import path from "node:path";
import type { WorkSessionDeps } from "../../types.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";

export interface RequireThreadStoragePathArgs {
  hostId: string;
  threadId: string;
}

export interface ThreadStorageContext {
  dataDir: string;
  threadStoragePath: string;
}

export async function requireThreadStorageContext(
  deps: WorkSessionDeps,
  args: RequireThreadStoragePathArgs,
): Promise<ThreadStorageContext> {
  const session = await ensureHostSessionReadyForWork(deps, {
    hostId: args.hostId,
  });
  return {
    dataDir: session.dataDir,
    threadStoragePath: path.join(
      session.dataDir,
      "thread-storage",
      args.threadId,
    ),
  };
}

export async function requireThreadStoragePath(
  deps: WorkSessionDeps,
  args: RequireThreadStoragePathArgs,
): Promise<string> {
  const context = await requireThreadStorageContext(deps, args);
  return context.threadStoragePath;
}
