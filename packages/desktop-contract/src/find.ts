import { z } from "zod";

export const BB_DESKTOP_MAX_FIND_TEXT_LENGTH = 1024;
export const BB_DESKTOP_MAX_FIND_TOP_OFFSET = 400;

export const bbDesktopWindowFindRequestSchema = z
  .object({
    topOffset: z.number().int().min(0).max(BB_DESKTOP_MAX_FIND_TOP_OFFSET),
  })
  .strict();
export type BbDesktopWindowFindRequest = z.infer<
  typeof bbDesktopWindowFindRequestSchema
>;
