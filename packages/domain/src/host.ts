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
    })
    .nullable(),
});
export type MachineLifecycle = z.infer<typeof machineLifecycleSchema>;

export const hostSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["persistent", "ephemeral"]),
  status: hostStatusSchema,
  machineProviderId: z.string().nullable(),
  lifecycle: machineLifecycleSchema,
  maxPermissionMode: permissionModeSchema,
  lastSeenAt: z.number().nullable(),
  lastRejectedProtocolVersion: z.number().int().positive().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Host = z.infer<typeof hostSchema>;
