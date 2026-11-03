import { z } from "zod";

const dismissalSchema = z.object({
  kind: z.literal("dismiss"),
  threadId: z.string().min(1),
});

const taskPayloadSchema = z.object({
  data: z.object({ dataString: z.string() }),
});

const presentedDataSchema = z.object({ threadId: z.string().min(1) });

export interface PresentedPushNotification {
  identifier: string;
  data: unknown;
}

export function isDismissalPushData(data: unknown): boolean {
  return dismissalSchema.safeParse(data).success;
}

export function parseDismissedThreadId(payload: unknown): string | null {
  const task = taskPayloadSchema.safeParse(payload);
  if (!task.success) return null;
  let data: unknown;
  try {
    data = JSON.parse(task.data.data.dataString);
  } catch {
    return null;
  }
  const dismissal = dismissalSchema.safeParse(data);
  return dismissal.success ? dismissal.data.threadId : null;
}

export function presentedNotificationIdsForThread(
  presented: readonly PresentedPushNotification[],
  threadId: string,
): string[] {
  return presented.flatMap((notification) => {
    const data = presentedDataSchema.safeParse(notification.data);
    return data.success && data.data.threadId === threadId
      ? [notification.identifier]
      : [];
  });
}
