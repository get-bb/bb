import {
  Component,
  useLayoutEffect,
  useRef,
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
import { useBbNavigate, useSdk } from "@/lib/plugin-sdk-hooks";
import { usePluginSlots } from "@/lib/plugin-slots";

export const CORE_THREAD_ACTION_OWNER = "core";

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

export function resetThreadActionRegistryForTest(): void {
  reportedFailures.clear();
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

function useLatestNavigate(navigate: BbNavigate): BbNavigate {
  const latest = useRef(navigate);
  useLayoutEffect(() => {
    latest.current = navigate;
  });
  const stable = useRef<BbNavigate | null>(null);
  if (stable.current === null) {
    stable.current = {
      toThread: (...args) => latest.current.toThread(...args),
      toProject: (...args) => latest.current.toProject(...args),
      toPluginPanel: (...args) => latest.current.toPluginPanel(...args),
      toCompose: (...args) => latest.current.toCompose(...args),
      openThreadPanel: (...args) => latest.current.openThreadPanel(...args),
      openUrl: (...args) => latest.current.openUrl(...args),
      experimental_openFilePreview: (...args) =>
        latest.current.experimental_openFilePreview(...args),
      experimental_openFileExternally: (...args) =>
        latest.current.experimental_openFileExternally(...args),
      experimental_openTerminal: (...args) =>
        latest.current.experimental_openTerminal(...args),
    };
  }
  return stable.current;
}

function ThreadActionCollector({
  record,
}: {
  record: ThreadActionRegistrationRecord;
}) {
  const data = record.registration.useData?.();
  const sdk = useSdk();
  const navigate = useLatestNavigate(useBbNavigate());
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
  return [
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

interface EvaluatedThreadAction {
  key: string;
  pluginId: string;
  action: PluginThreadAction;
  index: number;
}

function evaluateRecord(
  record: ThreadActionRegistrationRecord,
  index: number,
  thread: PluginThreadActionTarget,
  collected: ReadonlyMap<string, CollectedThreadAction>,
): EvaluatedThreadAction | null {
  const input = collected.get(record.key);
  if (input === undefined) return null;
  try {
    const action = record.registration.item({
      thread,
      data: input.data,
      sdk: input.sdk,
      navigate: input.navigate,
    });
    if (action === null) return null;
    return { key: record.key, pluginId: record.pluginId, action, index };
  } catch (error) {
    reportFailure(record.key, "item", error);
    return null;
  }
}

export function compareThreadActions(
  left: { action: PluginThreadAction; index: number },
  right: { action: PluginThreadAction; index: number },
): number {
  if (left.action.group !== right.action.group) {
    return left.action.group < right.action.group ? -1 : 1;
  }
  const leftOrder = left.action.order ?? Number.POSITIVE_INFINITY;
  const rightOrder = right.action.order ?? Number.POSITIVE_INFINITY;
  if (leftOrder !== rightOrder) return leftOrder < rightOrder ? -1 : 1;
  return left.index - right.index;
}

function evaluateThreadActions(
  registry: ThreadActionRegistrySnapshot,
  thread: PluginThreadActionTarget,
  options: PluginThreadActionsOptions | undefined,
): PluginThreadActionEntry[] {
  const requestRename = options?.requestRename ?? registry.requestRename;
  const keys = options?.keys;
  const evaluated =
    keys === undefined
      ? registry.records
          .map((record, index) =>
            evaluateRecord(record, index, thread, registry.collected),
          )
          .filter((entry) => entry !== null)
          .sort(compareThreadActions)
      : keys.flatMap((key) => {
          const index = registry.records.findIndex(
            (record) => record.key === key,
          );
          const record = registry.records[index];
          if (record === undefined) return [];
          const entry = evaluateRecord(
            record,
            index,
            thread,
            registry.collected,
          );
          return entry === null ? [] : [entry];
        });
  return evaluated.map((entry) => ({
    key: entry.key,
    pluginId: entry.pluginId,
    action: bindThreadAction(entry.key, entry.action, requestRename),
  }));
}

export function useThreadActionEntries(
  thread: PluginThreadActionTarget,
  options?: PluginThreadActionsOptions,
): readonly PluginThreadActionEntry[] {
  const registry = useSyncExternalStore(subscribe, getSnapshot);
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
