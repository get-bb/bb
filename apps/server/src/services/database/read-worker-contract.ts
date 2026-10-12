import { z } from "zod";
import { promptMentionCommandTriggerSchema } from "@bb/domain";
import { threadConversationOutlineResponseSchema } from "@bb/server-contract";

const planCommandSchema = z.object({
  trigger: promptMentionCommandTriggerSchema,
  name: z.string(),
  trailingText: z.string(),
});
export const readTaskSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("search"),
    query: z.string(),
    limitPerGroup: z.number().int().min(1).max(50),
    daemonSessions: z.array(z.tuple([z.string(), z.string()])),
    planCommands: z.array(z.tuple([z.string(), planCommandSchema.nullable()])),
  }),
  z.object({
    kind: z.literal("outline"),
    threadId: z.string(),
    providerDisplayName: z.string().nullable(),
  }),
]);
export type ReadTask = z.infer<typeof readTaskSchema>;
export const maintenanceTaskSchema = z.object({
  kind: z.literal("truncate_outputs"),
  createdBefore: z.number(),
  limit: z.number().int().min(1).max(250),
  truncatedAt: z.number(),
});
export const databaseTaskSchema = z.union([
  readTaskSchema,
  maintenanceTaskSchema,
]);
export type DatabaseTask = z.infer<typeof databaseTaskSchema>;
export const maintenanceResultSchema = z.object({
  commandExecutionOutputs: z.number(),
  toolCallResults: z.number(),
  webFetchResultTexts: z.number(),
  webSearchResultTexts: z.number(),
});
export const readRequestSchema = z.object({
  id: z.number().int(),
  budgetMs: z.number().int().positive().max(30_000),
  task: databaseTaskSchema,
});
export type ReadRequest = z.infer<typeof readRequestSchema>;
export const readWorkerDataSchema = z.object({
  databasePath: z.string(),
  extensionPath: z.string(),
  mode: z.enum(["read", "maintenance"]),
  executionState: z.instanceof(SharedArrayBuffer),
});
const metricsSchema = z.object({
  sqlMs: z.number(),
  processingMs: z.number(),
  serializationMs: z.number(),
  workerTotalMs: z.number(),
  responseBytes: z.number().int(),
});
export const readWorkerMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready") }),
  z.object({
    kind: z.literal("result"),
    id: z.number().int(),
    json: z.string(),
    metrics: metricsSchema,
  }),
  z.object({
    kind: z.literal("failure"),
    id: z.number().int(),
    code: z.enum(["timeout", "busy", "not_found", "failed"]),
  }),
]);
export type ReadWorkerMessage = z.infer<typeof readWorkerMessageSchema>;
export const outlineReadResultSchema = z.object({
  response: threadConversationOutlineResponseSchema,
  cacheKey: z.string(),
});
