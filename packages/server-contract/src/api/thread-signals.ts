import { z } from "zod";
import { threadTimelineSubscriptionTargetSchema } from "@bb/domain";
import type { ThreadTimelineResponse } from "./threads.js";
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

export const threadTimelineSignalLenientSchema = z.object({
  type: z.literal("thread-timeline"),
  target: threadTimelineSubscriptionTargetSchema,
  afterSequence: z.number().int().nonnegative().nullable(),
  timeline: z.custom<ThreadTimelineResponse>(
    (value) => typeof value === "object" && value !== null,
  ),
});
