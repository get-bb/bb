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

export const threadNotificationInputsSchema = z
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
export type ThreadNotificationInputs = z.infer<
  typeof threadNotificationInputsSchema
>;
export type ThreadNotifications = z.infer<typeof threadNotificationsSchema>;

export interface NotificationDefaults {
  defaultLevel: NotificationLevel;
  childLevel: OwnNotificationLevel;
}

export const UNSET_THREAD_NOTIFICATIONS: ThreadNotificationInputs = {
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

function isQuieter(
  candidate: NotificationLevel,
  than: NotificationLevel,
): boolean {
  return LEVEL_RANK[candidate] < LEVEL_RANK[than];
}

export function resolveThreadNotifications(
  stored: ThreadNotificationInputs,
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

function isUnset(inputs: ThreadNotificationInputs): boolean {
  return inputs.own === "inherit" && inputs.ancestorCap === null;
}

const SDK_THREAD_BATCH_MAX_IDS = 200;

function chunk<T>(items: readonly T[]): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += SDK_THREAD_BATCH_MAX_IDS) {
    chunks.push(items.slice(start, start + SDK_THREAD_BATCH_MAX_IDS));
  }
  return chunks;
}

const NOTIFICATIONS_METADATA_KEY = "notifications";

const storedNotificationsMetadataSchema = z.object({
  [NOTIFICATIONS_METADATA_KEY]: z
    .object({ own: notificationLevelSchema })
    .strict(),
});

export function parseStoredNotificationLevel(
  metadata: unknown,
): NotificationLevel | null {
  const parsed = storedNotificationsMetadataSchema.safeParse(metadata);
  return parsed.success ? parsed.data[NOTIFICATIONS_METADATA_KEY].own : null;
}

interface ResolvedThreadInputs {
  inputs: ThreadNotificationInputs;
  parentThreadId: string | null;
}

export interface NotificationPreferences {
  list(
    threadIds: readonly string[],
  ): Promise<Record<string, ThreadNotificationInputs>>;
  get(threadId: string): Promise<ThreadNotifications>;
  set(
    threadId: string,
    level: OwnNotificationLevel,
  ): Promise<ThreadNotificationInputs>;
  effectiveLevel(thread: {
    id: string;
    parentThreadId: string | null;
  }): Promise<NotificationLevel>;
  publishSubtree(threadId: string): Promise<void>;
}

export function createNotificationPreferences(args: {
  bb: BbPluginApi;
  getDefaults(): Promise<NotificationDefaults>;
  publish(threads: Record<string, ThreadNotificationInputs>): void;
}): NotificationPreferences {
  const { bb, getDefaults, publish } = args;
  let publicationQueue: Promise<void> = Promise.resolve();

  async function readOwnLevels(
    threadIds: readonly string[],
  ): Promise<Map<string, NotificationLevel>> {
    const levels = new Map<string, NotificationLevel>();
    for (const batch of chunk(threadIds)) {
      const { threads } = await bb.sdk.threads.experimental_listPluginMetadata({
        threadIds: batch,
      });
      for (const { threadId, metadata } of threads) {
        const level = parseStoredNotificationLevel(metadata);
        if (level !== null) levels.set(threadId, level);
      }
    }
    return levels;
  }

  async function resolveInputs(
    threadIds: readonly string[],
  ): Promise<Map<string, ResolvedThreadInputs>> {
    const ancestry: { threadId: string; ancestorIds: string[] }[] = [];
    for (const batch of chunk(threadIds)) {
      const { threads } = await bb.sdk.threads.experimental_listAncestors({
        threadIds: batch,
      });
      ancestry.push(...threads);
    }
    const levels = await readOwnLevels([
      ...new Set(
        ancestry.flatMap(({ threadId, ancestorIds }) => [
          threadId,
          ...ancestorIds,
        ]),
      ),
    ]);
    const resolved = new Map<string, ResolvedThreadInputs>();
    for (const { threadId, ancestorIds } of ancestry) {
      let ancestorCap: ThreadNotificationInputs["ancestorCap"] = null;
      for (const ancestorId of ancestorIds) {
        const level = levels.get(ancestorId);
        if (
          level !== undefined &&
          (ancestorCap === null || isQuieter(level, ancestorCap.level))
        ) {
          ancestorCap = { level, threadId: ancestorId };
        }
      }
      resolved.set(threadId, {
        inputs: { own: levels.get(threadId) ?? "inherit", ancestorCap },
        parentThreadId: ancestorIds[0] ?? null,
      });
    }
    return resolved;
  }

  async function requireInputs(
    threadId: string,
  ): Promise<ResolvedThreadInputs> {
    const resolved = (await resolveInputs([threadId])).get(threadId);
    if (resolved === undefined) throw new Error("Thread not found");
    return resolved;
  }

  function publishSubtree(
    threadId: string,
  ): Promise<Map<string, ResolvedThreadInputs>> {
    const result = publicationQueue.then(async () => {
      const { threads } = await bb.sdk.threads.experimental_listDescendants({
        threadIds: [threadId],
      });
      const resolved = await resolveInputs([
        threadId,
        ...(threads[0]?.descendantIds ?? []),
      ]);
      for (const batch of chunk([...resolved])) {
        publish(
          Object.fromEntries(batch.map(([id, { inputs }]) => [id, inputs])),
        );
      }
      return resolved;
    });
    publicationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  return {
    async list(threadIds) {
      const result: Record<string, ThreadNotificationInputs> = {};
      for (const [threadId, { inputs }] of await resolveInputs(threadIds)) {
        if (!isUnset(inputs)) result[threadId] = inputs;
      }
      return result;
    },
    async get(threadId) {
      const [{ inputs, parentThreadId }, defaults] = await Promise.all([
        requireInputs(threadId),
        getDefaults(),
      ]);
      return resolveThreadNotifications(inputs, { parentThreadId }, defaults);
    },
    async set(threadId, level) {
      await requireInputs(threadId);
      await bb.sdk.threads.updatePluginMetadata(
        level === "inherit"
          ? { threadId, remove: [NOTIFICATIONS_METADATA_KEY] }
          : { threadId, set: { [NOTIFICATIONS_METADATA_KEY]: { own: level } } },
      );
      const resolved = (await publishSubtree(threadId)).get(threadId);
      if (resolved === undefined) throw new Error("Thread not found");
      return resolved.inputs;
    },
    async effectiveLevel(thread) {
      const [resolved, defaults] = await Promise.all([
        resolveInputs([thread.id]),
        getDefaults(),
      ]);
      return resolveThreadNotifications(
        resolved.get(thread.id)?.inputs ?? UNSET_THREAD_NOTIFICATIONS,
        { parentThreadId: thread.parentThreadId },
        defaults,
      ).effective;
    },
    async publishSubtree(threadId) {
      await publishSubtree(threadId);
    },
  };
}
