import { z } from "zod";
import { turnProviderSchema } from "./provider-telemetry.js";
import {
  featureUsedPropertiesSchema,
  telemetryTriggerSchema,
} from "@bb/server-contract";

const analyticsId = z.string().regex(/^[0-9a-f]{32}$/);
const identity = {
  thread_analytics_id: analyticsId,
  parent_analytics_id: analyticsId.optional(),
  parent_link: z.enum(["root", "child", "unknown"]),
};
const origin = {
  request_link: z.enum(["single", "grouped", "none", "unavailable"]),
  request_analytics_id: analyticsId.optional(),
  request_analytics_ids: z.array(analyticsId).min(2).max(100).optional(),
  attempt_kind: z.enum(["initial", "retry", "unknown"]),
  trigger: telemetryTriggerSchema,
  message_source: z
    .enum(["thread_create", "thread_send", "queued_message"])
    .optional(),
};

const lifecycleSchema = z
  .object({
    ...identity,
    transition: z.enum([
      "turn_started",
      "waiting_on_user",
      "waiting_cleared",
      "thread_stopped",
      "thread_archived",
      "thread_unarchived",
      "thread_deleted",
      "parent_changed",
    ]),
    request_link: origin.request_link.optional(),
    request_analytics_id: origin.request_analytics_id,
    request_analytics_ids: origin.request_analytics_ids,
    attempt_kind: origin.attempt_kind.optional(),
    trigger: origin.trigger.optional(),
    message_source: origin.message_source,
    wait_kind: z.enum(["question", "approval", "other", "unknown"]).optional(),
  })
  .strict();

const finishedSchema = z
  .object({
    ...identity,
    ...origin,
    outcome: z.enum(["completed", "failed", "stopped"]),
    error_category: z.enum([
      "none",
      "auth",
      "billing",
      "rate_limit",
      "provider_unavailable",
      "limit_reached",
      "process_exited",
      "start_failed",
      "host_lost",
      "other",
    ]),
    provider: turnProviderSchema,
    first_turn: z.boolean(),
  })
  .strict();

const createdSchema = z
  .object({
    thread_analytics_id: analyticsId.optional(),
    parent_analytics_id: analyticsId.optional(),
    parent_link: identity.parent_link.optional(),
    is_child_thread: z.boolean(),
    provider: z.string(),
  })
  .strict();
const messageSchema = createdSchema.extend({
  request_analytics_id: analyticsId.optional(),
  message_source: origin.message_source.unwrap(),
});

export function validWorkTelemetry(name: string, properties: unknown): boolean {
  if (name === "feature_used")
    return featureUsedPropertiesSchema.safeParse(properties).success;
  if (name === "thread_created")
    return createdSchema.safeParse(properties).success;
  if (name === "user_message_sent")
    return messageSchema.safeParse(properties).success;
  if (name !== "thread_lifecycle" && name !== "turn_finished") return true;
  const result =
    name === "thread_lifecycle"
      ? lifecycleSchema.safeParse(properties)
      : finishedSchema.safeParse(properties);
  if (!result.success) return false;
  const value = result.data;
  if (value.parent_link === "root" && value.parent_analytics_id !== undefined)
    return false;
  if (value.parent_link === "child" && value.parent_analytics_id === undefined)
    return false;
  if ("transition" in value) {
    if (value.transition === "turn_started") {
      if (
        value.request_link === undefined ||
        value.attempt_kind === undefined ||
        value.trigger === undefined ||
        value.wait_kind !== undefined
      )
        return false;
    } else if (
      value.request_link !== undefined ||
      value.request_analytics_id !== undefined ||
      value.request_analytics_ids !== undefined ||
      value.attempt_kind !== undefined ||
      value.trigger !== undefined ||
      value.message_source !== undefined
    )
      return false;
  }
  const hasSingle = value.request_analytics_id !== undefined;
  const hasGroup = value.request_analytics_ids !== undefined;
  if (hasSingle && hasGroup) return false;
  if (value.request_link === "single") return hasSingle && !hasGroup;
  if (value.request_link === "grouped")
    return (
      hasGroup &&
      new Set(value.request_analytics_ids).size ===
        value.request_analytics_ids?.length
    );
  return !hasSingle && !hasGroup;
}
