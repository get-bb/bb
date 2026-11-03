import { z } from "zod";
import { threadStatusValues } from "./thread-status.js";

const threadRuntimeDisplayStatusValues = [
  ...threadStatusValues,
  "provisioning",
  "waiting-for-host",
] as const;

export const threadRuntimeDisplayStatusSchema = z.enum(
  threadRuntimeDisplayStatusValues,
);

export const threadRuntimeStateSchema = z.object({
  displayStatus: threadRuntimeDisplayStatusSchema,
});

export const threadActivityStateSchema = z.object({
  activeWorkflowCount: z.number().int().nonnegative(),
  activeBackgroundAgentCount: z.number().int().nonnegative(),
  activeBackgroundCommandCount: z.number().int().nonnegative(),
  activePlanModeCount: z.number().int().nonnegative(),
  activeGoalCount: z.number().int().nonnegative(),
});
