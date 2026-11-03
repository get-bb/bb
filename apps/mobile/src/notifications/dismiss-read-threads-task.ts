import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import {
  parseDismissedThreadId,
  presentedNotificationIdsForThread,
} from "@/data/notifications";

const DISMISS_READ_THREADS_TASK = "bb-dismiss-read-thread-notifications";

async function dismissThread(threadId: string): Promise<number> {
  const presented = await Notifications.getPresentedNotificationsAsync();
  const identifiers = presentedNotificationIdsForThread(
    presented.map((notification) => ({
      identifier: notification.request.identifier,
      data: notification.request.content.data,
    })),
    threadId,
  );
  await Promise.all(
    identifiers.map((identifier) =>
      Notifications.dismissNotificationAsync(identifier),
    ),
  );
  return identifiers.length;
}

TaskManager.defineTask<Notifications.NotificationTaskPayload>(
  DISMISS_READ_THREADS_TASK,
  async ({ data }) => {
    const threadId = parseDismissedThreadId(data);
    if (threadId === null) {
      return Notifications.BackgroundNotificationTaskResult.NoData;
    }
    return (await dismissThread(threadId)) > 0
      ? Notifications.BackgroundNotificationTaskResult.NewData
      : Notifications.BackgroundNotificationTaskResult.NoData;
  },
);

Notifications.registerTaskAsync(DISMISS_READ_THREADS_TASK).catch(
  (error: unknown) => {
    console.warn("Could not register the notification dismissal task", error);
  },
);
