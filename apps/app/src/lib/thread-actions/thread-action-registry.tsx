import {
  Component,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type {
  BbNavigate,
  PluginBoundThreadAction,
  PluginBrowserBbSdk,
  PluginThreadAction,
  PluginThreadActionEntry,
  PluginThreadActionRegistration,
  PluginThreadActionRegistrationInfo,
  PluginThreadActionTarget,
  PluginThreadActionsOptions,
} from "@get-bb/plugin-sdk";
import { PluginContext } from "@/components/plugin/plugin-context";
import { getActiveThreadPanelOpener } from "@/components/plugin/plugin-thread-panel-navigation";
import { useBbNavigate, useSdk } from "@/lib/plugin-sdk-hooks";
import { usePluginSlots } from "@/lib/plugin-slots";

export const CORE_THREAD_ACTION_OWNER = "bb--core";

export interface ThreadActionRegistrationRecord {
  key: string;
  instanceKey: string;
  pluginId: string;
  registration: PluginThreadActionRegistration<unknown>;
}

interface CollectedThreadAction {
  data: unknown;
  sdk: PluginBrowserBbSdk;
  navigate: BbNavigate;
}

interface ThreadActionRegistrySnapshot {
  records: readonly ThreadActionRegistrationRecord[];
  collected: ReadonlyMap<string, CollectedThreadAction>;
  requestRename: (threadId: string) => void;
}

function requestRenameUnavailable(threadId: string): void {
  console.warn(`thread actions: no rename editor for ${threadId}`);
}

let snapshot: ThreadActionRegistrySnapshot = {
  records: [],
  collected: new Map(),
  requestRename: requestRenameUnavailable,
};
const listeners = new Set<() => void>();

function setSnapshot(next: ThreadActionRegistrySnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ThreadActionRegistrySnapshot {
  return snapshot;
}

function publishCollected(key: string, value: CollectedThreadAction): void {
  const current = snapshot.collected.get(key);
  if (
    current !== undefined &&
    Object.is(current.data, value.data) &&
    current.sdk === value.sdk &&
    current.navigate === value.navigate
  ) {
    return;
  }
  const collected = new Map(snapshot.collected);
  collected.set(key, value);
  setSnapshot({ ...snapshot, collected });
}

function dropCollected(key: string): void {
  if (!snapshot.collected.has(key)) return;
  const collected = new Map(snapshot.collected);
  collected.delete(key);
  setSnapshot({ ...snapshot, collected });
}

function publishRecords(
  records: readonly ThreadActionRegistrationRecord[],
): void {
  if (
    records.length === snapshot.records.length &&
    records.every(
      (record, index) =>
        record.registration === snapshot.records[index]?.registration,
    )
  ) {
    return;
  }
  setSnapshot({ ...snapshot, records });
}

const subscribedThreadCounts = new Map<string, number>();
let subscribedThreadIds: readonly string[] = [];
const threadIdListeners = new Set<() => void>();

function subscribeThreadIds(listener: () => void): () => void {
  threadIdListeners.add(listener);
  return () => {
    threadIdListeners.delete(listener);
  };
}

function getSubscribedThreadIds(): readonly string[] {
  return subscribedThreadIds;
}

const THREAD_IDS_QUIET_MS = 32;
const THREAD_IDS_MAX_WAIT_MS = 100;
let threadIdsFlushTimer: ReturnType<typeof setTimeout> | null = null;
let threadIdsPendingSince: number | null = null;

function cancelThreadIdsFlush(): void {
  if (threadIdsFlushTimer !== null) clearTimeout(threadIdsFlushTimer);
  threadIdsFlushTimer = null;
  threadIdsPendingSince = null;
}

function flushSubscribedThreadIds(): void {
  cancelThreadIdsFlush();
  const next = [...subscribedThreadCounts.keys()].sort();
  if (
    next.length === subscribedThreadIds.length &&
    next.every((id, index) => id === subscribedThreadIds[index])
  ) {
    return;
  }
  subscribedThreadIds = next;
  for (const listener of threadIdListeners) listener();
}

function scheduleSubscribedThreadIdsFlush(): void {
  const now = performance.now();
  threadIdsPendingSince ??= now;
  if (threadIdsFlushTimer !== null) clearTimeout(threadIdsFlushTimer);
  const remaining = THREAD_IDS_MAX_WAIT_MS - (now - threadIdsPendingSince);
  threadIdsFlushTimer = setTimeout(
    flushSubscribedThreadIds,
    Math.max(0, Math.min(THREAD_IDS_QUIET_MS, remaining)),
  );
}

function retainThreadId(threadId: string): () => void {
  subscribedThreadCounts.set(
    threadId,
    (subscribedThreadCounts.get(threadId) ?? 0) + 1,
  );
  scheduleSubscribedThreadIdsFlush();
  return () => {
    const count = subscribedThreadCounts.get(threadId) ?? 0;
    if (count <= 1) subscribedThreadCounts.delete(threadId);
    else subscribedThreadCounts.set(threadId, count - 1);
    scheduleSubscribedThreadIdsFlush();
  };
}

const ThreadActionSurfaceVisibleContext = createContext(true);

export function ThreadActionSurfaceVisibility({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  return (
    <ThreadActionSurfaceVisibleContext.Provider value={visible}>
      {children}
    </ThreadActionSurfaceVisibleContext.Provider>
  );
}

export function resetThreadActionRegistryForTest(): void {
  reportedFailures.clear();
  subscribedThreadCounts.clear();
  subscribedThreadIds = [];
  cancelThreadIdsFlush();
  setSnapshot({
    records: [],
    collected: new Map(),
    requestRename: requestRenameUnavailable,
  });
}

const reportedFailures = new Set<string>();

function reportFailure(key: string, phase: string, error: unknown): void {
  const id = `${key}:${phase}`;
  if (reportedFailures.has(id)) return;
  reportedFailures.add(id);
  console.error(`thread action "${key}" failed in ${phase}`, error);
}

function useLatestNavigate(navigate: BbNavigate, pluginId: string): BbNavigate {
  const latest = useRef(navigate);
  useLayoutEffect(() => {
    latest.current = navigate;
  });
  const [stable] = useState<BbNavigate>(() => ({
    toThread: (...args) => latest.current.toThread(...args),
    toProject: (...args) => latest.current.toProject(...args),
    toPluginPanel: (...args) => latest.current.toPluginPanel(...args),
    toCompose: (...args) => latest.current.toCompose(...args),
    openThreadPanel: (options) =>
      getActiveThreadPanelOpener()?.({ ...options, pluginId }) ?? false,
    openUrl: (...args) => latest.current.openUrl(...args),
    experimental_openFilePreview: (...args) =>
      latest.current.experimental_openFilePreview(...args),
    experimental_openFileExternally: (...args) =>
      latest.current.experimental_openFileExternally(...args),
    experimental_openTerminal: (...args) =>
      latest.current.experimental_openTerminal(...args),
  }));
  return stable;
}

function ThreadActionCollector({
  record,
}: {
  record: ThreadActionRegistrationRecord;
}) {
  const threadIds = useSyncExternalStore(
    subscribeThreadIds,
    getSubscribedThreadIds,
  );
  const data = record.registration.useData?.({ threadIds });
  const sdk = useSdk();
  const navigate = useLatestNavigate(useBbNavigate(), record.pluginId);
  useLayoutEffect(() => {
    publishCollected(record.key, { data, sdk, navigate });
  }, [data, navigate, record.key, sdk]);
  useLayoutEffect(() => () => dropCollected(record.key), [record.key]);
  return null;
}

class ThreadActionCollectorBoundary extends Component<
  { registrationKey: string; children: ReactNode },
  { crashed: boolean }
> {
  override state = { crashed: false };

  static getDerivedStateFromError(): { crashed: boolean } {
    return { crashed: true };
  }

  override componentDidCatch(error: Error): void {
    reportFailure(this.props.registrationKey, "useData", error);
    dropCollected(this.props.registrationKey);
  }

  override render(): ReactNode {
    return this.state.crashed ? null : this.props.children;
  }
}

function useThreadActionRecords(
  coreRegistrations: readonly PluginThreadActionRegistration<unknown>[],
): readonly ThreadActionRegistrationRecord[] {
  const slots = usePluginSlots().threadActions;
  const records = [
    ...coreRegistrations.map((registration) => ({
      key: `${CORE_THREAD_ACTION_OWNER}/${registration.id}`,
      instanceKey: `${CORE_THREAD_ACTION_OWNER}/${registration.id}`,
      pluginId: CORE_THREAD_ACTION_OWNER,
      registration,
    })),
    ...slots.map((slot) => ({
      key: `${slot.pluginId}/${slot.id}`,
      instanceKey: `${slot.pluginId}/${slot.id}/${slot.generation}`,
      pluginId: slot.pluginId,
      registration: slot,
    })),
  ];
  return records
    .map((record, index) => ({ record, index }))
    .sort((left, right) =>
      compareThreadActionPlacement(
        left.record.registration,
        left.index,
        right.record.registration,
        right.index,
      ),
    )
    .map(({ record }) => record);
}

export function ThreadActionCollectors({
  coreRegistrations,
  requestRename,
}: {
  coreRegistrations: readonly PluginThreadActionRegistration<unknown>[];
  requestRename: (threadId: string) => void;
}) {
  const records = useThreadActionRecords(coreRegistrations);
  const latestRename = useRef(requestRename);
  useLayoutEffect(() => {
    latestRename.current = requestRename;
  });
  useLayoutEffect(() => {
    publishRecords(records);
  });
  useLayoutEffect(() => {
    setSnapshot({
      ...snapshot,
      requestRename: (threadId) => latestRename.current(threadId),
    });
    return () => {
      setSnapshot({ ...snapshot, requestRename: requestRenameUnavailable });
    };
  }, []);
  return records.map((record) => (
    <PluginContext.Provider key={record.instanceKey} value={record.pluginId}>
      <ThreadActionCollectorBoundary registrationKey={record.key}>
        <ThreadActionCollector record={record} />
      </ThreadActionCollectorBoundary>
    </PluginContext.Provider>
  ));
}

function containRun(
  key: string,
  run: () => void | Promise<void>,
): Promise<void> {
  try {
    return Promise.resolve(run()).catch((error: unknown) => {
      console.error(`thread action "${key}" failed`, error);
    });
  } catch (error) {
    console.error(`thread action "${key}" failed`, error);
    return Promise.resolve();
  }
}

export function bindThreadAction(
  key: string,
  action: PluginThreadAction,
  requestRename: (threadId: string) => void,
): PluginBoundThreadAction {
  return {
    ...action,
    run: (value) =>
      containRun(key, () =>
        action.run({
          ...(value !== undefined ? { value } : {}),
          requestRename,
        }),
      ),
  };
}

export function compareThreadActionPlacement(
  left: { group: string; order?: number },
  leftIndex: number,
  right: { group: string; order?: number },
  rightIndex: number,
): number {
  if (left.group !== right.group) return left.group < right.group ? -1 : 1;
  const leftOrder = left.order ?? Number.POSITIVE_INFINITY;
  const rightOrder = right.order ?? Number.POSITIVE_INFINITY;
  if (leftOrder !== rightOrder) return leftOrder < rightOrder ? -1 : 1;
  return leftIndex - rightIndex;
}

function evaluateRecord(
  record: ThreadActionRegistrationRecord,
  thread: PluginThreadActionTarget,
  registry: ThreadActionRegistrySnapshot,
  requestRename: (threadId: string) => void,
): PluginThreadActionEntry | null {
  const input = registry.collected.get(record.key);
  if (input === undefined) return null;
  try {
    const action = record.registration.item({
      thread,
      data: input.data,
      sdk: input.sdk,
      navigate: input.navigate,
    });
    if (action === null) return null;
    return {
      key: record.key,
      pluginId: record.pluginId,
      group: record.registration.group,
      action: bindThreadAction(record.key, action, requestRename),
    };
  } catch (error) {
    reportFailure(record.key, "item", error);
    return null;
  }
}

function evaluateThreadActions(
  registry: ThreadActionRegistrySnapshot,
  thread: PluginThreadActionTarget,
  options: PluginThreadActionsOptions | undefined,
): PluginThreadActionEntry[] {
  const requestRename = options?.requestRename ?? registry.requestRename;
  const records =
    options?.keys === undefined
      ? registry.records
      : options.keys.flatMap((key) => {
          const record = registry.records.find(
            (candidate) => candidate.key === key,
          );
          return record === undefined ? [] : [record];
        });
  return records.flatMap((record) => {
    const entry = evaluateRecord(record, thread, registry, requestRename);
    return entry === null ? [] : [entry];
  });
}

export function useThreadActionEntries(
  thread: PluginThreadActionTarget,
  options?: PluginThreadActionsOptions,
): readonly PluginThreadActionEntry[] {
  const registry = useSyncExternalStore(subscribe, getSnapshot);
  const surfaceVisible = useContext(ThreadActionSurfaceVisibleContext);
  useEffect(
    () => (surfaceVisible ? retainThreadId(thread.id) : undefined),
    [surfaceVisible, thread.id],
  );
  return evaluateThreadActions(registry, thread, options);
}

export function useDefaultRequestRename(): (threadId: string) => void {
  return useSyncExternalStore(subscribe, getSnapshot).requestRename;
}

export function useThreadActionRegistrationInfos(): readonly PluginThreadActionRegistrationInfo[] {
  const { records } = useSyncExternalStore(subscribe, getSnapshot);
  return records.map((record) => ({
    key: record.key,
    pluginId: record.pluginId,
    title: record.registration.title,
    icon: record.registration.icon,
  }));
}
