import type {
  EnvironmentChangeKind,
  HostChangeKind,
  ProjectChangeKind,
  SystemChangeKind,
  ThreadChangeKind,
  ThreadChangeMetadata,
} from "@bb/domain";
import {
  environmentChangeKindSchema,
  hostChangeKindSchema,
  projectChangeKindSchema,
  systemChangeKindSchema,
  threadChangeKindSchema,
  threadChangeMetadataSchema,
} from "@bb/domain";
import type { DbNotifier } from "@bb/db";
import { z } from "zod";

const bufferedDbNotificationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("thread"),
    threadId: z.string().min(1),
    changes: z.array(threadChangeKindSchema),
    metadata: threadChangeMetadataSchema.optional(),
  }),
  z.object({
    kind: z.literal("project"),
    projectId: z.string().min(1),
    changes: z.array(projectChangeKindSchema),
  }),
  z.object({
    kind: z.literal("environment"),
    environmentId: z.string().min(1),
    changes: z.array(environmentChangeKindSchema),
  }),
  z.object({
    kind: z.literal("host"),
    hostId: z.string().min(1),
    changes: z.array(hostChangeKindSchema),
  }),
  z.object({
    kind: z.literal("system"),
    changes: z.array(systemChangeKindSchema),
  }),
]);

export type BufferedDbNotification = z.infer<
  typeof bufferedDbNotificationSchema
>;

export function parseBufferedDbNotification(
  value: unknown,
): BufferedDbNotification {
  return bufferedDbNotificationSchema.parse(value);
}

export function deliverBufferedDbNotification(
  notifier: DbNotifier,
  notification: BufferedDbNotification,
): void {
  flushNotification(notifier, notification);
}

function flushNotification(
  notifier: DbNotifier,
  notification: BufferedDbNotification,
): void {
  switch (notification.kind) {
    case "thread":
      notifier.notifyThread(
        notification.threadId,
        notification.changes,
        notification.metadata,
      );
      return;
    case "project":
      notifier.notifyProject(notification.projectId, notification.changes);
      return;
    case "environment":
      notifier.notifyEnvironment(
        notification.environmentId,
        notification.changes,
      );
      return;
    case "host":
      notifier.notifyHost(notification.hostId, notification.changes);
      return;
    case "system":
      notifier.notifySystem(notification.changes);
  }
}

export class NotificationBuffer implements DbNotifier {
  private readonly notifications: BufferedDbNotification[] = [];

  notifyThread(
    threadId: string,
    changes: ThreadChangeKind[],
    metadata?: ThreadChangeMetadata,
  ): void {
    this.notifications.push({
      kind: "thread",
      threadId,
      changes: [...changes],
      ...(metadata ? { metadata } : {}),
    });
  }

  notifyProject(projectId: string, changes: ProjectChangeKind[]): void {
    this.notifications.push({
      kind: "project",
      projectId,
      changes: [...changes],
    });
  }

  notifyEnvironment(
    environmentId: string,
    changes: EnvironmentChangeKind[],
  ): void {
    this.notifications.push({
      kind: "environment",
      environmentId,
      changes: [...changes],
    });
  }

  notifyHost(hostId: string, changes: HostChangeKind[]): void {
    this.notifications.push({ kind: "host", hostId, changes: [...changes] });
  }

  notifySystem(changes: SystemChangeKind[]): void {
    this.notifications.push({ kind: "system", changes: [...changes] });
  }

  snapshot(): BufferedDbNotification[] {
    return this.notifications.map((notification) =>
      structuredClone(notification),
    );
  }

  flushInto(notifier: DbNotifier): void {
    for (const notification of this.notifications) {
      flushNotification(notifier, notification);
    }
  }
}
