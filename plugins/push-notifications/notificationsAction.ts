import { useCallback, useMemo } from "react";
import {
  experimental_THREAD_ACTION_GROUPS,
  experimental_useRpcKeyedQuery,
  experimental_useRpcMutation,
  useSettings,
  type PluginThreadActionDataInput,
  type PluginThreadActionRegistration,
} from "@get-bb/plugin-sdk/app";
import { pushNotificationsRpcContract } from "./contract.js";
import {
  NOTIFICATION_LEVEL_LABELS,
  notificationLevelSchema,
  ownNotificationLevelSchema,
  resolveThreadNotifications,
  UNSET_THREAD_NOTIFICATIONS,
  type NotificationDefaults,
  type NotificationLevel,
  type OwnNotificationLevel,
  type ThreadNotificationInputs,
  type ThreadNotifications,
} from "./preferences.js";

export interface ThreadNotificationsData {
  levels: ReadonlyMap<string, ThreadNotificationInputs>;
  defaults: NotificationDefaults | null;
  error: string | null;
  unloadedThreadIds: ReadonlySet<string> | null;
  retry(): Promise<void>;
  setLevel(threadId: string, level: OwnNotificationLevel): Promise<void>;
}

function parseDefaults(
  values: Record<string, string | number | boolean> | undefined,
): NotificationDefaults | null {
  const defaultLevel = notificationLevelSchema.safeParse(values?.defaultLevel);
  const childLevel = ownNotificationLevelSchema.safeParse(values?.childLevel);
  if (!defaultLevel.success || !childLevel.success) return null;
  return { defaultLevel: defaultLevel.data, childLevel: childLevel.data };
}

function selectNotificationRows(
  rows: Record<string, ThreadNotificationInputs>,
) {
  return {
    levels: Object.fromEntries(
      Object.entries(rows).filter(
        ([, value]) => value.own !== "inherit" || value.ancestorCap !== null,
      ),
    ),
    loaded: Object.fromEntries(Object.keys(rows).map((key) => [key, true])),
  };
}

function useThreadNotificationsData({
  threadIds,
}: PluginThreadActionDataInput): ThreadNotificationsData {
  const { mutate: saveLevel } = experimental_useRpcMutation({
    contract: pushNotificationsRpcContract,
    method: "threadNotifications.set",
    optimistic: ({ threadId, level }, cache) => {
      cache.updateKey("threadNotifications.keyed", threadId, (current) => ({
        ...current,
        own: level,
      }));
    },
  });
  const { values } = useSettings();
  const query = experimental_useRpcKeyedQuery({
    contract: pushNotificationsRpcContract,
    method: "threadNotifications.keyed",
    keys: threadIds,
    select: selectNotificationRows,
  });
  const retry = query.refetch;
  const error = query.error?.message ?? null;
  const unloadedThreadIds = useMemo(
    () =>
      error === null
        ? null
        : new Set(threadIds.filter((id) => query.data?.loaded[id] !== true)),
    [error, query.data, threadIds],
  );
  const levels = useMemo(
    () => new Map(Object.entries(query.data?.levels ?? {})),
    [query.data?.levels],
  );
  const setLevel = useCallback(
    async (threadId: string, level: OwnNotificationLevel) => {
      await saveLevel({ threadId, level });
    },
    [saveLevel],
  );

  const defaults = useMemo(() => parseDefaults(values), [values]);

  return useMemo(
    () => ({ levels, defaults, setLevel, error, unloadedThreadIds, retry }),
    [defaults, levels, setLevel, error, unloadedThreadIds, retry],
  );
}

const LEVEL_ICONS: Record<NotificationLevel, string> = {
  all: "push-notifications/ringing",
  "input-only": "BellDot",
  muted: "push-notifications/off",
};

function capHint(row: ThreadNotifications): string | undefined {
  if (row.source === "parent") return "Limited by a parent thread";
  if (row.source === "ancestor") return "Limited by an ancestor thread";
  return undefined;
}

export const notificationsThreadAction: PluginThreadActionRegistration<ThreadNotificationsData> =
  {
    id: "notifications",
    title: "Notifications",
    icon: "BellDot",
    group: experimental_THREAD_ACTION_GROUPS.state,
    order: 50,
    useData: useThreadNotificationsData,
    item: ({ thread, data }) => {
      if (thread.archivedAt !== null) return null;
      const stored = data.levels.get(thread.id) ?? UNSET_THREAD_NOTIFICATIONS;
      const resolved =
        data.defaults === null
          ? null
          : resolveThreadNotifications(
              stored,
              { parentThreadId: thread.parentThreadId },
              data.defaults,
            );
      const unavailable = data.unloadedThreadIds?.has(thread.id) ?? false;
      const hint =
        data.error ?? (resolved === null ? undefined : capHint(resolved));
      return {
        label: "Notifications",
        ...(unavailable
          ? { detail: "Notifications unavailable" }
          : resolved === null
            ? {}
            : { detail: NOTIFICATION_LEVEL_LABELS[resolved.effective] }),
        icon: resolved === null ? "BellDot" : LEVEL_ICONS[resolved.effective],
        choices: {
          ...(hint === undefined ? {} : { hint }),
          items: [
            ...(unavailable
              ? []
              : ownNotificationLevelSchema.options.map((id) => ({
                  id,
                  label: NOTIFICATION_LEVEL_LABELS[id],
                  selected: id === stored.own,
                }))),
            ...(data.error === null ? [] : [{ id: "retry", label: "Retry" }]),
          ],
        },
        run: async ({ value }) => {
          if (value === "retry") {
            await data.retry();
            return;
          }
          const level = ownNotificationLevelSchema.safeParse(value);
          if (!level.success) return;
          await data.setLevel(thread.id, level.data);
        },
      };
    },
    experimental_bulkItem: ({ threads, data }) => {
      const active = threads.filter((thread) => thread.archivedAt === null);
      const [first] = active;
      if (first === undefined) return null;
      const stored = active.map(
        (thread) => data.levels.get(thread.id) ?? UNSET_THREAD_NOTIFICATIONS,
      );
      const sharedOwn = stored.every((row) => row.own === stored[0]?.own)
        ? (stored[0]?.own ?? null)
        : null;
      const defaults = data.defaults;
      const resolved =
        defaults === null
          ? null
          : active.map((thread, index) =>
              resolveThreadNotifications(
                stored[index] ?? UNSET_THREAD_NOTIFICATIONS,
                { parentThreadId: thread.parentThreadId },
                defaults,
              ),
            );
      const sharedEffective =
        resolved !== null &&
        resolved.every((row) => row.effective === resolved[0]?.effective)
          ? (resolved[0]?.effective ?? null)
          : null;
      const unavailable = active.some(
        (thread) => data.unloadedThreadIds?.has(thread.id) ?? false,
      );
      const capped = resolved?.some((row) => capHint(row) !== undefined);
      const hint =
        data.error ??
        (capped ? "Some threads are limited by a parent thread" : undefined);
      return {
        label: "Notifications",
        ...(unavailable
          ? { detail: "Notifications unavailable" }
          : resolved === null
            ? {}
            : {
                detail:
                  sharedEffective === null
                    ? "Mixed"
                    : NOTIFICATION_LEVEL_LABELS[sharedEffective],
              }),
        icon:
          sharedEffective === null ? "BellDot" : LEVEL_ICONS[sharedEffective],
        choices: {
          ...(hint === undefined ? {} : { hint }),
          items: [
            ...(unavailable
              ? []
              : ownNotificationLevelSchema.options.map((id) => ({
                  id,
                  label: NOTIFICATION_LEVEL_LABELS[id],
                  selected: id === sharedOwn,
                }))),
            ...(data.error === null ? [] : [{ id: "retry", label: "Retry" }]),
          ],
        },
        run: async ({ value }) => {
          if (value === "retry") {
            await data.retry();
            return;
          }
          const level = ownNotificationLevelSchema.safeParse(value);
          if (!level.success) return;
          await Promise.all(
            active.map((thread) => data.setLevel(thread.id, level.data)),
          );
        },
      };
    },
  };
