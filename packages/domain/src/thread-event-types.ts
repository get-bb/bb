import { z } from "zod";
import type { ThreadEventType } from "./provider-event.js";

export const systemEventTypeValues = [
  "client/thread/start",
  "client/turn/requested",
  "client/turn/rejected",
  "client/turn/start",
  "system/error",
  "system/manager/user_message",
  "system/thread/interrupted",
  "system/operation",
  "system/interaction/lifecycle",
  "system/permissionGrant/lifecycle",
  "system/userQuestion/lifecycle",
  "system/thread-provisioning",
  "system/provider-turn-watchdog",
] as const;

const providerEventTypeValues = [
  "thread/started",
  "thread/identity",
  "turn/started",
  "turn/completed",
  "turn/input/accepted",
  "thread/name/updated",
  "thread/compacted",
  "thread/context/cleared",
  "thread/goal/updated",
  "thread/goal/cleared",
  "item/started",
  "item/completed",
  "item/agentMessage/delta",
  "item/commandExecution/outputDelta",
  "item/fileChange/outputDelta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/plan/delta",
  "item/mcpToolCall/progress",
  "item/toolCall/progress",
  "item/backgroundTask/progress",
  "item/backgroundTask/completed",
  "item/delegation/progress",
  "item/delegation/completed",
  "thread/tokenUsage/updated",
  "thread/contextWindowUsage/updated",
  "turn/plan/updated",
  "turn/mainRun/updated",
  "turn/diff/updated",
  "provider/error",
  "provider/rateLimits/updated",
  "provider.env-resolved",
  "thread/extensionState/updated",
  "provider/warning",
  "provider/modelFallback",
  "provider/unhandled",
] as const;

export const threadEventTypeValues = [
  ...providerEventTypeValues,
  ...systemEventTypeValues,
] as const;
const threadEventTypeSet = new Set<string>(threadEventTypeValues);
export const threadEventTypeSchema = z
  .string()
  .refine(
    (value): value is ThreadEventType => threadEventTypeSet.has(value),
    "Invalid thread event type",
  );
