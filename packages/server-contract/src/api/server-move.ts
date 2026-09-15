import {
  lastServerMoveSchema,
  serverMoveModeSchema,
  serverMoveStepIdSchema,
} from "@bb/domain";
import { z } from "zod";

export const serverMoveStepStatusSchema = z.enum([
  "pending",
  "running",
  "done",
  "failed",
  "skipped",
]);
export type ServerMoveStepStatus = z.infer<typeof serverMoveStepStatusSchema>;

export const serverMoveStepSchema = z
  .object({
    id: serverMoveStepIdSchema,
    status: serverMoveStepStatusSchema,
    message: z.string().nullable(),
  })
  .strict();
export type ServerMoveStep = z.infer<typeof serverMoveStepSchema>;

export const serverMoveStateSchema = z.enum([
  "preparing",
  "switching",
  "recovery_required",
  "completed",
  "failed",
  "cancelled",
]);
export type ServerMoveState = z.infer<typeof serverMoveStateSchema>;

export const serverMoveStatusSchema = z
  .object({
    moveId: z.string().min(1),
    state: serverMoveStateSchema,
    mode: serverMoveModeSchema,
    targetHostId: z.string().min(1),
    targetHostName: z.string().min(1),
    serverUrl: z.string().min(1),
    destinationStatusUrl: z.string().min(1).nullable(),
    startedAt: z.number().int().nonnegative(),
    finishedAt: z.number().int().nonnegative().nullable(),
    error: z
      .object({
        step: serverMoveStepIdSchema,
        message: z.string(),
      })
      .strict()
      .nullable(),
    steps: z.array(serverMoveStepSchema),
    cancellable: z.boolean(),
  })
  .strict();
export type ServerMoveStatus = z.infer<typeof serverMoveStatusSchema>;

export const serverMoveStatusResponseSchema = z
  .object({
    move: serverMoveStatusSchema.nullable(),
    lastMove: lastServerMoveSchema.nullable(),
  })
  .strict();
export type ServerMoveStatusResponse = z.infer<
  typeof serverMoveStatusResponseSchema
>;

export const serverMoveCheckRequestSchema = z
  .object({
    targetHostId: z.string().min(1),
    serverUrl: z.string().min(1).nullable(),
  })
  .strict();
export type ServerMoveCheckRequest = z.infer<
  typeof serverMoveCheckRequestSchema
>;

export const serverMoveCheckSeveritySchema = z.enum([
  "blocker",
  "warning",
  "info",
]);
export type ServerMoveCheckSeverity = z.infer<
  typeof serverMoveCheckSeveritySchema
>;

export const serverMoveCheckItemSchema = z
  .object({
    id: z.string().min(1),
    severity: serverMoveCheckSeveritySchema,
    title: z.string().min(1),
    detail: z.string().nullable(),
  })
  .strict();
export type ServerMoveCheckItem = z.infer<typeof serverMoveCheckItemSchema>;

export const serverMoveCheckResponseSchema = z
  .object({
    targetHostId: z.string().min(1),
    targetHostName: z.string().min(1),
    mode: serverMoveModeSchema,
    serverUrl: z.string().min(1).nullable(),
    requiresServerUrl: z.boolean(),
    targetDataDir: z.string().min(1).nullable(),
    existingTargetServerData: z
      .object({
        path: z.string().min(1),
        sizeBytes: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
    items: z.array(serverMoveCheckItemSchema),
    canMove: z.boolean(),
  })
  .strict();
export type ServerMoveCheckResponse = z.infer<
  typeof serverMoveCheckResponseSchema
>;

export const serverMoveStartRequestSchema = z
  .object({
    targetHostId: z.string().min(1),
    serverUrl: z.string().min(1).nullable(),
    stopRunningWork: z.literal(true),
    archiveExistingTargetServerData: z.boolean(),
  })
  .strict();
export type ServerMoveStartRequest = z.infer<
  typeof serverMoveStartRequestSchema
>;

export const deleteOldServerCopyResponseSchema = z
  .object({
    deleted: z.boolean(),
  })
  .strict();
export type DeleteOldServerCopyResponse = z.infer<
  typeof deleteOldServerCopyResponseSchema
>;
