import { z } from "zod";
import { permissionModeSchema } from "./shared-types.js";

const hostTypeValues = ["persistent"] as const;
export const hostTypeSchema = z.enum(hostTypeValues);
export type HostType = z.infer<typeof hostTypeSchema>;

const hostStatusValues = ["connected", "disconnected"] as const;
export const hostStatusSchema = z.enum(hostStatusValues);

export const hostSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: hostTypeSchema,
  status: hostStatusSchema,
  /**
   * Permission ceiling for work that runs on this machine. Threads resolve
   * down to this mode, so a sandbox machine can stay at "full" while a
   * personal laptop refuses to go above "accept-edits". Only an owner session
   * changes it; machine credentials cannot (see the hosts routes).
   */
  maxPermissionMode: permissionModeSchema,
  lastSeenAt: z.number().nullable(),
  lastRejectedProtocolVersion: z.number().int().positive().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Host = z.infer<typeof hostSchema>;
