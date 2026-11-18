import { z } from "zod";

export const widgetIcons = [
  "message",
  "camera",
  "code",
  "terminal",
  "check",
  "star",
] as const;

const optionalSetting = z.string().trim().min(1).nullable();

export const widgetTargetSchema = z
  .object({
    profileId: z.string().min(1),
    projectId: z.string().min(1),
    projectName: z.string().trim().min(1),
    hostId: optionalSetting,
    providerId: optionalSetting,
    model: optionalSetting,
    baseBranch: optionalSetting,
    reasoningLevel: optionalSetting,
    icon: z.enum(widgetIcons),
    action: z.enum(["thread", "photo"]),
  })
  .refine(
    (target) =>
      target.providerId !== null ||
      (target.model === null && target.reasoningLevel === null),
  );

export type WidgetTarget = z.infer<typeof widgetTargetSchema>;
