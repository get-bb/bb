import type { EntityKind } from "../../../lib/sync/registry.js";
import type { JsonValue } from "../../../shared/contract.js";
import type { Conflict, FieldValue } from "../plan/index.js";
import { detectConflicts } from "./detect.js";
import type { ConflictAttribution, FieldConflict } from "./detect.js";
import { conflictPolicy } from "./policy.js";

export type AttributionProvider = (
  kind: EntityKind,
  key: string,
  paths: readonly string[],
) => Promise<ConflictAttribution>;

const providers = new Map<EntityKind, AttributionProvider>();
const cache = new Map<string, Promise<ConflictAttribution>>();

function unavailable(): ConflictAttribution {
  return { actor: null, at: null, source: null, available: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((entry) => jsonValue(entry));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, jsonValue(entry)]),
    );
  }
  throw new TypeError("Conflict values must be finite JSON values");
}

function fieldValue(value: unknown): FieldValue {
  return value === undefined
    ? { present: false, value: null }
    : { present: true, value: jsonValue(value) };
}

function planConflict(conflict: FieldConflict): Conflict {
  return {
    field: conflict.path === "" ? "#" : conflict.path,
    base: fieldValue(conflict.base),
    ours: fieldValue(conflict.ours),
    theirs: fieldValue(conflict.theirs),
    attribution: conflict.attribution.available
      ? {
        actor: conflict.attribution.actor,
        at: conflict.attribution.at,
        source: conflict.attribution.source,
      }
      : null,
    suggestion: conflict.suggestion,
    resolution: null,
  };
}

function cachePrefix(kind: EntityKind): string {
  return `${kind}\0`;
}

/** Installs or replaces the audit provider owned by one semantic surface. */
export function registerAttributionProvider(kind: EntityKind, provider: AttributionProvider): void {
  providers.set(kind, provider);
  const prefix = cachePrefix(kind);
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
}

function cacheKey(kind: EntityKind, key: string, paths: readonly string[]): string {
  return `${kind}\0${key}\0${[...new Set(paths)].sort((left, right) => left.localeCompare(right)).join("\0")}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Audit attribution timed out")), timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

/** Fetches cached attribution and converts provider failure/timeout to unavailable. */
export function conflictAttribution(
  kind: EntityKind,
  key: string,
  paths: readonly string[],
  timeoutMs = 2_000,
): Promise<ConflictAttribution> {
  const provider = providers.get(kind);
  if (provider === undefined) return Promise.resolve(unavailable());
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Attribution timeout must be positive");
  }
  const normalizedPaths = [...new Set(paths)].sort((left, right) => left.localeCompare(right));
  const id = cacheKey(kind, key, normalizedPaths);
  const current = cache.get(id);
  if (current !== undefined) return current;
  const pending = withTimeout(provider(kind, key, normalizedPaths), timeoutMs)
    .then((value) => value.available ? { ...value } : unavailable())
    .catch(() => unavailable());
  cache.set(id, pending);
  return pending;
}

/** Adds audit data and policy suggestions without ever applying a resolution. */
export async function attributeConflicts(
  conflicts: readonly FieldConflict[],
  timeoutMs = 2_000,
): Promise<FieldConflict[]> {
  const groups = new Map<string, FieldConflict[]>();
  for (const conflict of conflicts) {
    const id = `${conflict.kind}\0${conflict.key}`;
    const group = groups.get(id) ?? [];
    group.push(conflict);
    groups.set(id, group);
  }

  const attributed = new Map<FieldConflict, FieldConflict>();
  await Promise.all([...groups.values()].map(async (group) => {
    const first = group[0];
    if (first === undefined) return;
    const attribution = await conflictAttribution(
      first.kind,
      first.key,
      group.map((conflict) => conflict.path),
      timeoutMs,
    );
    const policy = conflictPolicy(first.kind);
    for (const conflict of group) {
      const withAttribution: FieldConflict = {
        ...conflict,
        attribution,
        suggestion: null,
        resolution: conflict.resolution === null ? null : { ...conflict.resolution },
      };
      attributed.set(conflict, {
        ...withAttribution,
        suggestion: policy.suggest(withAttribution),
      });
    }
  }));
  return conflicts.map((conflict) => attributed.get(conflict) ?? conflict);
}

/** Owned hook that projects rich pointer conflicts into the frozen plan shape. */
export async function refinePlanConflicts(input: {
  kind: EntityKind;
  key: string;
  base: unknown;
  ours: unknown;
  theirs: unknown;
  attributionTimeoutMs?: number;
}): Promise<Conflict[]> {
  const detected = detectConflicts(input);
  return (await attributeConflicts(detected.conflicts, input.attributionTimeoutMs)).map(planConflict);
}
