import { z } from "zod";

export const widgetIcons = [
  "message",
  "camera",
  "microphone",
  "code",
  "terminal",
  "check",
  "star",
] as const;

const optionalSetting = z.string().trim().min(1).nullable();

const widgetTargetBase = {
  profileId: z.string().min(1),
  projectId: z.string().min(1),
  projectName: z.string().trim().min(1),
  icon: z.enum(widgetIcons),
};

const composerWidgetTargetSchema = z.object({
  ...widgetTargetBase,
  action: z.enum(["thread", "voice"]),
});

const photoWidgetTargetSchema = z
  .object({
    ...widgetTargetBase,
    action: z.literal("photo"),
    hostId: z.string().min(1),
    providerId: optionalSetting,
    model: optionalSetting,
    baseBranch: optionalSetting,
    reasoningLevel: optionalSetting,
  })
  .refine(
    (target) =>
      target.providerId !== null ||
      (target.model === null && target.reasoningLevel === null),
  );

export const widgetTargetSchema = z.union([
  composerWidgetTargetSchema,
  photoWidgetTargetSchema,
]);

export type WidgetTarget = z.infer<typeof widgetTargetSchema>;
export type PhotoWidgetTarget = z.infer<typeof photoWidgetTargetSchema>;
export type WidgetAction = WidgetTarget["action"];
