import { z } from "zod";

export const COMPLETED_TURN_DISPLAY_VALUES = ["collapse", "flat"] as const;

export const completedTurnDisplaySchema = z.enum(COMPLETED_TURN_DISPLAY_VALUES);

export type CompletedTurnDisplay =
  (typeof COMPLETED_TURN_DISPLAY_VALUES)[number];

export const DEFAULT_COMPLETED_TURN_DISPLAY: CompletedTurnDisplay = "collapse";
