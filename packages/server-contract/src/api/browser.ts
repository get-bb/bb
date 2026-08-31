import { z } from "zod";
import {
  BROWSER_AUTOMATION_MAX_TIMEOUT_MS,
  browserAutomationCommandSchema,
  browserAutomationSnapshotResultSchema,
  browserAutomationStateResultSchema,
  browserAutomationTargetSchema,
  browserAutomationUrlSchema,
} from "@bb/domain";

const browserIdSchema = z.string().min(1).max(128);
const browserOwnerSchema = z.object({
  callerHostId: browserIdSchema,
  threadId: browserIdSchema,
});

export const browserOpenRequestSchema = browserOwnerSchema.extend({
  timeoutMs: z.number().int().positive().max(BROWSER_AUTOMATION_MAX_TIMEOUT_MS).optional(),
  url: browserAutomationUrlSchema,
}).strict();
export type BrowserOpenRequest = z.infer<typeof browserOpenRequestSchema>;

export const browserListQuerySchema = browserOwnerSchema.strict();
export type BrowserListQuery = z.infer<typeof browserListQuerySchema>;

export type BrowserTargetPath = { param: { targetId: string } };

export const browserCommandRequestSchema = browserOwnerSchema.extend({
  command: browserAutomationCommandSchema,
  timeoutMs: z.number().int().positive().max(BROWSER_AUTOMATION_MAX_TIMEOUT_MS).optional(),
}).strict();
export type BrowserCommandRequest = z.infer<typeof browserCommandRequestSchema>;

export const browserCloseRequestSchema = browserOwnerSchema.strict();
export type BrowserCloseRequest = z.infer<typeof browserCloseRequestSchema>;

export const browserTargetListResponseSchema = z.object({
  targets: z.array(browserAutomationTargetSchema),
}).strict();
export type BrowserTargetListResponse = z.infer<typeof browserTargetListResponseSchema>;

export const browserScreenshotArtifactSchema = z.object({
  artifactId: z.string().regex(/^bs_[a-f0-9-]{36}$/),
  byteSize: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  mimeType: z.literal("image/png"),
  targetId: browserIdSchema,
  threadId: browserIdSchema,
}).strict();
export type BrowserScreenshotArtifact = z.infer<typeof browserScreenshotArtifactSchema>;

export const browserPublicCommandResultSchema = z.discriminatedUnion("kind", [
  browserAutomationStateResultSchema,
  browserAutomationSnapshotResultSchema,
  z.object({
    artifact: browserScreenshotArtifactSchema,
    kind: z.literal("screenshot"),
  }).strict(),
]);
export type BrowserPublicCommandResult = z.infer<typeof browserPublicCommandResultSchema>;

export const browserArtifactQuerySchema = browserOwnerSchema.strict();
export type BrowserArtifactQuery = z.infer<typeof browserArtifactQuerySchema>;

export type BrowserArtifactPath = { param: { artifactId: string } };
