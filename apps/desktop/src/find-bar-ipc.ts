import { z } from "zod";
import { BB_DESKTOP_MAX_FIND_TEXT_LENGTH } from "@bb/desktop-contract";

export const BB_DESKTOP_FIND_BAR_QUERY_CHANNEL = "bb-desktop:find-bar:query";
export const BB_DESKTOP_FIND_BAR_STEP_CHANNEL = "bb-desktop:find-bar:step";
export const BB_DESKTOP_FIND_BAR_CLOSE_CHANNEL = "bb-desktop:find-bar:close";
export const BB_DESKTOP_FIND_BAR_RESULT_CHANNEL = "bb-desktop:find-bar:result";
export const BB_DESKTOP_FIND_BAR_ACTIVATE_CHANNEL =
  "bb-desktop:find-bar:activate";

export const findBarQueryRequestSchema = z
  .object({
    text: z.string().max(BB_DESKTOP_MAX_FIND_TEXT_LENGTH),
  })
  .strict();
export type FindBarQueryRequest = z.infer<typeof findBarQueryRequestSchema>;

export const findBarStepRequestSchema = z
  .object({
    forward: z.boolean(),
  })
  .strict();
export type FindBarStepRequest = z.infer<typeof findBarStepRequestSchema>;

export const findBarResultSchema = z
  .object({
    activeMatchOrdinal: z.number().int().nonnegative(),
    matches: z.number().int().nonnegative(),
  })
  .strict();
export type FindBarResult = z.infer<typeof findBarResultSchema>;
