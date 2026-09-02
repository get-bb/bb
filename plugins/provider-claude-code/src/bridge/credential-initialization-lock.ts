import { createHash } from "node:crypto";
import { mkdir, open, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import lockfile from "proper-lockfile";

export interface ClaudeCredentialInitializationCoordinator {
  run<T>(env: NodeJS.ProcessEnv, work: () => Promise<T>): Promise<T>;
}

interface CreateClaudeCredentialInitializationCoordinatorArgs {
  lockRoot: string;
  platform?: NodeJS.Platform;
  retryIntervalMs?: number;
  staleMs?: number;
  updateMs?: number;
}

const DEFAULT_STALE_MS = 30_000;
const DEFAULT_UPDATE_MS = 10_000;
const DEFAULT_RETRY_INTERVAL_MS = 100;
const MAX_WAIT_MS = 15 * 60_000;

function resolveClaudeConfigDir(env: NodeJS.ProcessEnv): string {
  const homeDir = env.HOME?.trim() || homedir();
  const configured = env.CLAUDE_CONFIG_DIR?.trim();
  if (!configured) {
    return join(homeDir, ".claude");
  }
  if (configured === "~") {
    return homeDir;
  }
  if (configured.startsWith("~/") || configured.startsWith("~\\")) {
    return resolve(homeDir, configured.slice(2));
  }
  return isAbsolute(configured)
    ? resolve(configured)
    : resolve(homeDir, configured);
}

async function canonicalCredentialStorePath(
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const configDir = resolveClaudeConfigDir(env);
  try {
    return await realpath(configDir);
  } catch {
    return configDir;
  }
}

function isEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

async function credentialStoreLockName(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<string | null> {
  if (
    isEnabled(env.CLAUDE_CODE_USE_BEDROCK) ||
    isEnabled(env.CLAUDE_CODE_USE_VERTEX) ||
    isEnabled(env.CLAUDE_CODE_USE_FOUNDRY) ||
    env.ANTHROPIC_AUTH_TOKEN?.trim() ||
    env.ANTHROPIC_API_KEY?.trim() ||
    env.CLAUDE_CODE_OAUTH_TOKEN?.trim()
  ) {
    return null;
  }
  if (platform === "darwin") {
    return createHash("sha256").update("macos-keychain").digest("hex");
  }
  const credentialStorePath = await canonicalCredentialStorePath(env);
  return createHash("sha256")
    .update(`credentials-file\0${credentialStorePath}`)
    .digest("hex");
}

export function createClaudeCredentialInitializationCoordinator(
  args: CreateClaudeCredentialInitializationCoordinatorArgs,
): ClaudeCredentialInitializationCoordinator {
  const staleMs = args.staleMs ?? DEFAULT_STALE_MS;
  const updateMs = args.updateMs ?? DEFAULT_UPDATE_MS;
  const retryIntervalMs = args.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
  const retries = Math.ceil(MAX_WAIT_MS / retryIntervalMs);
  const platform = args.platform ?? process.platform;

  return {
    async run(env, work) {
      const lockName = await credentialStoreLockName(env, platform);
      if (lockName === null) {
        return work();
      }
      await mkdir(args.lockRoot, { recursive: true, mode: 0o700 });
      const lockPath = join(args.lockRoot, lockName);
      const handle = await open(lockPath, "a", 0o600);
      await handle.close();

      const release = await lockfile.lock(lockPath, {
        realpath: false,
        stale: staleMs,
        update: updateMs,
        retries: {
          retries,
          factor: 1,
          minTimeout: retryIntervalMs,
          maxTimeout: retryIntervalMs,
        },
      });
      try {
        return await work();
      } finally {
        await release();
      }
    },
  };
}
