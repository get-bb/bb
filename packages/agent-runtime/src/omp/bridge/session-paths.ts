import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const OMP_BRIDGE_SESSION_DIR_ENV = "BB_OMP_BRIDGE_SESSION_DIR";

export interface ResolveOmpBridgeSessionDirArgs {
  env: NodeJS.ProcessEnv;
}

export interface ResolveOmpSessionFilePathArgs
  extends ResolveOmpBridgeSessionDirArgs {
  threadId: string;
}

export function resolveOmpBridgeSessionDir(
  args: ResolveOmpBridgeSessionDirArgs,
): string {
  const configuredSessionDir = args.env[OMP_BRIDGE_SESSION_DIR_ENV]?.trim();
  if (configuredSessionDir) {
    return resolve(configuredSessionDir);
  }

  return join(homedir(), ".bb", "omp-bridge-sessions");
}

export function resolveOmpSessionFilePath(
  args: ResolveOmpSessionFilePathArgs,
): string {
  return join(
    resolveOmpBridgeSessionDir({ env: args.env }),
    `${sanitizeSessionKey(args.threadId)}.jsonl`,
  );
}

function sanitizeSessionKey(threadId: string): string {
  return threadId.replace(/[^A-Za-z0-9._-]/g, "_");
}
