import type { ThreadEvent } from "@bb/domain";

/**
 * Dual-path calibration support.
 *
 * A calibration replays one scripted provider session through both the legacy
 * adapter and the canonical bridge, then diffs the two ThreadEvent streams.
 * Anything the diff reports is either a deliberate, documented protocol
 * difference (the bridge synthesizes item/started, announces thread/identity,
 * …) or a regression — there is no third category, which is what makes these
 * suites a graduation gate.
 *
 * Ids legitimately differ between the paths: the legacy adapter numbers from
 * its process-lifetime translator ("turn-1", "claude-assistant-2"), while a
 * canonical session mints per-session entropy ("bt3f9a2b1c-1-…") so ids stay
 * unique across resumes (#1224). Normalization interns them by first-seen
 * order instead of matching either scheme, so a stream that *reused* an id
 * still diffs.
 */

export interface NormalizeCalibrationEventsOptions {
  /**
   * Ids the provider itself owns (tool call ids, checkpoints) are identical on
   * both paths and are left alone. Anything reaching the intern table is a
   * translator- or bridge-minted id.
   */
  internedIdFields?: readonly string[];
}

const DEFAULT_INTERNED_ID_FIELDS = [
  "turnId",
  "itemId",
  "id",
  "parentToolCallId",
] as const;

/** Fields whose value is path-dependent and carries no protocol meaning. */
const BLANKED_FIELDS = new Set(["threadId", "providerThreadId"]);

/**
 * Codex's bridge stamps the native turn id here so forks survive a bridge
 * restart; the legacy path persists nothing. It is a bridge-only fact about
 * the provider, not a stream difference worth diffing.
 */
const DROPPED_FIELDS = new Set(["providerCheckpointId"]);

class IdInterner {
  private readonly assigned = new Map<string, string>();

  intern(value: string): string {
    const existing = this.assigned.get(value);
    if (existing !== undefined) {
      return existing;
    }
    const token = `#${this.assigned.size + 1}`;
    this.assigned.set(value, token);
    return token;
  }
}

function normalizeValue(
  value: unknown,
  interner: IdInterner,
  idFields: ReadonlySet<string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry, interner, idFields));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const normalized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || DROPPED_FIELDS.has(key)) {
      continue;
    }
    if (BLANKED_FIELDS.has(key)) {
      normalized[key] = entry === null ? null : "";
      continue;
    }
    if (idFields.has(key) && typeof entry === "string") {
      normalized[key] = interner.intern(entry);
      continue;
    }
    normalized[key] = normalizeValue(entry, interner, idFields);
  }
  return normalized;
}

/**
 * Normalize one path's stream. Each stream gets its own interner, so the token
 * a given id receives depends only on the order ids first appear — identical
 * across paths when the streams agree, different the moment they do not.
 */
export function normalizeCalibrationEvents(
  events: readonly ThreadEvent[],
  options: NormalizeCalibrationEventsOptions = {},
): unknown[] {
  const interner = new IdInterner();
  const idFields = new Set<string>(
    options.internedIdFields ?? DEFAULT_INTERNED_ID_FIELDS,
  );
  // JSON round-trip first so the adapter side loses `undefined`-valued keys
  // exactly as the bridge side does crossing the wire.
  const wireShaped: unknown = JSON.parse(JSON.stringify(events));
  const list = Array.isArray(wireShaped) ? wireShaped : [];
  return list.map((event) => normalizeValue(event, interner, idFields));
}

export interface CalibrationStreamDiff {
  /** Events present only in the bridge stream, in bridge order. */
  onlyInBridge: unknown[];
  /** Events present only in the legacy stream, in legacy order. */
  onlyInLegacy: unknown[];
}

/**
 * Longest-common-subsequence diff over the two normalized streams. Streams are
 * tens of events, so the quadratic table is free, and unlike a positional
 * comparison it reports one inserted event as one insertion rather than
 * desynchronizing everything after it.
 */
export function diffCalibrationStreams(
  legacy: readonly unknown[],
  bridge: readonly unknown[],
): CalibrationStreamDiff {
  const left = legacy.map((event) => JSON.stringify(event));
  const right = bridge.map((event) => JSON.stringify(event));
  const lengths: number[][] = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        left[i] === right[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const onlyInLegacy: unknown[] = [];
  const onlyInBridge: unknown[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      onlyInLegacy.push(legacy[i]);
      i += 1;
    } else {
      onlyInBridge.push(bridge[j]);
      j += 1;
    }
  }
  onlyInLegacy.push(...legacy.slice(i));
  onlyInBridge.push(...bridge.slice(j));
  return { onlyInLegacy, onlyInBridge };
}

/** Compact `type` (+ item type) rendering for asserting a known-divergence list. */
export function describeCalibrationEvents(
  events: readonly unknown[],
): string[] {
  return events.map((event) => {
    if (event === null || typeof event !== "object") {
      return String(event);
    }
    const record: Record<string, unknown> = { ...event };
    const type = typeof record.type === "string" ? record.type : "?";
    const item = record.item;
    if (item !== null && typeof item === "object" && "type" in item) {
      return `${type}:${String((item as { type: unknown }).type)}`;
    }
    return type;
  });
}
