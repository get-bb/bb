import { z } from "zod";

export const bbDesktopServerTargetSchema = z
  .object({
    active: z.boolean(),
    id: z.string().min(1).max(256),
    kind: z.enum(["builtin", "connect", "custom"]),
    name: z.string().min(1),
  })
  .strict();
export type BbDesktopServerTarget = z.infer<typeof bbDesktopServerTargetSchema>;

export const bbDesktopServerTargetsSchema = z.array(
  bbDesktopServerTargetSchema,
);

export type BbDesktopServerTargetsChangeHandler = (
  servers: BbDesktopServerTarget[],
) => void;
