import type { AgentRuntimeOptions } from "@bb/agent-runtime";

export type RuntimeShellEnv = NonNullable<AgentRuntimeOptions["shellEnv"]>;

export interface RuntimeShellEnvCacheOptions {
  applyShellEnv: (shellEnv: RuntimeShellEnv) => Promise<void>;
  now: () => number;
  onRefreshError: (error: unknown) => void;
  readShellEnv: () => RuntimeShellEnv;
  resolveShellEnv?: () => Promise<RuntimeShellEnv>;
  resolvedAtMs?: number;
  ttlMs: number;
}

export interface RuntimeShellEnvRefreshArgs {
  allowStale: boolean;
}

export interface RuntimeShellEnvCache {
  refresh(args: RuntimeShellEnvRefreshArgs): Promise<RuntimeShellEnv>;
}

interface CacheEntry {
  expiresAtMs: number;
  promise: Promise<RuntimeShellEnv>;
}

export function createRuntimeShellEnvCache(
  options: RuntimeShellEnvCacheOptions,
): RuntimeShellEnvCache {
  const resolveShellEnv = options.resolveShellEnv;
  let hasResolvedEnv = options.resolvedAtMs !== undefined;
  let entry: CacheEntry | null =
    options.resolvedAtMs === undefined
      ? null
      : {
          expiresAtMs: options.resolvedAtMs + options.ttlMs,
          promise: Promise.resolve(options.readShellEnv()),
        };

  return {
    async refresh({ allowStale }) {
      if (!resolveShellEnv) {
        return options.readShellEnv();
      }
      const now = options.now();
      if (entry && entry.expiresAtMs > now) {
        return allowStale && hasResolvedEnv
          ? options.readShellEnv()
          : entry.promise;
      }

      const promise = (async () => {
        await options.applyShellEnv(await resolveShellEnv());
        hasResolvedEnv = true;
        return options.readShellEnv();
      })();
      const started: CacheEntry = {
        expiresAtMs: now + options.ttlMs,
        promise,
      };
      entry = started;
      const resolved = promise.catch((error: unknown) => {
        if (entry === started) {
          entry = null;
        }
        throw error;
      });
      if (allowStale && hasResolvedEnv) {
        resolved.catch(options.onRefreshError);
        return options.readShellEnv();
      }
      return resolved;
    },
  };
}
