import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  experimental_THREAD_ACTION_GROUPS,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSettings,
  type PluginThreadActionDataInput,
  type PluginThreadActionRegistration,
} from "@get-bb/plugin-sdk/app";
import {
  THREAD_NOTIFICATIONS_CHANNEL,
  THREAD_NOTIFICATIONS_LIST_MAX_IDS,
  threadNotificationsUpdateSchema,
  type pushNotificationsRpcContract,
} from "./contract.js";
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

function chunk(ids: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (
    let start = 0;
    start < ids.length;
    start += THREAD_NOTIFICATIONS_LIST_MAX_IDS
  ) {
    chunks.push(ids.slice(start, start + THREAD_NOTIFICATIONS_LIST_MAX_IDS));
  }
  return chunks;
}

function cachedLevel(
  stored: ThreadNotificationInputs,
): ThreadNotificationInputs | null {
  return stored.own === "inherit" && stored.ancestorCap === null
    ? null
    : stored;
}

function withLevel(
  levels: ReadonlyMap<string, ThreadNotificationInputs>,
  threadId: string,
  stored: ThreadNotificationInputs | null,
): ReadonlyMap<string, ThreadNotificationInputs> {
  const next = new Map(levels);
  if (stored === null) next.delete(threadId);
  else next.set(threadId, stored);
  return next;
}

function useThreadNotificationsData({
  threadIds,
}: PluginThreadActionDataInput): ThreadNotificationsData {
  const rpc = useRpc<typeof pushNotificationsRpcContract>();
  const { values } = useSettings();
  const connection = useRealtimeConnectionState();
  const previousConnection = useRef(connection);
  const latestThreadIds = useRef(threadIds);
  const requested = useRef(new Set<string>());
  const [levels, setLevels] = useState<
    ReadonlyMap<string, ThreadNotificationInputs>
  >(() => new Map());

  const fetchLevels = useCallback(
    (ids: readonly string[], replace: boolean) => {
      for (const id of ids) requested.current.add(id);
      for (const batch of chunk(ids)) {
        void rpc
          .call("threadNotifications.list", { threadIds: batch })
          .then(({ threads }) => {
            setLevels((current) => {
              const changed = batch.filter((id) =>
                replace
                  ? current.get(id) !== threads[id]
                  : threads[id] !== undefined && !current.has(id),
              );
              if (changed.length === 0) return current;
              const next = new Map(current);
              for (const id of changed) {
                const stored = threads[id];
                if (stored === undefined) next.delete(id);
                else next.set(id, stored);
              }
              return next;
            });
          })
          .catch(() => {
            for (const id of batch) requested.current.delete(id);
          });
      }
    },
    [rpc],
  );

  useEffect(() => {
    latestThreadIds.current = threadIds;
    const missing = threadIds.filter((id) => !requested.current.has(id));
    if (missing.length > 0) fetchLevels(missing, false);
  }, [fetchLevels, threadIds]);

  useEffect(() => {
    const previous = previousConnection.current;
    previousConnection.current = connection;
    if (previous !== "reconnecting" || connection !== "connected") return;
    requested.current = new Set();
    const shown = new Set(latestThreadIds.current);
    setLevels((current) => {
      const next = new Map([...current].filter(([id]) => shown.has(id)));
      return next.size === current.size ? current : next;
    });
    if (latestThreadIds.current.length > 0) {
      fetchLevels(latestThreadIds.current, true);
    }
  }, [connection, fetchLevels]);

  useRealtime(THREAD_NOTIFICATIONS_CHANNEL, (payload) => {
    const update = threadNotificationsUpdateSchema.safeParse(payload);
    if (!update.success) return;
    const { threadId, notifications } = update.data;
    setLevels((current) => withLevel(current, threadId, notifications));
  });

  const setLevel = useCallback(
    async (threadId: string, level: OwnNotificationLevel) => {
      const stored = await rpc.call("threadNotifications.set", {
        threadId,
        level,
      });
      setLevels((current) => withLevel(current, threadId, cachedLevel(stored)));
    },
    [rpc],
  );

  const defaultsKey = JSON.stringify(parseDefaults(values));
  const defaults = useMemo(
    () => JSON.parse(defaultsKey) as NotificationDefaults | null,
    [defaultsKey],
  );

  return useMemo(
    () => ({ levels, defaults, setLevel }),
    [defaults, levels, setLevel],
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
    group: experimental_THREAD_ACTION_GROUPS.settings,
    useData: useThreadNotificationsData,
    item: ({ thread, data }) => {
      if (thread.archivedAt !== null) return null;
      const stored = data.levels.get(thread.id) ?? UNSET_THREAD_NOTIFICATIONS;
      const resolved =
        data.defaults === null
          ? null
          : {
              row: resolveThreadNotifications(
                stored,
                { parentThreadId: thread.parentThreadId },
                data.defaults,
              ),
              fallback: resolveThreadNotifications(
                UNSET_THREAD_NOTIFICATIONS,
                { parentThreadId: thread.parentThreadId },
                data.defaults,
              ).effective,
            };
      const hint = resolved === null ? undefined : capHint(resolved.row);
      return {
        label: "Notifications",
        ...(resolved === null
          ? {}
          : { detail: NOTIFICATION_LEVEL_LABELS[resolved.row.effective] }),
        icon:
          resolved === null ? "BellDot" : LEVEL_ICONS[resolved.row.effective],
        choices: {
          ...(hint === undefined ? {} : { hint }),
          items: ownNotificationLevelSchema.options.map((id) => ({
            id,
            label:
              id === "inherit" && resolved !== null
                ? `${NOTIFICATION_LEVEL_LABELS.inherit} (${NOTIFICATION_LEVEL_LABELS[resolved.fallback]})`
                : NOTIFICATION_LEVEL_LABELS[id],
            selected: id === stored.own,
          })),
        },
        run: async ({ value }) => {
          const level = ownNotificationLevelSchema.safeParse(value);
          if (!level.success) return;
          await data.setLevel(thread.id, level.data);
        },
      };
    },
  };
