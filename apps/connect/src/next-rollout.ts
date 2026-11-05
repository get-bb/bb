export const NEXT_ROLLOUT_KEY = "connect-next-rollout";
export const NEXT_ROLLOUT_CACHE_MS = 15_000;
const KV_CACHE_TTL_SECONDS = 30;
const MAX_ROLLOUT_LABELS = 10_000;

export interface NextRollout {
  percent: number;
  labels: ReadonlySet<string>;
}

export const CLOSED_ROLLOUT: NextRollout = { percent: 0, labels: new Set() };
export const OPEN_ROLLOUT: NextRollout = { percent: 100, labels: new Set() };

export interface KvLike {
  get(key: string, options: { cacheTtl: number }): Promise<string | null>;
}

export interface NextRolloutSource {
  CONNECT_DB_FLAGS?: KvLike;
}

export function parseNextRollout(value: string | null): NextRollout | null {
  if (value === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const { percent, labels = [] } = parsed as Record<string, unknown>;
  if (
    typeof percent !== "number" ||
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 100
  ) {
    return null;
  }
  if (
    !Array.isArray(labels) ||
    labels.length > MAX_ROLLOUT_LABELS ||
    !labels.every((label): label is string => typeof label === "string")
  ) {
    return null;
  }
  return { percent, labels: new Set(labels) };
}

let cached: { rollout: NextRollout; at: number } | null = null;

export function resetNextRolloutCache(): void {
  cached = null;
}

export async function readNextRollout(
  env: NextRolloutSource,
  fallback: NextRollout,
  now: number = Date.now(),
): Promise<NextRollout> {
  const kv = env.CONNECT_DB_FLAGS;
  if (kv === undefined) return fallback;
  if (cached !== null && now - cached.at < NEXT_ROLLOUT_CACHE_MS) {
    return cached.rollout;
  }
  let rollout: NextRollout;
  try {
    const raw = await kv.get(NEXT_ROLLOUT_KEY, {
      cacheTtl: KV_CACHE_TTL_SECONDS,
    });
    rollout = parseNextRollout(raw) ?? fallback;
    if (raw !== null && rollout === fallback) {
      console.error("bb connect: invalid connect-next-rollout flag");
    }
  } catch (error) {
    rollout = cached?.rollout ?? fallback;
    console.error("bb connect: connect-next-rollout lookup failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  cached = { rollout, at: now };
  return rollout;
}

export async function rolloutBucket(id: string): Promise<number> {
  const hash = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`connect-next-rollout:${id}`),
    ),
  );
  const value =
    ((hash[0] ?? 0) << 24) |
    ((hash[1] ?? 0) << 16) |
    ((hash[2] ?? 0) << 8) |
    (hash[3] ?? 0);
  return ((value >>> 0) % 10_000) / 100;
}

export async function inNextRollout(
  rollout: NextRollout,
  subject: { label: string; id: string; usedNext: boolean },
): Promise<boolean> {
  if (subject.usedNext || rollout.labels.has(subject.label)) return true;
  if (rollout.percent >= 100) return true;
  if (rollout.percent <= 0) return false;
  return (await rolloutBucket(subject.id)) < rollout.percent;
}
