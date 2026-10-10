import { z } from "zod";

export const bbDesktopServerChoiceSchema = z
  .object({
    id: z.string().min(1).max(256),
    name: z.string().min(1),
    active: z.boolean(),
  })
  .strict();
export const bbDesktopServerChoicesSchema = z.array(
  bbDesktopServerChoiceSchema,
);
export type BbDesktopServerChoice = z.infer<typeof bbDesktopServerChoiceSchema>;
