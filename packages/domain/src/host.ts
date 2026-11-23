import { z } from "zod";
import { permissionModeSchema } from "./shared-types.js";

const hostStatusValues = ["connected", "disconnected"] as const;
export const hostStatusSchema = z.enum(hostStatusValues);

export const machineLifecycleSchema = z.object({
  phase: z.enum([
    "creating",
    "active",
    "suspending",
    "suspended",
    "resuming",
    "removing",
    "destroyed",
  ]),
  suspendedAt: z.number().nullable(),
  message: z.string().nullable(),
  pendingLog: z.string(),
  teardown: z
    .object({
      status: z.enum(["running", "failed", "removed"]),
      attempt: z.number().int().nonnegative(),
      needsRecovery: z.boolean(),
      blockedByEnvironmentId: z.string().nullable(),
    })
    .nullable(),
});
export type MachineLifecycle = z.infer<typeof machineLifecycleSchema>;

export const serverRouteKindSchema = z.enum([
  "local-network",
  "private-overlay",
  "relay",
  "custom",
]);
export type ServerRouteKind = z.infer<typeof serverRouteKindSchema>;

export const hostServerRouteSchema = z.object({
  providerId: z.string().min(1),
  kind: serverRouteKindSchema,
  displayName: z.string().min(1),
});
export type HostServerRoute = z.infer<typeof hostServerRouteSchema>;

export const hostTypeSchema = z.enum(["persistent", "ephemeral"]);
export type HostType = z.infer<typeof hostTypeSchema>;

export const hostSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: hostTypeSchema,
  status: hostStatusSchema,
  machineProviderId: z.string().nullable(),
  lifecycle: machineLifecycleSchema,
  maxPermissionMode: permissionModeSchema,
  lastSeenAt: z.number().nullable(),
  route: hostServerRouteSchema.nullable(),
  lastRejectedProtocolVersion: z.number().int().positive().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Host = z.infer<typeof hostSchema>;
