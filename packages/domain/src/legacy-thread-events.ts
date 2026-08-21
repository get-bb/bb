/**
 * Read-time conversion of persisted thread events whose live form moved
 * (docs/provider-plugin-api.md §3, "Genericity rule").
 *
 * The events table is append-only history: a row written under an older
 * vocabulary is never rewritten. Instead every read decodes it into the
 * current vocabulary here, before the event schema parses it, so consumers
 * switch on one shape and old threads keep rendering.
 *
 * Codex goals are the first conversion. They were core events
 * (`thread/goal/updated`, `thread/goal/cleared`) and are now the codex
 * plugin's `provider-codex/goal` thread state — a `thread/extensionState/updated`
 * whose payload is the goal, or `null` once cleared. The kind is spelled here
 * because the converter must name the target kind; the codex plugin declares
 * the same kind and its schema, and the server validates live payloads
 * against that declaration at ingest (converted rows were validated as goal
 * events when they were written).
 */
import type { ThreadEventType } from "./provider-event.js";

/** The codex plugin's goal state kind, as its registration declares it. */
export const LEGACY_CODEX_GOAL_EXTENSION_KIND = "provider-codex/goal";

/** Event types that exist only as persisted history; no producer emits them. */
export const LEGACY_THREAD_EVENT_TYPES = [
  "thread/goal/updated",
  "thread/goal/cleared",
] as const satisfies readonly ThreadEventType[];

export type LegacyThreadEventType = (typeof LEGACY_THREAD_EVENT_TYPES)[number];

const legacyThreadEventTypeSet: ReadonlySet<string> = new Set(
  LEGACY_THREAD_EVENT_TYPES,
);

export function isLegacyThreadEventType(
  type: string,
): type is LegacyThreadEventType {
  return legacyThreadEventTypeSet.has(type);
}

export interface StoredThreadEventShape {
  type: ThreadEventType;
  data: Record<string, unknown>;
}

const GOAL_FIELDS = [
  "objective",
  "status",
  "tokenBudget",
  "tokensUsed",
  "timeUsedSeconds",
] as const;

/**
 * Converts a persisted legacy row into its current shape. Rows of any other
 * type pass through untouched. The converted `data` keeps every field the
 * target event expects (`providerThreadId`, `kind`, `payload`); the event
 * schema still validates it, so a malformed legacy row fails the same way
 * any malformed row does.
 */
export function convertLegacyStoredThreadEvent(
  stored: StoredThreadEventShape,
): StoredThreadEventShape {
  switch (stored.type) {
    case "thread/goal/updated": {
      const payload: Record<string, unknown> = {};
      for (const field of GOAL_FIELDS) {
        payload[field] = stored.data[field];
      }
      return {
        type: "thread/extensionState/updated",
        data: {
          ...withoutGoalFields(stored.data),
          kind: LEGACY_CODEX_GOAL_EXTENSION_KIND,
          payload,
        },
      };
    }
    case "thread/goal/cleared":
      return {
        type: "thread/extensionState/updated",
        data: {
          ...stored.data,
          kind: LEGACY_CODEX_GOAL_EXTENSION_KIND,
          payload: null,
        },
      };
    default:
      return stored;
  }
}

function withoutGoalFields(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!(GOAL_FIELDS as readonly string[]).includes(key)) {
      rest[key] = value;
    }
  }
  return rest;
}
