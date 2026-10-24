import { z } from "zod";
import { threadTimelineSubscriptionTargetSchema } from "@bb/domain";
import type { ThreadTimelineReadResponse } from "./threads.js";
export const panelFileSourceSchema = z.enum(["workspace", "thread-storage"]);

export const threadOpenSplitSchema = z.enum([
  "right",
  "down",
  "left",
  "top",
  "replace",
]);

const threadOpenFileLenientSchema = z.object({
  source: panelFileSourceSchema,
  path: z.string().min(1),
  lineNumber: z.number().int().positive().nullable(),
});

export const threadOpenSignalLenientSchema = z.object({
  type: z.literal("thread-open"),
  projectId: z.string(),
  threadId: z.string(),
  split: threadOpenSplitSchema,
  file: threadOpenFileLenientSchema.nullable(),
});

export const threadPaneActionSchema = z.enum([
  "maximize",
  "restore",
  "toggle",
  "spotlight",
  "clear-spotlight",
]);

export const threadPaneActionSignalLenientSchema = z.object({
  type: z.literal("thread-pane-action"),
  projectId: z.string(),
  threadId: z.string(),
  action: threadPaneActionSchema,
});

const taggedThreadTimelineSchema = z.union([
  z.looseObject({
    tag: z.string().min(1),
    delta: z.looseObject({ afterTag: z.string().min(1) }),
  }),
  z.looseObject({ tag: z.string().min(1), rows: z.array(z.unknown()) }),
]);

export const threadTimelineSignalLenientSchema = z.object({
  type: z.literal("thread-timeline"),
  target: threadTimelineSubscriptionTargetSchema,
  timeline: z
    .custom<ThreadTimelineReadResponse>(
      (value) => taggedThreadTimelineSchema.safeParse(value).success,
    )
    .nullable()
    .catch(null),
});
export type ReceivedThreadTimelineSignal = z.infer<
  typeof threadTimelineSignalLenientSchema
>;
