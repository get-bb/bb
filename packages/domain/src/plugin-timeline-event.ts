import { z } from "zod";
import { jsonValueSchema } from "./json-value.js";
import { pluginIdSchema } from "./plugin-id.js";
import { threadEventItemPresentationSchema } from "./item-presentation.js";
import { clientTurnRequestIdSchema } from "./protocol-ids.js";

const timelinePayloadSchema = jsonValueSchema.refine(
  (value) =>
    new TextEncoder().encode(JSON.stringify(value)).length <= 256 * 1024,
  "Timeline event payload must not exceed 256 KiB",
);

export const pluginTimelineEventSeedSchema = z.object({
  id: z.string().min(1).max(128),
  pluginId: pluginIdSchema,
  rendererId: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(128),
  payload: timelinePayloadSchema,
  presentation: threadEventItemPresentationSchema,
});
export type PluginTimelineEventSeed = z.infer<
  typeof pluginTimelineEventSeedSchema
>;

export const pluginTimelineEventStatusSchema = z.enum([
  "pending",
  "completed",
  "error",
  "interrupted",
]);

export const pluginTimelineEventSchema = pluginTimelineEventSeedSchema.extend({
  threadId: z.string(),
  requestId: clientTurnRequestIdSchema,
  requestSequence: z.number().int(),
  turnId: z.string().nullable(),
  status: pluginTimelineEventStatusSchema,
  startedAt: z.number(),
  completedAt: z.number().nullable(),
});
export type PluginTimelineEvent = z.infer<typeof pluginTimelineEventSchema>;

export const pluginTimelineEventUpdateSchema = z.object({
  status: pluginTimelineEventStatusSchema,
  payload: timelinePayloadSchema.optional(),
  presentation: threadEventItemPresentationSchema.optional(),
});
export type PluginTimelineEventUpdate = z.infer<
  typeof pluginTimelineEventUpdateSchema
>;
