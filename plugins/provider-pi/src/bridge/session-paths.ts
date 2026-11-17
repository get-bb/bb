import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const PI_BRIDGE_SESSION_DIR_ENV = "BB_PI_BRIDGE_SESSION_DIR";

interface ResolvePiBridgeSessionDirArgs {
  env: NodeJS.ProcessEnv;
  bridgeDataDir: string | undefined;
}

interface ResolvePiSessionFilePathArgs extends ResolvePiBridgeSessionDirArgs {
  threadId: string;
}

export function resolvePiBridgeSessionDir(
  args: ResolvePiBridgeSessionDirArgs,
): string {
  const configuredSessionDir = args.env[PI_BRIDGE_SESSION_DIR_ENV]?.trim();
  if (configuredSessionDir) {
    return resolve(configuredSessionDir);
  }

  if (args.bridgeDataDir === undefined) {
    throw new Error(
      `The Pi bridge has no session directory: it was not started with a data directory and ${PI_BRIDGE_SESSION_DIR_ENV} is not set.`,
    );
  }
  return join(args.bridgeDataDir, "sessions");
}

export function resolvePiSessionFilePath(
  args: ResolvePiSessionFilePathArgs,
): string {
  const fileName = `${sanitizeSessionKey(args.threadId)}.jsonl`;
  const sessionDir = resolvePiBridgeSessionDir(args);
  const sessionFile = join(sessionDir, fileName);
  if (!args.env[PI_BRIDGE_SESSION_DIR_ENV]?.trim()) {
    adoptLegacySessionFile(sessionDir, sessionFile, fileName);
  }
  return sessionFile;
}

function adoptLegacySessionFile(
  sessionDir: string,
  sessionFile: string,
  fileName: string,
): void {
  const legacyFile = join(homedir(), ".bb", "pi-bridge-sessions", fileName);
  if (existsSync(sessionFile) || !existsSync(legacyFile)) {
    return;
  }
  mkdirSync(sessionDir, { recursive: true });
  copyFileSync(legacyFile, sessionFile);
}

function sanitizeSessionKey(threadId: string): string {
  return threadId.replace(/[^A-Za-z0-9._-]/g, "_");
}
