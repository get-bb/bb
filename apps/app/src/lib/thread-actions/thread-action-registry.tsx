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
  ExperimentalPanelController,
  PluginBoundThreadAction,
  PluginBrowserBbSdk,
  PluginThreadAction,
  PluginThreadActionEntry,
  PluginThreadActionPlacement,
  PluginThreadActionRegistration,
  PluginThreadActionRegistrationInfo,
  PluginThreadActionTarget,
  PluginThreadActionsOptions,
} from "@get-bb/plugin-sdk";
import { PluginContext } from "@/components/plugin/plugin-context";
import { getFocusedAppPanelController } from "@/lib/app-fixed-tab-navigation";
import {
  createPluginPanelController,
  createRetiredOpenPanel,
} from "@/lib/plugin-panel-controller";
import { useBbNavigate, useSdk } from "@/lib/plugin-navigation-hooks";
import { compareGroupedPlacement } from "@/lib/grouped-placement";
import { usePluginSlots } from "@/lib/plugin-slots";

export const CORE_THREAD_ACTION_OWNER = "bb--core";

export interface ThreadActionRegistrationRecord {
  key: string;
  instanceKey: string;
  pluginId: string;
  placement: PluginThreadActionPlacement;
  registration: PluginThreadActionRegistration<unknown>;
}

interface CollectedThreadAction {
  data: unknown;
  sdk: PluginBrowserBbSdk;
  navigate: BbNavigate;
  panel: ExperimentalPanelController;
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
    current.navigate === value.navigate &&
    current.panel === value.panel
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

type SubscribedThreadIds = Readonly<
  Record<PluginThreadActionPlacement, readonly string[]>
>;

const subscribedThreadCounts: Record<
  PluginThreadActionPlacement,
  Map<string, number>
> = { menu: new Map(), header: new Map() };
const NO_SUBSCRIBED_THREAD_IDS: SubscribedThreadIds = { menu: [], header: [] };
let subscribedThreadIds = NO_SUBSCRIBED_THREAD_IDS;
const threadIdListeners = new Set<() => void>();

function subscribeThreadIds(listener: () => void): () => void {
  threadIdListeners.add(listener);
  return () => {
    threadIdListeners.delete(listener);
  };
}

function getSubscribedThreadIds(): SubscribedThreadIds {
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
  const settle = (placement: PluginThreadActionPlacement) => {
    const current = subscribedThreadIds[placement];
    const next = [...subscribedThreadCounts[placement].keys()].sort();
    return next.length === current.length &&
      next.every((id, index) => id === current[index])
      ? current
      : next;
  };
  const next = { menu: settle("menu"), header: settle("header") };
  if (
    next.menu === subscribedThreadIds.menu &&
    next.header === subscribedThreadIds.header
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

function retainThreadId(
  threadId: string,
  placement: PluginThreadActionPlacement,
): () => void {
  const counts = subscribedThreadCounts[placement];
  counts.set(threadId, (counts.get(threadId) ?? 0) + 1);
  scheduleSubscribedThreadIdsFlush();
  return () => {
    const count = counts.get(threadId) ?? 0;
    if (count <= 1) counts.delete(threadId);
    else counts.set(threadId, count - 1);
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
  subscribedThreadCounts.menu.clear();
  subscribedThreadCounts.header.clear();
  subscribedThreadIds = NO_SUBSCRIBED_THREAD_IDS;
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

function useLatestNavigate(
  navigate: BbNavigate,
  panel: ExperimentalPanelController,
): BbNavigate {
  const latest = useRef(navigate);
  useLayoutEffect(() => {
    latest.current = navigate;
  });
  const [stable] = useState<
    BbNavigate & { openThreadPanel: ReturnType<typeof createRetiredOpenPanel> }
  >(() => ({
    toThread: (...args) => latest.current.toThread(...args),
    toProject: (...args) => latest.current.toProject(...args),
    toPluginPanel: (...args) => latest.current.toPluginPanel(...args),
    toCompose: (...args) => latest.current.toCompose(...args),
    openThreadPanel: createRetiredOpenPanel(panel),
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
  )[record.placement];
  const data = record.registration.useData?.({ threadIds });
  const sdk = useSdk();
  const [panel] = useState(() =>
    createPluginPanelController(record.pluginId, getFocusedAppPanelController),
  );
  const navigate = useLatestNavigate(useBbNavigate(), panel);
  useLayoutEffect(() => {
    publishCollected(record.key, { data, sdk, navigate, panel });
  }, [data, navigate, panel, record.key, sdk]);
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
      compareGroupedPlacement(
        left.record.registration,
        left.index,
        right.record.registration,
        right.index,
      ),
    )
    .map(({ record }) => ({
      ...record,
      placement: record.registration.placement ?? "menu",
    }));
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

function evaluateRecord(
  record: ThreadActionRegistrationRecord,
  target: ThreadActionEvaluationTarget,
  registry: ThreadActionRegistrySnapshot,
  requestRename: (threadId: string) => void,
): PluginThreadActionEntry | null {
  const input = registry.collected.get(record.key);
  if (input === undefined) return null;
  const { registration } = record;
  try {
    const action =
      target.kind === "thread"
        ? registration.item({
            thread: target.thread,
            data: input.data,
            sdk: input.sdk,
            navigate: input.navigate,
            experimental_panel: input.panel,
          })
        : (registration.experimental_bulkItem?.({
            threads: target.threads,
            data: input.data,
            sdk: input.sdk,
            navigate: input.navigate,
            experimental_panel: input.panel,
          }) ?? null);
    if (action === null) return null;
    return {
      key: record.key,
      pluginId: record.pluginId,
      group: record.registration.group,
      action: bindThreadAction(record.key, action, requestRename),
    };
  } catch (error) {
    reportFailure(
      record.key,
      target.kind === "thread" ? "item" : "experimental_bulkItem",
      error,
    );
    return null;
  }
}

type ThreadActionEvaluationTarget =
  | { kind: "thread"; thread: PluginThreadActionTarget }
  | { kind: "bulk"; threads: readonly PluginThreadActionTarget[] };

function hasPlacement(
  record: ThreadActionRegistrationRecord,
  placement: PluginThreadActionPlacement,
): boolean {
  return record.placement === placement;
}

function evaluateThreadActions(
  registry: ThreadActionRegistrySnapshot,
  target: ThreadActionEvaluationTarget,
  options: PluginThreadActionsOptions | undefined,
  placement: PluginThreadActionPlacement,
): PluginThreadActionEntry[] {
  const requestRename = options?.requestRename ?? registry.requestRename;
  const placed = registry.records.filter((record) =>
    hasPlacement(record, placement),
  );
  const records =
    options?.keys === undefined
      ? placed
      : options.keys.flatMap((key) => {
          const record = placed.find((candidate) => candidate.key === key);
          return record === undefined ? [] : [record];
        });
  return records.flatMap((record) => {
    const entry = evaluateRecord(record, target, registry, requestRename);
    return entry === null ? [] : [entry];
  });
}

function useRetainedThreadRegistry(
  threadId: string,
  placement: PluginThreadActionPlacement,
): ThreadActionRegistrySnapshot {
  const registry = useSyncExternalStore(subscribe, getSnapshot);
  const surfaceVisible = useContext(ThreadActionSurfaceVisibleContext);
  useEffect(
    () => (surfaceVisible ? retainThreadId(threadId, placement) : undefined),
    [placement, surfaceVisible, threadId],
  );
  return registry;
}

export function useThreadActionEntries(
  thread: PluginThreadActionTarget,
  options?: PluginThreadActionsOptions,
): readonly PluginThreadActionEntry[] {
  const registry = useRetainedThreadRegistry(thread.id, "menu");
  return evaluateThreadActions(
    registry,
    { kind: "thread", thread },
    options,
    "menu",
  );
}

export function useThreadHeaderActionEntries(
  thread: PluginThreadActionTarget,
): readonly PluginThreadActionEntry[] {
  const registry = useRetainedThreadRegistry(thread.id, "header");
  return evaluateThreadActions(
    registry,
    { kind: "thread", thread },
    undefined,
    "header",
  ).filter((entry) => entry.action.choices === undefined);
}

export function useThreadBulkActionEntries(
  threads: readonly PluginThreadActionTarget[],
): readonly PluginThreadActionEntry[] {
  const registry = useSyncExternalStore(subscribe, getSnapshot);
  const surfaceVisible = useContext(ThreadActionSurfaceVisibleContext);
  const threadIdsKey = threads.map((thread) => thread.id).join("\n");
  useEffect(() => {
    if (!surfaceVisible || threadIdsKey === "") return undefined;
    const releases = threadIdsKey
      .split("\n")
      .map((threadId) => retainThreadId(threadId, "menu"));
    return () => {
      for (const release of releases) release();
    };
  }, [surfaceVisible, threadIdsKey]);
  return evaluateThreadActions(
    registry,
    { kind: "bulk", threads },
    undefined,
    "menu",
  );
}

export function useDefaultRequestRename(): (threadId: string) => void {
  return useSyncExternalStore(subscribe, getSnapshot).requestRename;
}

export function useThreadActionRegistrationInfos(): readonly PluginThreadActionRegistrationInfo[] {
  const { records } = useSyncExternalStore(subscribe, getSnapshot);
  return records
    .filter((record) => hasPlacement(record, "menu"))
    .map((record) => ({
      key: record.key,
      pluginId: record.pluginId,
      title: record.registration.title,
      icon: record.registration.icon,
    }));
}
