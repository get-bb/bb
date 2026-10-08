import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const tipClientSchema = z
  .object({
    surface: z.enum(["desktop", "web", "mobile-app", "mobile-web"]),
    os: z.enum(["macos", "windows", "linux", "ios", "android", "unknown"]),
  })
  .strict();
export type TipClient = z.infer<typeof tipClientSchema>;

export const TIP_IDS = [
  "whats-new",
  "account-pool",
  "subthreads",
  "set-up-for-me",
  "phone",
  "browser-automation",
  "build-plugin",
  "open-threads-that-need-me",
  "morning-digest",
  "decision-buttons",
  "automations",
  "queue-or-steer",
  "thread-search",
  "command-palette",
  "provider-usage",
] as const;
export const tipIdSchema = z.enum(TIP_IDS);
export type TipId = z.infer<typeof tipIdSchema>;

export const TIP_COMMAND_IDS = [
  "palette.open",
  "thread.search",
  "settings.open",
] as const;

export const tipActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("prompt"),
      label: z.string().min(1),
      prompt: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("open-page"),
      label: z.string().min(1),
      path: z.string().startsWith("/"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("run-command"),
      label: z.string().min(1),
      commandId: z.enum(TIP_COMMAND_IDS),
    })
    .strict(),
  z
    .object({
      kind: z.literal("open-plugin"),
      label: z.string().min(1),
      pluginId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("learn-more"),
      label: z.string().min(1),
      url: z.string().url().startsWith("https://"),
    })
    .strict(),
]);
export type TipAction = z.infer<typeof tipActionSchema>;

export const tipToneSchema = z.enum([
  "blue",
  "green",
  "amber",
  "orange",
  "rose",
]);
export type TipTone = z.infer<typeof tipToneSchema>;

export const tipViewSchema = z
  .object({
    id: z.string().min(1),
    illustration: z.string().min(1),
    tone: tipToneSchema,
    title: z.string().min(1),
    body: z.string().min(1),
    action: tipActionSchema,
  })
  .strict();
export type TipView = z.infer<typeof tipViewSchema>;

export const tipStatusSchema = z.enum([
  "in-feed",
  "eligible",
  "not-applicable",
  "dismissed",
  "retired",
  "expired",
  "held",
]);
export type TipStatus = z.infer<typeof tipStatusSchema>;

export const tipRetiredReasonSchema = z.enum(["used"]);
export type TipRetiredReason = z.infer<typeof tipRetiredReasonSchema>;

export const tipListEntrySchema = tipViewSchema
  .extend({
    status: tipStatusSchema,
    shownCount: z.number().int().nonnegative(),
    dismissed: z.boolean(),
    acted: z.boolean(),
    retiredReason: tipRetiredReasonSchema.nullable(),
  })
  .strict();
export type TipListEntry = z.infer<typeof tipListEntrySchema>;

const tipIdInputSchema = z.object({ id: z.string().min(1).max(64) }).strict();
const okSchema = z.object({ ok: z.literal(true) }).strict();
const tipFeedInputSchema = z
  .object({
    client: tipClientSchema,
    projectId: z.string().min(1).nullable(),
    visit: z.boolean(),
  })
  .strict();
const tipFeedOutputSchema = z.object({ tips: z.array(tipViewSchema) }).strict();

export const FEED_SIZE = 3;

export const tipsRpcContract = defineRpcContract({
  current: { input: tipFeedInputSchema, output: tipFeedOutputSchema },
  hide: {
    input: z.object({ hidden: z.boolean() }).strict(),
    output: okSchema,
  },
  setEnabled: {
    input: z.object({ enabled: z.boolean() }).strict(),
    output: okSchema,
  },
  dismiss: { input: tipIdInputSchema, output: okSchema },
  act: { input: tipIdInputSchema, output: okSchema },
  list: {
    input: z
      .object({ client: tipClientSchema.nullable(), all: z.boolean() })
      .strict(),
    output: z
      .object({
        enabled: z.boolean(),
        hiddenToday: z.boolean(),
        tips: z.array(tipListEntrySchema),
      })
      .strict(),
  },
  reset: { input: z.null(), output: okSchema },
});

export const TIPS_CHANGED_CHANNEL = "tips-changed";
