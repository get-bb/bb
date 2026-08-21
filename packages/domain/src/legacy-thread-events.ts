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
  "turn/plan/updated",
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

/**
 * A stable id for an item a legacy event converts into. The event row carries
 * no item id, so the id is derived from the turn and the payload: two
 * identical snapshots in one turn fold into one item, which is what a
 * superseding snapshot means anyway.
 */
function legacyItemId(prefix: string, turnId: string | null, payload: unknown): string {
  const text = JSON.stringify(payload);
  // djb2 — deterministic, dependency-free, good enough to key a few
  // snapshots per turn.
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 33) ^ text.charCodeAt(index);
  }
  return `${prefix}:${turnId ?? "thread"}:${(hash >>> 0).toString(36)}`;
}

/** The scope a converter may key a derived item by. */
export interface StoredThreadEventConversionScope {
  turnId: string | null;
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
  scope: StoredThreadEventConversionScope = { turnId: null },
): StoredThreadEventShape {
  switch (stored.type) {
    case "turn/plan/updated": {
      // Codex `update_plan` used to reach the timeline as a turn-level
      // notification the UI discarded; the codex bridge now emits each
      // update as a settled `planSteps` snapshot. Persisted notifications
      // decode into the same item so old threads show their plans and feed
      // the todo banner. No presentation: the row renders through the core
      // plan-steps fallback like every pre-presentation row.
      const { plan, explanation, ...rest } = stored.data;
      const steps = Array.isArray(plan) ? plan : [];
      return {
        type: "item/completed",
        data: {
          ...rest,
          item: {
            type: "planSteps",
            id: legacyItemId("legacy-plan", scope.turnId, {
              steps,
              explanation,
            }),
            steps,
            ...(typeof explanation === "string" ? { explanation } : {}),
            status: "completed",
          },
        },
      };
    }
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
