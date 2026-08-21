import path from "node:path";
import type { WorkSessionDeps } from "../../types.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";

interface ResolveThreadStorageRootPathArgs {
  dataDir: string;
  env?: NodeJS.ProcessEnv;
}

interface RequireThreadStoragePathArgs {
  hostId: string;
  threadId: string;
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

export async function requireThreadStoragePath(
  deps: WorkSessionDeps,
  args: RequireThreadStoragePathArgs,
): Promise<string> {
  const session = await ensureHostSessionReadyForWork(deps, {
    hostId: args.hostId,
  });
  return path.join(
    resolveThreadStorageRootPath({ dataDir: session.dataDir, env: {} }),
    args.threadId,
  );
}
