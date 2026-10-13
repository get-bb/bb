import { z } from "zod";

export const SERVER_MOVE_STEP_IDS = [
  "stop-work",
  "update-target",
  "export",
  "transfer",
  "start-target",
  "verify-address",
  "switch",
] as const;

export const serverMoveStepIdSchema = z.enum(SERVER_MOVE_STEP_IDS);
export type ServerMoveStepId = z.infer<typeof serverMoveStepIdSchema>;

export const serverMoveModeSchema = z.enum(["connect", "direct"]);
export type ServerMoveMode = z.infer<typeof serverMoveModeSchema>;

export const lastServerMoveSchema = z
  .object({
    moveId: z.string().min(1),
    fromHostId: z.string().min(1),
    fromHostName: z.string().min(1),
    toHostId: z.string().min(1),
    toHostName: z.string().min(1),
    completedAt: z.number().int().nonnegative(),
    oldCopyDeletedAt: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type LastServerMove = z.infer<typeof lastServerMoveSchema>;

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatServerDataSize(bytes: number): string {
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded =
    unitIndex === 0 || value >= 10 ? Math.round(value) : value.toFixed(1);
  return `${rounded} ${BYTE_UNITS[unitIndex]}`;
}
