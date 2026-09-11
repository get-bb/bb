import {
  environmentMachineSelectionSchema,
  jsonValueSchema,
  permissionModeInputSchema,
  promptTextMentionSchema,
  reasoningLevelSchema,
  serviceTierSchema,
  threadOriginKindSchema,
  threadWithRuntimeSchema,
} from "@bb/domain";
import { z } from "zod";
import { uploadedPromptAttachmentSchema } from "./projects.js";
import {
  hostEnvironmentSchema,
  projectDefaultEnvironmentSchema,
  reuseEnvironmentSchema,
} from "./shared.js";
import { threadCreateOriginSchema, threadOpenSplitSchema } from "./threads.js";

export const draftIdSchema = z.string().regex(/^drf_[A-Za-z0-9_-]{8,128}$/);

export const draftPromptSchema = z
  .object({
    text: z.string().default(""),
    mentions: z.array(promptTextMentionSchema).default([]),
    attachments: z.array(uploadedPromptAttachmentSchema).default([]),
  })
  .strict();
export type DraftPrompt = z.infer<typeof draftPromptSchema>;

export const draftEnvironmentSchema = z.discriminatedUnion("type", [
  reuseEnvironmentSchema,
  hostEnvironmentSchema,
  projectDefaultEnvironmentSchema,
  z.object({
    type: z.literal("provider"),
    environmentProviderId: z.string().min(1),
    machine: environmentMachineSelectionSchema.nullable(),
    inputs: jsonValueSchema.nullable(),
  }),
]);

export const draftOptionsSchema = z
  .object({
    providerId: z.string().min(1).nullable().default(null),
    model: z.string().min(1).nullable().default(null),
    reasoningLevel: reasoningLevelSchema.nullable().default(null),
    serviceTier: serviceTierSchema.nullable().default(null),
    permissionMode: permissionModeInputSchema.nullable().default(null),
    environment: draftEnvironmentSchema.nullable().default(null),
    title: z.string().min(1).nullable().default(null),
    parentThreadId: z.string().min(1).nullable().default(null),
    sourceThreadId: z.string().min(1).nullable().default(null),
    sourceSeqEnd: z.number().int().nonnegative().nullable().default(null),
    originKind: threadOriginKindSchema.nullable().default(null),
    sendAt: z.number().int().nonnegative().nullable().default(null),
  })
  .strict();
export type DraftOptions = z.infer<typeof draftOptionsSchema>;

export const draftContentSchema = z
  .object({
    projectId: z.string().min(1).nullable().default(null),
    sectionId: z.string().min(1).nullable().default(null),
    prompt: draftPromptSchema.prefault({}),
    options: draftOptionsSchema.prefault({}),
  })
  .strict();
export type DraftContent = z.infer<typeof draftContentSchema>;
export type DraftContentInput = z.input<typeof draftContentSchema>;

export const draftSchema = z.object({
  id: draftIdSchema,
  revision: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  content: draftContentSchema,
});
export type Draft = z.infer<typeof draftSchema>;

export const draftCreateRequestSchema = z
  .object({
    id: draftIdSchema.optional(),
    content: draftContentSchema.prefault({}),
  })
  .strict();
export type DraftCreateRequest = z.input<typeof draftCreateRequestSchema>;

export const draftCreateResponseSchema = z.object({
  id: draftIdSchema,
  draft: draftSchema.nullable(),
});
export type DraftCreateResponse = z.infer<typeof draftCreateResponseSchema>;

export const draftListQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  query: z.string().max(500).optional(),
  includeEmpty: z.enum(["true", "false"]).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
});
export type DraftListQuery = z.infer<typeof draftListQuerySchema>;

export const draftListResponseSchema = z.object({
  drafts: z.array(draftSchema),
  nextOffset: z.number().int().nonnegative().nullable(),
});
export type DraftListResponse = z.infer<typeof draftListResponseSchema>;

export const draftUpdateRequestSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    content: draftContentSchema,
  })
  .strict();
export type DraftUpdateRequest = z.input<typeof draftUpdateRequestSchema>;

export const draftDeleteRequestSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export type DraftDeleteRequest = z.infer<typeof draftDeleteRequestSchema>;

export const draftDeleteResponseSchema = z.object({
  id: draftIdSchema,
  revision: z.number().int().positive(),
});
export type DraftDeleteResponse = z.infer<typeof draftDeleteResponseSchema>;

export const draftSubmitRequestSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    origin: threadCreateOriginSchema.default("sdk"),
    originPluginId: z.string().min(1).optional(),
  })
  .strict();
export type DraftSubmitRequest = z.input<typeof draftSubmitRequestSchema>;

export const draftSubmitResponseSchema = z.object({
  thread: threadWithRuntimeSchema,
  draft: draftSchema.nullable(),
});
export type DraftSubmitResponse = z.infer<typeof draftSubmitResponseSchema>;

export const draftOpenRequestSchema = z
  .object({
    split: threadOpenSplitSchema.optional(),
  })
  .strict();
export type DraftOpenRequest = z.infer<typeof draftOpenRequestSchema>;

export const draftOpenResponseSchema = z.object({
  delivered: z.number().int().nonnegative(),
});
export type DraftOpenResponse = z.infer<typeof draftOpenResponseSchema>;

export const draftOpenSignalLenientSchema = z.object({
  type: z.literal("draft-open"),
  draftId: draftIdSchema,
  split: threadOpenSplitSchema,
});
export const draftOpenSignalSchema = draftOpenSignalLenientSchema.strict();
export type DraftOpenSignal = z.infer<typeof draftOpenSignalSchema>;
