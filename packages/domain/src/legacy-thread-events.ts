import { z } from "zod";

import {
  jsonObjectSchema,
  jsonValueSchema,
  type JsonObject,
  type JsonValue,
} from "./json-value.js";
import type { ThreadEventItemPresentation } from "./item-presentation.js";
import type { ThreadEventType } from "./provider-event.js";

export const LEGACY_CODEX_GOAL_EXTENSION_KIND = "provider-codex/goal";

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

export interface StoredThreadEventRecord {
  type: ThreadEventType;
  data: JsonObject;
}

interface StoredThreadEventRecordInput {
  type: ThreadEventType;
  data: object;
}

const storedThreadEventRecordSchema = z.object({
  type: z.string(),
  data: jsonObjectSchema,
});

function isStoredThreadEventRecord(
  stored: StoredThreadEventRecordInput,
): stored is StoredThreadEventRecord {
  return storedThreadEventRecordSchema.safeParse(stored).success;
}

function legacyItemId(
  prefix: string,
  turnId: string | null,
  payload: JsonValue,
): string {
  const text = JSON.stringify(payload);
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 33) ^ text.charCodeAt(index);
  }
  return `${prefix}:${turnId ?? "thread"}:${(hash >>> 0).toString(36)}`;
}

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

const goalFieldSet = new Set<string>(GOAL_FIELDS);

export function convertLegacyStoredThreadEvent(
  stored: StoredThreadEventRecordInput,
  scope: StoredThreadEventConversionScope = { turnId: null },
): StoredThreadEventRecord {
  if (!isStoredThreadEventRecord(stored)) {
    throw new Error("Stored thread event data must contain JSON values");
  }
  switch (stored.type) {
    case "item/started":
    case "item/completed": {
      const upgraded = upgradeLegacyToolItem(stored.data.item);
      return upgraded === stored.data.item
        ? stored
        : { type: stored.type, data: { ...stored.data, item: upgraded } };
    }
    case "turn/plan/updated": {
      const { plan, explanation, ...rest } = stored.data;
      const stepsResult = z.array(jsonValueSchema).safeParse(plan);
      const steps = stepsResult.success ? stepsResult.data : [];
      const explanationResult = z.string().safeParse(explanation);
      const idPayload: JsonObject = { steps };
      if (explanationResult.success) {
        idPayload.explanation = explanationResult.data;
      }
      const item = {
        type: "planSteps",
        id: legacyItemId("legacy-plan", scope.turnId, idPayload),
        steps,
        status: "completed",
      };
      if (explanationResult.success) {
        return {
          type: "item/completed",
          data: {
            ...rest,
            item: { ...item, explanation: explanationResult.data },
          },
        };
      }
      return {
        type: "item/completed",
        data: {
          ...rest,
          item,
        },
      };
    }
    case "thread/goal/updated": {
      const payload: JsonObject = {};
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

function legacyInteractionLifecycleRecord(
  data: JsonObject,
  payload: JsonValue,
) {
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

function withoutGoalFields(data: JsonObject) {
  const rest = { ...data };
  for (const key of Object.keys(data)) {
    if (goalFieldSet.has(key)) {
      delete rest[key];
    }
  }
  return rest;
}

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
  "AskUserQuestion",
]);
const LEGACY_AGENT_RESULT_TOOL_NAMES: ReadonlySet<string> = new Set([
  "Agent",
  "Task",
]);
const LEGACY_DELEGATION_TOOL_NAMES: ReadonlySet<string> = new Set([
  "Agent",
  "Task",
  "spawnAgent",
  "resumeAgent",
]);

function legacyBaseToolName(tool: string): string {
  const segments = tool.split(":");
  return segments[segments.length - 1] ?? tool;
}

function firstStringField(
  args: JsonObject | undefined,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const result = z.string().safeParse(args?.[key]);
    if (result.success && result.data.length > 0) return result.data;
  }
  return undefined;
}

function legacyToolCallCommand(
  tool: string,
  args: JsonObject | undefined,
): string {
  if (!args) return tool;
  const entries = Object.entries(args).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return tool;
  const compact = entries
    .map(([k, v]) => {
      const stringResult = z.string().safeParse(v);
      const encoded = JSON.stringify(v);
      const vs = stringResult.success
        ? stringResult.data.trim()
        : (encoded ?? "");
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

const legacyToolItemSchema = z
  .object({
    type: z.literal("toolCall"),
    id: z.string(),
    tool: z.string(),
    arguments: jsonObjectSchema.optional(),
    status: z.enum(["pending", "completed", "failed", "interrupted"]),
    result: jsonValueSchema.optional(),
    parentToolCallId: z.string().optional(),
  })
  .catchall(jsonValueSchema);

type LegacyToolItem = z.infer<typeof legacyToolItemSchema>;

interface LegacyUpgradedToolItem {
  [key: string]: JsonValue;
  type: string;
  id: string;
  status: LegacyToolItem["status"];
}

function isLegacyToolItem(item: JsonValue): item is LegacyToolItem {
  const result = legacyToolItemSchema.safeParse(item);
  return result.success && result.data.presentation === undefined;
}

function addOptionalItemField(
  item: JsonObject,
  key: string,
  value: string | undefined,
): JsonObject {
  if (value !== undefined) {
    item[key] = value;
  }
  return item;
}

function createLegacyToolItem(
  type: string,
  item: LegacyToolItem,
  fields: JsonObject,
): LegacyUpgradedToolItem {
  const upgraded: LegacyUpgradedToolItem = {
    type,
    id: item.id,
    status: item.status,
  };
  if (item.parentToolCallId !== undefined) {
    upgraded.parentToolCallId = item.parentToolCallId;
  }
  for (const [key, value] of Object.entries(fields)) {
    upgraded[key] = value;
  }
  return upgraded;
}

export function isLegacyDelegationToolCall(call: {
  tool: string;
  presentation?: ThreadEventItemPresentation | undefined;
}): boolean {
  return (
    call.presentation === undefined &&
    LEGACY_DELEGATION_TOOL_NAMES.has(legacyBaseToolName(call.tool))
  );
}

export function upgradeLegacyToolItem(item: JsonValue): JsonValue {
  if (!isLegacyToolItem(item)) return item;
  const tool = legacyBaseToolName(item.tool);
  const args = item.arguments;

  if (LEGACY_READ_TOOL_NAMES.has(tool)) {
    const path = firstStringField(args, ["file_path", "file", "path"]);
    if (path === undefined) return item;
    return createLegacyToolItem("fileRead", item, {
      path,
      cmd: legacyToolCallCommand(item.tool, args),
    });
  }
  if (LEGACY_CONTENT_SEARCH_TOOL_NAMES.has(tool)) {
    const query = firstStringField(args, ["pattern", "query"]);
    if (query === undefined) return item;
    const path = firstStringField(args, ["path"]);
    const fields: JsonObject = { mode: "content", query };
    addOptionalItemField(fields, "path", path);
    fields.cmd = legacyToolCallCommand(item.tool, args);
    return createLegacyToolItem("search", item, fields);
  }
  if (LEGACY_PATH_SEARCH_TOOL_NAMES.has(tool)) {
    const query = firstStringField(args, ["pattern"]);
    const path = firstStringField(args, ["path"]);
    if (query === undefined && path === undefined) return item;
    const fields: JsonObject = { mode: "path", query: query ?? "" };
    addOptionalItemField(fields, "path", path);
    fields.cmd = legacyToolCallCommand(item.tool, args);
    return createLegacyToolItem("search", item, fields);
  }
  if (LEGACY_LIST_TOOL_NAMES.has(tool)) {
    const path = firstStringField(args, ["path"]);
    if (path === undefined) return item;
    return createLegacyToolItem("search", item, {
      mode: "list",
      query: "",
      path,
      cmd: legacyToolCallCommand(item.tool, args),
    });
  }
  if (LEGACY_SUPPRESSED_TOOL_NAMES.has(tool)) {
    if (item.status !== "pending" && item.status !== "completed") return item;
    const presentation = {
      label: { pending: `Running ${tool}`, completed: `Ran ${tool}` },
      icon: { glyph: "Toolbox" },
      suppress: true,
    };
    return { ...item, presentation };
  }
  if (
    LEGACY_AGENT_RESULT_TOOL_NAMES.has(tool) &&
    z.string().safeParse(item.result).success
  ) {
    const result = z.string().parse(item.result);
    const stripped = stripLegacyAgentResultMetadata(result);
    return stripped === result ? item : { ...item, result: stripped };
  }
  return item;
}
