import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const notificationLevelSchema = z.enum(["all", "input-only", "muted"]);
export const ownNotificationLevelSchema = z.enum([
  "inherit",
  ...notificationLevelSchema.options,
]);
export const notificationSourceSchema = z.enum([
  "self",
  "parent",
  "ancestor",
  "global",
  "child-default",
]);

export const storedThreadNotificationsSchema = z
  .object({
    own: ownNotificationLevelSchema,
    ancestorCap: z
      .object({ level: notificationLevelSchema, threadId: z.string().min(1) })
      .strict()
      .nullable(),
  })
  .strict();

export const threadNotificationsSchema = z
  .object({
    own: ownNotificationLevelSchema,
    effective: notificationLevelSchema,
    source: notificationSourceSchema,
  })
  .strict();

export type NotificationLevel = z.infer<typeof notificationLevelSchema>;
export type OwnNotificationLevel = z.infer<typeof ownNotificationLevelSchema>;
export type NotificationSource = z.infer<typeof notificationSourceSchema>;
export type StoredThreadNotifications = z.infer<
  typeof storedThreadNotificationsSchema
>;
export type ThreadNotifications = z.infer<typeof threadNotificationsSchema>;

export interface NotificationDefaults {
  defaultLevel: NotificationLevel;
  childLevel: OwnNotificationLevel;
}

export const UNSET_THREAD_NOTIFICATIONS: StoredThreadNotifications = {
  own: "inherit",
  ancestorCap: null,
};

export const NOTIFICATION_LEVEL_LABELS: Record<OwnNotificationLevel, string> = {
  inherit: "Default",
  all: "All activity",
  "input-only": "Needs input only",
  muted: "Muted",
};

export type PushNotificationKind =
  | "pending-interaction"
  | "turn-finished"
  | "thread-error";

export const NOTIFICATION_KINDS_BY_LEVEL: Record<
  NotificationLevel,
  ReadonlySet<PushNotificationKind>
> = {
  all: new Set(["pending-interaction", "thread-error", "turn-finished"]),
  "input-only": new Set(["pending-interaction", "thread-error"]),
  muted: new Set(),
};

const LEVEL_RANK: Record<NotificationLevel, number> = {
  muted: 0,
  "input-only": 1,
  all: 2,
};

type AncestorCap = NonNullable<StoredThreadNotifications["ancestorCap"]>;

function isQuieter(
  candidate: NotificationLevel,
  than: NotificationLevel,
): boolean {
  return LEVEL_RANK[candidate] < LEVEL_RANK[than];
}

export function resolveThreadNotifications(
  stored: StoredThreadNotifications,
  thread: { parentThreadId: string | null },
  defaults: NotificationDefaults,
): ThreadNotifications {
  const { own, ancestorCap } = stored;
  const base: { level: NotificationLevel; source: NotificationSource } =
    own !== "inherit"
      ? { level: own, source: "self" }
      : thread.parentThreadId !== null && defaults.childLevel !== "inherit"
        ? { level: defaults.childLevel, source: "child-default" }
        : { level: defaults.defaultLevel, source: "global" };
  if (ancestorCap === null || !isQuieter(ancestorCap.level, base.level)) {
    return { own, effective: base.level, source: base.source };
  }
  return {
    own,
    effective: ancestorCap.level,
    source:
      ancestorCap.threadId === thread.parentThreadId ? "parent" : "ancestor",
  };
}

export function describeNotificationSource(row: ThreadNotifications): string {
  if (row.source === "self") return "set on this thread";
  if (row.source === "parent") return "limited by parent";
  if (row.source === "ancestor") return "limited by an ancestor";
  if (row.source === "child-default") return "child-thread default";
  return "default";
}

function capForChildren(
  threadId: string,
  stored: StoredThreadNotifications,
): AncestorCap | null {
  const { own, ancestorCap } = stored;
  if (own === "inherit") return ancestorCap;
  return ancestorCap !== null && isQuieter(ancestorCap.level, own)
    ? ancestorCap
    : { level: own, threadId };
}

function sameCap(left: AncestorCap | null, right: AncestorCap | null): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.level === right.level &&
      left.threadId === right.threadId)
  );
}

function isUnset(stored: StoredThreadNotifications): boolean {
  return stored.own === "inherit" && stored.ancestorCap === null;
}

const NOTIFICATIONS_METADATA_KEY = "notifications";

const storedNotificationsMetadataSchema = z.object({
  [NOTIFICATIONS_METADATA_KEY]: storedThreadNotificationsSchema,
});

export function parseStoredThreadNotifications(
  metadata: unknown,
): StoredThreadNotifications | null {
  const parsed = storedNotificationsMetadataSchema.safeParse(metadata);
  return parsed.success ? parsed.data[NOTIFICATIONS_METADATA_KEY] : null;
}

export interface NotificationPreferences {
  list(
    threadIds: readonly string[],
  ): Promise<Record<string, StoredThreadNotifications>>;
  get(threadId: string): Promise<ThreadNotifications>;
  set(
    threadId: string,
    level: OwnNotificationLevel,
  ): Promise<StoredThreadNotifications>;
  onThreadCreated(thread: {
    id: string;
    parentThreadId: string | null;
  }): Promise<void>;
  effectiveLevel(thread: {
    id: string;
    parentThreadId: string | null;
  }): Promise<NotificationLevel>;
}

export function createNotificationPreferences(args: {
  bb: BbPluginApi;
  getDefaults(): Promise<NotificationDefaults>;
  publish(threadId: string, stored: StoredThreadNotifications | null): void;
}): NotificationPreferences {
  const { bb, getDefaults, publish } = args;

  async function readStored(
    threadId: string,
  ): Promise<StoredThreadNotifications> {
    return (
      parseStoredThreadNotifications(
        await bb.sdk.threads.getPluginMetadata({ threadId }),
      ) ?? UNSET_THREAD_NOTIFICATIONS
    );
  }

  async function writeStored(
    threadId: string,
    stored: StoredThreadNotifications,
  ): Promise<void> {
    const unset = isUnset(stored);
    await bb.sdk.threads.updatePluginMetadata(
      unset
        ? { threadId, remove: [NOTIFICATIONS_METADATA_KEY] }
        : { threadId, set: { [NOTIFICATIONS_METADATA_KEY]: stored } },
    );
    publish(threadId, unset ? null : stored);
  }

  async function pushCap(
    threadId: string,
    cap: AncestorCap | null,
  ): Promise<void> {
    const children = await bb.sdk.threads.list({
      parentThreadId: threadId,
      includeHidden: true,
    });
    for (const child of children) {
      const existing = await readStored(child.id);
      if (sameCap(existing.ancestorCap, cap)) continue;
      const next = { ...existing, ancestorCap: cap };
      await writeStored(child.id, next);
      const childCap = capForChildren(child.id, next);
      if (!sameCap(childCap, capForChildren(child.id, existing))) {
        await pushCap(child.id, childCap);
      }
    }
  }

  return {
    async list(threadIds) {
      const { threads } = await bb.sdk.threads.experimental_listPluginMetadata({
        threadIds,
      });
      const levels: Record<string, StoredThreadNotifications> = {};
      for (const { threadId, metadata } of threads) {
        const stored = parseStoredThreadNotifications(metadata);
        if (stored !== null && !isUnset(stored)) levels[threadId] = stored;
      }
      return levels;
    },
    async get(threadId) {
      const [stored, thread, defaults] = await Promise.all([
        readStored(threadId),
        bb.sdk.threads.get({ threadId }),
        getDefaults(),
      ]);
      return resolveThreadNotifications(
        stored,
        { parentThreadId: thread.parentThreadId },
        defaults,
      );
    },
    async set(threadId, level) {
      const existing = await readStored(threadId);
      if (existing.own === level) return existing;
      const stored = { ...existing, own: level };
      await writeStored(threadId, stored);
      const cap = capForChildren(threadId, stored);
      if (!sameCap(cap, capForChildren(threadId, existing))) {
        await pushCap(threadId, cap);
      }
      return stored;
    },
    async onThreadCreated(thread) {
      if (thread.parentThreadId === null) return;
      const cap = capForChildren(
        thread.parentThreadId,
        await readStored(thread.parentThreadId),
      );
      if (cap === null) return;
      const existing = await readStored(thread.id);
      if (sameCap(existing.ancestorCap, cap)) return;
      await writeStored(thread.id, { ...existing, ancestorCap: cap });
    },
    async effectiveLevel(thread) {
      const [stored, defaults] = await Promise.all([
        readStored(thread.id),
        getDefaults(),
      ]);
      return resolveThreadNotifications(
        stored,
        { parentThreadId: thread.parentThreadId },
        defaults,
      ).effective;
    },
  };
}
