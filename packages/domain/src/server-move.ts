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
