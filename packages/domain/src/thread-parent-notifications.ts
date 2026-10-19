import { z } from "zod";

export const threadParentNotificationsValues = [
  "auto",
  "stuck",
  "off",
] as const;
export const threadParentNotificationsSchema = z.enum(
  threadParentNotificationsValues,
);
export type ThreadParentNotifications = z.infer<
  typeof threadParentNotificationsSchema
>;
