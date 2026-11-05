const NEXT_ROUTE_FLAG_KEY = "connect-next-route";
const NEXT_ROUTE_CACHE_MS = 30_000;
const KV_CACHE_TTL_SECONDS = 30;

interface NextRouteFlag {
  percent: number;
  labels: ReadonlySet<string>;
}

interface FlagStore {
  get(key: string, options: { cacheTtl: number }): Promise<string | null>;
}

export function parseNextRouteFlag(value: string | null): NextRouteFlag | null {
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
  const percent: unknown = Reflect.get(parsed, "percent") ?? 0;
  const labels: unknown = Reflect.get(parsed, "labels") ?? [];
  if (
    typeof percent !== "number" ||
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 100 ||
    !Array.isArray(labels) ||
    !labels.every((label) => typeof label === "string")
  ) {
    return null;
  }
  return {
    percent,
    labels: new Set(labels.map((label: string) => label.toLowerCase())),
  };
}

let cached: { flag: NextRouteFlag | null; at: number } | null = null;

export function resetNextRouteFlagCache(): void {
  cached = null;
}

export async function readNextRouteFlag(
  store: FlagStore | undefined,
  now: number = Date.now(),
): Promise<NextRouteFlag | null> {
  if (store === undefined) return null;
  if (cached !== null && now - cached.at < NEXT_ROUTE_CACHE_MS) {
    return cached.flag;
  }
  let flag: NextRouteFlag | null;
  try {
    flag = parseNextRouteFlag(
      await store.get(NEXT_ROUTE_FLAG_KEY, { cacheTtl: KV_CACHE_TTL_SECONDS }),
    );
  } catch (error) {
    flag = cached?.flag ?? null;
    console.error("bb connect: next route flag lookup failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  cached = { flag, at: now };
  return flag;
}

export function labelBucket(label: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < label.length; index += 1) {
    hash ^= label.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}

export function nextRouteAllows(
  flag: NextRouteFlag | null,
  label: string,
): boolean {
  if (flag === null) return false;
  const normalized = label.toLowerCase();
  return flag.labels.has(normalized) || labelBucket(normalized) < flag.percent;
}
