export const CONNECT_DB_MODES = ["d1", "d1+pg", "pg+d1", "pg"] as const;
export type ConnectDbMode = (typeof CONNECT_DB_MODES)[number];

export const CONNECT_DB_MODE_KEY = "connect-db-mode";
export const CONNECT_DB_MODE_CACHE_MS = 15_000;
const KV_CACHE_TTL_SECONDS = 30;

export function parseConnectDbMode(value: unknown): ConnectDbMode | null {
  return typeof value === "string" &&
    (CONNECT_DB_MODES as readonly string[]).includes(value)
    ? (value as ConnectDbMode)
    : null;
}

export interface KvLike {
  get(key: string, options: { cacheTtl: number }): Promise<string | null>;
}

export interface ConnectDbModeSource {
  CONNECT_DB_FLAGS?: KvLike;
  HYPERDRIVE?: { connectionString: string };
}

let cached: { mode: ConnectDbMode; at: number } | null = null;

export function resetConnectDbModeCache(): void {
  cached = null;
}

export async function resolveConnectDbMode(
  env: ConnectDbModeSource,
  now: number = Date.now(),
): Promise<ConnectDbMode> {
  if (!env.HYPERDRIVE || !env.CONNECT_DB_FLAGS) return "d1";
  if (cached !== null && now - cached.at < CONNECT_DB_MODE_CACHE_MS) {
    return cached.mode;
  }
  let mode: ConnectDbMode;
  try {
    const stored = await env.CONNECT_DB_FLAGS.get(CONNECT_DB_MODE_KEY, {
      cacheTtl: KV_CACHE_TTL_SECONDS,
    });
    mode = parseConnectDbMode(stored) ?? "d1";
  } catch (error) {
    mode = cached?.mode ?? "d1";
    console.error("connect-db mode lookup failed", {
      error: error instanceof Error ? error.message : String(error),
      fallback: mode,
    });
  }
  cached = { mode, at: now };
  return mode;
}
