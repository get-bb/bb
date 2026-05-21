import path from "node:path";
import type { WorkSessionDeps } from "../../types.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";

export interface ResolveThreadStorageRootPathArgs {
  dataDir: string;
  env?: NodeJS.ProcessEnv;
}

export interface RequireThreadStoragePathArgs {
  hostId: string;
  threadId: string;
}

export interface ResolveThreadStoragePathFromRootArgs {
  threadId: string;
  threadStorageRootPath: string;
}

export interface ThreadStorageContext {
  dataDir: string;
  threadStoragePath: string;
}

const THREAD_STORAGE_ENV_VAR = "BB_THREAD_STORAGE";

export function resolveThreadStorageRootPath(
  args: ResolveThreadStorageRootPathArgs,
): string {
  const env = args.env ?? process.env;
  const configuredRoot = env[THREAD_STORAGE_ENV_VAR];
  if (configuredRoot && configuredRoot.trim().length > 0) {
    return path.resolve(configuredRoot);
  }
  return path.join(args.dataDir, "thread-storage");
}

export function resolveThreadStoragePathFromRoot(
  args: ResolveThreadStoragePathFromRootArgs,
): string {
  return path.join(args.threadStorageRootPath, args.threadId);
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
    threadStoragePath: resolveThreadStoragePathFromRoot({
      threadStorageRootPath: resolveThreadStorageRootPath({
        dataDir: session.dataDir,
      }),
      threadId: args.threadId,
    }),
  };
}

export async function requireThreadStoragePath(
  deps: WorkSessionDeps,
  args: RequireThreadStoragePathArgs,
): Promise<string> {
  const context = await requireThreadStorageContext(deps, args);
  return context.threadStoragePath;
}
