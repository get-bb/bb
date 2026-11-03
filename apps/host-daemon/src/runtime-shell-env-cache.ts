import { createAsyncTtlMemo } from "@bb/async-cache";
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

export function createRuntimeShellEnvCache(
  options: RuntimeShellEnvCacheOptions,
): RuntimeShellEnvCache {
  const resolveShellEnv = options.resolveShellEnv;
  let hasResolvedEnv = options.resolvedAtMs !== undefined;
  const startupFreshUntil =
    options.resolvedAtMs === undefined
      ? -Infinity
      : options.resolvedAtMs + options.ttlMs;
  const cache = createAsyncTtlMemo<string, RuntimeShellEnv>({
    ttlMs: options.ttlMs,
    now: options.now,
    maxEntries: 1,
  });

  return {
    async refresh({ allowStale }) {
      if (!resolveShellEnv || options.now() < startupFreshUntil) {
        return options.readShellEnv();
      }
      const resolved = cache.run("shell", async () => {
        try {
          await options.applyShellEnv(await resolveShellEnv());
          hasResolvedEnv = true;
          return options.readShellEnv();
        } catch (error) {
          if (allowStale && hasResolvedEnv) options.onRefreshError(error);
          throw error;
        }
      });
      if (allowStale && hasResolvedEnv) {
        resolved.catch(() => undefined);
        return options.readShellEnv();
      }
      return resolved;
    },
  };
}
