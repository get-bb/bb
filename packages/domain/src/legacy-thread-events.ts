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
import type { ThreadEventItemPresentation } from "./item-presentation.js";
import type { ThreadEventType } from "./provider-event.js";

/** The codex plugin's goal state kind, as its registration declares it. */
export const LEGACY_CODEX_GOAL_EXTENSION_KIND = "provider-codex/goal";

/** Event types that exist only as persisted history; no producer emits them. */
export const LEGACY_THREAD_EVENT_TYPES = [
  "thread/goal/updated",
  "thread/goal/cleared",
  "turn/plan/updated",
  "system/permissionGrant/lifecycle",
  "system/userQuestion/lifecycle",
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
function legacyItemId(
  prefix: string,
  turnId: string | null,
  payload: unknown,
): string {
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
    case "item/started":
    case "item/completed": {
      const upgraded = upgradeLegacyToolItem(stored.data.item);
      return upgraded === stored.data.item
        ? stored
        : { type: stored.type, data: { ...stored.data, item: upgraded } };
    }
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
    // The per-shape interaction events (one type per payload shape, which
    // let a row pair an approval subject with a user answer) became the one
    // `system/interaction/lifecycle` carrying the paired lifecycle record.
    // A stored row decodes into that record. The old approval event kept
    // the subject alone, so the record's `reason` is null: the bridge's
    // reason was not persisted, which is what null says.
    case "system/permissionGrant/lifecycle": {
      const { subject, ...rest } = stored.data;
      return {
        type: "system/interaction/lifecycle",
        data: {
          interaction: legacyInteractionLifecycleRecord(rest, {
            kind: "approval",
            subject,
            reason: null,
          }),
        },
      };
    }
    case "system/userQuestion/lifecycle": {
      const { payload, ...rest } = stored.data;
      return {
        type: "system/interaction/lifecycle",
        data: { interaction: legacyInteractionLifecycleRecord(rest, payload) },
      };
    }
    default:
      return stored;
  }
}

/**
 * The lifecycle record a legacy per-shape interaction row decodes into. The
 * old rows carried the interaction fields flat (`interactionId`,
 * `providerId`, `providerRequestId`, `status`, `resolution`, `statusReason`)
 * beside their shape; the record nests the origin and pairs the payload
 * with the resolution. Absent optional fields take the null the old schema
 * defaulted them to.
 */
function legacyInteractionLifecycleRecord(
  data: Record<string, unknown>,
  payload: unknown,
): Record<string, unknown> {
  return {
    id: data.interactionId,
    status: data.status,
    statusReason: data.statusReason ?? null,
    origin: {
      kind: "provider",
      providerId: data.providerId,
      providerRequestId: data.providerRequestId,
    },
    payload,
    resolution: data.resolution ?? null,
  };
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

// ---------------------------------------------------------------------------
// LEGACY-DATA ADAPTER: presentation-less tool items
// ---------------------------------------------------------------------------
//
// Rows persisted before bridges stamped `presentation` on every item (grammar
// v3, 2026-08) carry only a tool name and its arguments. Core used to render
// them through tool-name tables; #2232 deleted those tables from the live
// path, and this adapter is the ONLY place core still reads a tool name. It
// exists for persisted history, not for any provider: it is keyed on the
// absence of `presentation` and never consults a provider id. A bridge that
// stamps presentation on every item (codex, claude-code, ACP) never reaches
// it; pi's generic `tool` rows carry none yet, so its live read/grep/find/ls
// calls are reshaped here at read time exactly like the persisted Claude
// rows — exploration rows (path or query, no output) — until pi stamps
// fileRead/search presentation itself and `presentation` becomes required.
//
// Delete this section, its tests and `LEGACY_TOOL_ITEM_BACKFILL_MIGRATION`
// together with the one-time backfill migration of that name, which stamps
// the adapter's output onto the old rows. Until that migration ships, every
// read of an old row passes through here.
//
// What it restores, exactly as the deleted tables rendered it:
//   - Read / Grep / Glob (Claude) and read / grep / find / ls (Pi) become
//     `fileRead` / `search` items, which the timeline folds into
//     "Explored N files, M searches" and titles from the path or query.
//   - TodoWrite / TodoRead / ToolSearch / Task* / AskUserQuestion calls gain
//     `presentation.suppress`, so the bookkeeping row stays collapsed; a
//     failed or interrupted call keeps rendering, as it always did.
//   - An Agent / Task result loses its `agentId:` and `<usage>` lines, the
//     harness metadata the delegation row never showed.
//   - An Agent / Task / spawnAgent / resumeAgent call — the exact name set
//     the deleted tables classified as a delegation — is reported as one by
//     `isLegacyDelegationToolCall`, which the timeline projection consults
//     for a presentation-less call that no child row names as its parent
//     (a call the SDK rejected at input validation, or one whose subagent
//     events were never persisted). The item is not rewritten into a
//     `delegation` item: that shape has no slot for the call's
//     `subagent_type` / `model` arguments, which the delegation row's title
//     and the background-agent model still read from the persisted call.
//
// For every new event, delegation classification is structural, never by
// name: a bridge emits a `delegation` item (the Claude bridge does, with
// `childRef` = the call id), or a child row names the call as its
// `parentToolCallId`. The backfill migration therefore leaves these calls as
// the presentation-less tool calls this adapter returns, or persists them as
// the delegation item the Claude bridge emits today (`childRef` = call id),
// accepting that their arguments then stop feeding the row; stamping a
// generic presentation on them would turn every childless one back into a
// plain tool row.

/** The one-time migration that stamps these upgrades onto old rows. */
export const LEGACY_TOOL_ITEM_BACKFILL_MIGRATION = "legacy-tool-item-backfill";

const LEGACY_READ_TOOL_NAMES: ReadonlySet<string> = new Set(["Read", "read"]);
const LEGACY_CONTENT_SEARCH_TOOL_NAMES: ReadonlySet<string> = new Set([
  "Grep",
  "grep",
]);
const LEGACY_PATH_SEARCH_TOOL_NAMES: ReadonlySet<string> = new Set([
  "Glob",
  "glob",
  "find",
]);
const LEGACY_LIST_TOOL_NAMES: ReadonlySet<string> = new Set(["ls"]);
const LEGACY_SUPPRESSED_TOOL_NAMES: ReadonlySet<string> = new Set([
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskUpdate",
  "TodoRead",
  "TodoWrite",
  "ToolSearch",
  // Fully represented by its own question row; the tool row would duplicate it.
  "AskUserQuestion",
]);
const LEGACY_AGENT_RESULT_TOOL_NAMES: ReadonlySet<string> = new Set([
  "Agent",
  "Task",
]);
/**
 * The names the deleted tables classified as a delegation: Claude's `Agent`
 * and `Task`, bb's `spawnAgent` and `resumeAgent`. `TaskCreate` and the
 * rest of the bookkeeping family are not delegations (see the suppressed
 * set above); the match is on the exact base name.
 */
const LEGACY_DELEGATION_TOOL_NAMES: ReadonlySet<string> = new Set([
  "Agent",
  "Task",
  "spawnAgent",
  "resumeAgent",
]);

/** A tool name may carry a server prefix (`server:tool`); the tool is last. */
function legacyBaseToolName(tool: string): string {
  const segments = tool.split(":");
  return segments[segments.length - 1] ?? tool;
}

function firstStringField(
  args: Record<string, unknown> | undefined,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = args?.[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/**
 * The compact `Tool { key: value, … }` form the deleted tables used as the
 * row's command text; mirrors `formatToolCallCommand` in @bb/thread-view so
 * an upgraded row derives the same activity intent it had before.
 */
function legacyToolCallCommand(
  tool: string,
  args: Record<string, unknown> | undefined,
): string {
  if (!args) return tool;
  const entries = Object.entries(args).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return tool;
  const compact = entries
    .map(([k, v]) => {
      const vs = typeof v === "string" ? v.trim() : JSON.stringify(v);
      const display = vs.length > 40 ? `${vs.slice(0, 37)}...` : vs;
      return `${k}: ${display}`;
    })
    .join(", ");
  return `${tool} { ${compact} }`;
}

function stripLegacyAgentResultMetadata(result: string): string {
  return result
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(
      (line) => !line.startsWith("agentId:") && !line.startsWith("<usage>"),
    )
    .join("\n")
    .trim();
}

interface LegacyToolItem {
  type: "toolCall";
  id: string;
  tool: string;
  arguments?: Record<string, unknown>;
  status: "pending" | "completed" | "failed" | "interrupted";
  result?: unknown;
  parentToolCallId?: string;
  [key: string]: unknown;
}

function isLegacyToolItem(item: unknown): item is LegacyToolItem {
  if (item === null || typeof item !== "object") return false;
  const record = item as Record<string, unknown>;
  return (
    record.type === "toolCall" &&
    typeof record.id === "string" &&
    typeof record.tool === "string" &&
    typeof record.status === "string" &&
    // The whole point: a row the bridge already presented is not legacy data.
    record.presentation === undefined
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Fields a `fileRead` / `search` item shares with the tool call it replaces. */
function sharedLegacyItemFields(item: LegacyToolItem): Record<string, unknown> {
  return {
    id: item.id,
    status: item.status,
    ...(item.parentToolCallId === undefined
      ? {}
      : { parentToolCallId: item.parentToolCallId }),
  };
}

/**
 * Whether a persisted tool call is one the deleted tables rendered as a
 * delegation row. Keyed, like every rule here, on the absence of
 * `presentation`: a bridge that presents a tool it happens to call `Agent`
 * gets the generic tool row it asked for. The projection asks this for a
 * call no child row names as its parent; a call with children is a
 * delegation structurally and never needs the name.
 */
export function isLegacyDelegationToolCall(call: {
  tool: string;
  presentation?: ThreadEventItemPresentation | undefined;
}): boolean {
  return (
    call.presentation === undefined &&
    LEGACY_DELEGATION_TOOL_NAMES.has(legacyBaseToolName(call.tool))
  );
}

/**
 * Upgrades a persisted, presentation-less `toolCall` item to the shape the
 * bridge would emit for it today. Returns the same object when the item is
 * not legacy data or the name is not one the deleted tables knew.
 */
export function upgradeLegacyToolItem(item: unknown): unknown {
  if (!isLegacyToolItem(item)) return item;
  const tool = legacyBaseToolName(item.tool);
  const args = isRecord(item.arguments) ? item.arguments : undefined;

  if (LEGACY_READ_TOOL_NAMES.has(tool)) {
    const path = firstStringField(args, ["file_path", "file", "path"]);
    if (path === undefined) return item;
    return {
      type: "fileRead",
      ...sharedLegacyItemFields(item),
      path,
      cmd: legacyToolCallCommand(item.tool, args),
    };
  }
  if (LEGACY_CONTENT_SEARCH_TOOL_NAMES.has(tool)) {
    const query = firstStringField(args, ["pattern", "query"]);
    if (query === undefined) return item;
    const path = firstStringField(args, ["path"]);
    return {
      type: "search",
      ...sharedLegacyItemFields(item),
      mode: "content",
      query,
      ...(path === undefined ? {} : { path }),
      cmd: legacyToolCallCommand(item.tool, args),
    };
  }
  if (LEGACY_PATH_SEARCH_TOOL_NAMES.has(tool)) {
    const query = firstStringField(args, ["pattern"]);
    const path = firstStringField(args, ["path"]);
    if (query === undefined && path === undefined) return item;
    return {
      type: "search",
      ...sharedLegacyItemFields(item),
      mode: "path",
      query: query ?? "",
      ...(path === undefined ? {} : { path }),
      cmd: legacyToolCallCommand(item.tool, args),
    };
  }
  if (LEGACY_LIST_TOOL_NAMES.has(tool)) {
    const path = firstStringField(args, ["path"]);
    if (path === undefined) return item;
    return {
      type: "search",
      ...sharedLegacyItemFields(item),
      mode: "list",
      query: "",
      path,
      cmd: legacyToolCallCommand(item.tool, args),
    };
  }
  if (LEGACY_SUPPRESSED_TOOL_NAMES.has(tool)) {
    // Only a pending or completed call collapses; a failed or interrupted
    // one keeps its plain row, so it keeps its plain (presentation-less)
    // item here too.
    if (item.status !== "pending" && item.status !== "completed") return item;
    const presentation: ThreadEventItemPresentation = {
      label: { pending: `Running ${tool}`, completed: `Ran ${tool}` },
      icon: { glyph: "Toolbox" },
      suppress: true,
    };
    return { ...item, presentation };
  }
  if (
    LEGACY_AGENT_RESULT_TOOL_NAMES.has(tool) &&
    typeof item.result === "string"
  ) {
    const stripped = stripLegacyAgentResultMetadata(item.result);
    return stripped === item.result ? item : { ...item, result: stripped };
  }
  return item;
}
