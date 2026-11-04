export const CONNECT_DB_MODES = ["d1", "d1+pg", "pg+d1", "pg"] as const;
export type ConnectDbMode = (typeof CONNECT_DB_MODES)[number];

export const CONNECT_DB_MODE_KEY = "connect-db-mode";
export const CONNECT_DB_SHADOW_READS_KEY = "connect-db-shadow-reads";
export const CONNECT_DB_MODE_CACHE_MS = 15_000;
const KV_CACHE_TTL_SECONDS = 30;

export function parseConnectDbMode(value: unknown): ConnectDbMode | null {
  return typeof value === "string" &&
    (CONNECT_DB_MODES as readonly string[]).includes(value)
    ? (value as ConnectDbMode)
    : null;
}

export function parseShadowReads(value: unknown): number {
  if (typeof value !== "string" || value.trim() === "") return 0;
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.min(rate, 1);
}

export interface ConnectDbFlags {
  mode: ConnectDbMode;
  shadowReads: number;
}

const DEFAULT_FLAGS: ConnectDbFlags = { mode: "d1", shadowReads: 0 };

export interface KvLike {
  get(key: string, options: { cacheTtl: number }): Promise<string | null>;
}

export interface ConnectDbModeSource {
  CONNECT_DB_FLAGS?: KvLike;
  HYPERDRIVE?: { connectionString: string };
}

let cached: { flags: ConnectDbFlags; at: number } | null = null;

export function resetConnectDbModeCache(): void {
  cached = null;
}

export async function resolveConnectDbFlags(
  env: ConnectDbModeSource,
  now: number = Date.now(),
): Promise<ConnectDbFlags> {
  if (!env.HYPERDRIVE || !env.CONNECT_DB_FLAGS) return DEFAULT_FLAGS;
  if (cached !== null && now - cached.at < CONNECT_DB_MODE_CACHE_MS) {
    return cached.flags;
  }
  const kv = env.CONNECT_DB_FLAGS;
  let flags: ConnectDbFlags;
  try {
    const [mode, shadowReads] = await Promise.all([
      kv.get(CONNECT_DB_MODE_KEY, { cacheTtl: KV_CACHE_TTL_SECONDS }),
      kv.get(CONNECT_DB_SHADOW_READS_KEY, { cacheTtl: KV_CACHE_TTL_SECONDS }),
    ]);
    flags = {
      mode: parseConnectDbMode(mode) ?? "d1",
      shadowReads: parseShadowReads(shadowReads),
    };
  } catch (error) {
    flags = cached?.flags ?? DEFAULT_FLAGS;
    console.error("connect-db mode lookup failed", {
      error: error instanceof Error ? error.message : String(error),
      fallback: flags.mode,
    });
  }
  cached = { flags, at: now };
  return flags;
}

export async function resolveConnectDbMode(
  env: ConnectDbModeSource,
  now: number = Date.now(),
): Promise<ConnectDbMode> {
  return (await resolveConnectDbFlags(env, now)).mode;
}
