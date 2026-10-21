import type { ReadDependency } from "@bb/domain";
import { matchesReadChange, resolveReadChange } from "./policy.js";
export {
  matchesReadChange,
  resolveReadChange,
  mapReadChange,
} from "./policy.js";
import type { ReadChange, ReadChangeReaction } from "@bb/domain";
export type { ReadChange, ReadChangeReaction } from "@bb/domain";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  QueryObserver,
  useQuery,
  useQueryClient,
  type DefaultError,
  type UseQueryOptions,
  useMutation,
  useMutationState,
  replaceEqualDeep,
  type Query,
  type QueryClient,
  type QueryKey,
  type QueryFunctionContext,
} from "@tanstack/react-query";

import { tick } from "./clock.js";
import {
  recordKeyedRead,
  readKeyedBaseEntity,
  registerKeyedView,
  type KeyedCollection,
  type KeyedView,
} from "./keyed-store.js";
import {
  beginOptimisticMutation,
  subscribeOptimisticQuery,
  getLiveReadData,
  markLiveQueryMeta,
  commitLiveReadReceipt,
  liveStructuralSharing,
  type OptimisticUpdate,
} from "./optimistic.js";
export {
  beginOptimisticMutation,
  optimisticKeyedUpdate,
  optimisticQueryUpdate,
  type KeyedOptimisticUpdate,
  type OptimisticUpdate,
  type LiveQueryOptimisticUpdate,
} from "./optimistic.js";
export {
  KeyedCollection,
  insertKeyedEntry,
  keyedEntities,
  readKeyedEntity,
  registerKeyedViews,
  writeKeyedEntity,
  type KeyedView,
  type KeyedViewSlot,
} from "./keyed-store.js";

export function useLiveQuery<
  QueryData = unknown,
  Error = DefaultError,
  Data = QueryData,
  Key extends QueryKey = QueryKey,
>(options: UseQueryOptions<QueryData, Error, Data, Key>, client?: QueryClient) {
  const queryClient = useQueryClient(client);
  const result = useQuery(options, queryClient);
  const query = queryClient
    .getQueryCache()
    .get(queryClient.defaultQueryOptions(options).queryHash);
  const subscribed = options.subscribed !== false;
  const subscribe = useCallback(
    (listener: () => void) =>
      subscribed ? subscribeOptimisticQuery(query, listener) : () => {},
    [query, subscribed],
  );
  const snapshot = useCallback(() => query?.state.data, [query]);
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return result;
}

export const CORE_CHANGE_SCOPE = "core";

export interface LiveQueryRegistration<Data> {
  scope: string;
  read?: (context: QueryFunctionContext) => Promise<Data>;
  dependenciesOf: (
    data: Data | undefined,
    client: QueryClient,
  ) => readonly ReadDependency[] | undefined;
  reactToChange?: (
    data: Data | undefined,
    change: ReadChange,
  ) => ReadChangeReaction<Data>;
  onReload?(
    data: Data | undefined,
    change: ReadChange | null,
    keys?: readonly string[],
  ): void;
}

export interface LiveMutationOutcome<Result> {
  result: Result;
  changes: readonly ReadChange[];
}

const registrations = new WeakMap<object, LiveQueryRegistration<unknown>>();
const reads = new WeakMap<
  object,
  { changes: ReadChange[]; restart: boolean }
>();

export function liveQueryMeta<Data>(registration: LiveQueryRegistration<Data>) {
  const { read } = registration;
  const meta = {};
  markLiveQueryMeta(meta);
  registrations.set(meta, registration as LiveQueryRegistration<unknown>);
  return {
    meta,
    ...(read && {
      queryFn: (context: QueryFunctionContext) =>
        runLiveRead(context.client, context.queryKey, () => read(context)),
    }),
  };
}

export function liveQueryOptions<Data>(
  client: QueryClient,
  queryKey: QueryKey,
  registration: LiveQueryRegistration<Data>,
) {
  return {
    ...liveQueryMeta(registration),
    structuralSharing: (previous: unknown, next: unknown) =>
      liveStructuralSharing(client, queryKey, previous, next),
  };
}

function registrationOf(query: Query) {
  return query.meta === undefined ? undefined : registrations.get(query.meta);
}

export async function runLiveRead<Data>(
  client: QueryClient,
  queryKey: QueryKey,
  read: () => Promise<Data>,
): Promise<Data> {
  const query = client
    .getQueryCache()
    .get(client.defaultQueryOptions({ queryKey }).queryHash);
  if (query === undefined) return read();
  const registration = registrationOf(query);
  for (;;) {
    const pending = { changes: [] as ReadChange[], restart: false };
    reads.set(query, pending);
    const started = tick();
    try {
      const result = await read();
      if (
        pending.restart ||
        pending.changes.some(
          (change) =>
            registration &&
            resolveReadChange(
              result,
              registration.dependenciesOf(result, client) ?? [],
              change,
              registration.reactToChange,
            ),
        )
      )
        continue;
      commitLiveReadReceipt(query, result, started);
      return result;
    } catch (error) {
      if (pending.restart) continue;
      throw error;
    } finally {
      if (reads.get(query) === pending) reads.delete(query);
    }
  }
}

export async function refreshLiveQueries(
  client: QueryClient,
  scope: string,
): Promise<void> {
  return applyQueryChange(client, scope, null);
}

export async function applyQueryChanges(
  client: QueryClient,
  scope: string,
  changes: readonly ReadChange[],
) {
  await Promise.all(
    changes.map((change) => applyQueryChange(client, scope, change)),
  );
}

export async function applyQueryChange(
  client: QueryClient,
  scope: string,
  change: ReadChange | null,
): Promise<void> {
  const reload = new Set<Query>();
  const waiting: Promise<unknown>[] = [];
  for (const query of client.getQueryCache().getAll()) {
    const registration = registrationOf(query);
    const own = registration?.scope === scope ? registration : undefined;
    const react = own?.reactToChange;
    if (!own) continue;
    if (change) reads.get(query)?.changes.push(change);
    const data = getLiveReadData(client, query.queryKey);
    const dependencies = own?.dependenciesOf(data, client);
    let reaction =
      change === null
        ? { action: "reload" as const }
        : resolveReadChange(data, dependencies ?? [], change, react);
    if (
      !reaction &&
      data === undefined &&
      dependencies === undefined &&
      !reads.has(query)
    )
      reaction = { action: "reload" };
    if (!reaction) continue;
    if (reaction.action === "patch" && data !== undefined) {
      const next = reaction.data;
      client.setQueryData(query.queryKey, () => next, {
        updatedAt: query.state.dataUpdatedAt,
      });
      if (query.state.fetchStatus !== "fetching") continue;
    }
    own?.onReload?.(
      data,
      change,
      reaction.action === "reload" ? reaction.keys : undefined,
    );
    const pending = reads.get(query);
    if (pending) {
      pending.restart = true;
      if (query.isActive() && query.promise) waiting.push(query.promise);
    } else if (query.state.fetchStatus === "fetching" && query.promise) {
      const refresh = () =>
        client.invalidateQueries(
          { predicate: (candidate) => candidate === query },
          { cancelRefetch: false },
        );
      waiting.push(query.promise.then(refresh, refresh));
    }
    reload.add(query);
  }
  await Promise.allSettled([
    client.invalidateQueries(
      { predicate: (query) => reload.has(query) },
      { cancelRefetch: false },
    ),
    ...waiting,
  ]);
}

export interface LiveMutationOptions {
  client: QueryClient;
  optimistic: readonly OptimisticUpdate[];
}

async function executeLiveMutation<Result>(
  publish: ((changes: readonly ReadChange[]) => Promise<void>) | undefined,
  call: () => Promise<LiveMutationOutcome<Result>>,
  prediction: ReturnType<typeof beginOptimisticMutation> | undefined,
): Promise<Result> {
  const { result, changes } = await call();
  prediction?.accept(result);
  const refresh = async () => {
    try {
      if (publish !== undefined && changes.length > 0) await publish(changes);
    } finally {
      prediction?.settle();
    }
  };
  void refresh().catch(() => {});
  return result;
}

export async function runLiveMutation<Result>(
  publish: (changes: readonly ReadChange[]) => Promise<void>,
  call: () => Promise<LiveMutationOutcome<Result>>,
  options?: LiveMutationOptions,
): Promise<Result> {
  const prediction =
    options && beginOptimisticMutation(options.client, options.optimistic);
  try {
    return await executeLiveMutation(publish, call, prediction);
  } catch (error) {
    prediction?.rollback();
    throw error;
  }
}

export const pluginChangeScope = (pluginId: string): string =>
  `plugin:${pluginId}`;

export function restartLiveRead(query: object): void {
  const pending = reads.get(query);
  if (pending) pending.restart = true;
}

export interface UseLiveMutationOptions<Input, Result> {
  client: QueryClient;
  publish?(changes: readonly ReadChange[]): Promise<void>;
  call(input: Input): Promise<LiveMutationOutcome<Result>>;
  optimistic?(input: Input): readonly OptimisticUpdate[];
  meta?: Record<string, unknown>;
}

export function useLiveMutation<Input, Result>({
  client,
  publish,
  call,
  optimistic,
  meta,
}: UseLiveMutationOptions<Input, Result>) {
  const [owner] = useState(() => ({}));
  const predict = useRef(optimistic);
  useEffect(() => {
    predict.current = optimistic;
  }, [optimistic]);
  type Variables = {
    input: Input;
    prediction: ReturnType<typeof beginOptimisticMutation>;
  };
  const mutation = useMutation<Result, Error, Variables>(
    {
      meta: { ...meta, liveMutationOwner: owner },
      mutationFn: ({ input, prediction }) =>
        executeLiveMutation(publish, () => call(input), prediction),
    },
    client,
  );
  const pendingInputs = useMutationState(
    {
      filters: {
        status: "pending",
        predicate: (entry) => entry.options.meta?.liveMutationOwner === owner,
      },
      select: (entry) => (entry.state.variables as Variables).input,
    },
    client,
  );
  const { mutateAsync } = mutation;
  const mutate = useCallback(
    (input: Input) => {
      const prediction = beginOptimisticMutation(
        client,
        predict.current?.(input) ?? [],
      );
      return mutateAsync({ input, prediction }).catch((error: unknown) => {
        prediction.rollback();
        throw error;
      });
    },
    [client, mutateAsync],
  );
  return {
    mutate,
    pendingInputs,
    isPending: pendingInputs.length > 0,
    error: mutation.error,
    reset: mutation.reset,
  };
}

type KeyedData<Value> = {
  result: Record<string, Value>;
  dependencies: ReadDependency[];
  keyDependencies: Record<string, ReadDependency[]>;
};

function hasRows(data: unknown): data is { result: object } {
  return (
    typeof data === "object" &&
    data !== null &&
    "result" in data &&
    typeof data.result === "object" &&
    data.result !== null
  );
}

const rowKey = (item: unknown) =>
  Array.isArray(item) && typeof item[0] === "string" ? item[0] : undefined;
const rowValue = (item: unknown): unknown =>
  Array.isArray(item) ? item[1] : undefined;

function keyedRowsView(
  collection: KeyedCollection<unknown>,
): KeyedView<unknown> {
  return {
    collection,
    slots: (data) =>
      hasRows(data)
        ? [{ key: "result", items: Object.entries(data.result) }]
        : undefined,
    rebuild: (data, items) =>
      hasRows(data)
        ? {
            ...data,
            result: Object.fromEntries(
              (items.get("result") ?? []).flatMap((item) => {
                const key = rowKey(item);
                return key === undefined ? [] : [[key, rowValue(item)]];
              }),
            ),
          }
        : data,
    keyOf: rowKey,
    read: (item, current, fresh) =>
      current === undefined || fresh ? rowValue(item) : current,
    write: rowValue,
    render: (item, entity) =>
      Object.is(rowValue(item), entity) ? item : [rowKey(item), entity],
  };
}

export function createLiveKeyedQueryOwner<Value>(options: {
  client: QueryClient;
  queryKey: QueryKey;
  scope: string;
  collection: KeyedCollection<Value>;
  read(keys: readonly string[]): Promise<KeyedData<Value>>;
  reactToChange?(
    data: KeyedData<Value> | undefined,
    change: ReadChange,
    keys: readonly string[],
  ): ReadChangeReaction<KeyedData<Value>>;
}) {
  const { client, queryKey, scope, collection, read } = options;
  registerKeyedView(client, queryKey, keyedRowsView(collection));
  const keys = new Map<string, number>();
  let readingKeys = new Set<string>();
  let missingOnly = false;
  let refreshAll = false;
  const dirtyKeys = new Set<string>();
  const collectSubscribedKeys = () =>
    new Promise<string[]>((resolve) => {
      queueMicrotask(() => resolve([...keys.keys()]));
    });
  const observer = new QueryObserver<KeyedData<Value>>(client, {
    queryKey,
    ...liveQueryOptions(client, queryKey, {
      scope,
      reactToChange: (data, change) =>
        options.reactToChange?.(
          data && {
            ...data,
            result: Object.fromEntries(
              Object.keys(data.result).flatMap((key) => {
                const value = readKeyedBaseEntity(client, collection, key);
                return value === undefined ? [] : [[key, value]];
              }),
            ),
          },
          change,
          [...keys.keys()],
        ),
      dependenciesOf: (data: KeyedData<Value> | undefined) =>
        data && [
          ...data.dependencies,
          ...Object.values(data.keyDependencies).flat(),
        ],
      onReload: (data, change, requestedKeys) => {
        if (
          change === null ||
          data === undefined ||
          (requestedKeys === undefined &&
            data.dependencies.some((dependency) =>
              matchesReadChange(dependency, change),
            ))
        )
          refreshAll = true;
        else {
          for (const key of requestedKeys ?? []) dirtyKeys.add(key);
          for (const [key, dependencies] of Object.entries(
            data.keyDependencies,
          ))
            if (
              dependencies.some((dependency) =>
                matchesReadChange(dependency, change),
              )
            )
              dirtyKeys.add(key);
        }
      },
    }),
    queryFn: () => {
      let previous = getLiveReadData<KeyedData<Value>>(client, queryKey);
      const startedAt = new Map<string, number>();
      let refresh = !missingOnly && dirtyKeys.size === 0;
      missingOnly = false;
      const refreshedKeys = new Set<string>();
      let refreshedAll = false;
      return runLiveRead(client, queryKey, async () => {
        const subscribed = await collectSubscribedKeys();
        const all = refreshAll || refresh;
        refresh = false;
        const dirty = new Set(dirtyKeys);
        for (const key of dirty) refreshedKeys.add(key);
        refreshedAll ||= all;
        dirtyKeys.clear();
        refreshAll = false;
        const requested = subscribed.filter(
          (key) =>
            all ||
            dirty.has(key) ||
            !Object.hasOwn(previous?.result ?? {}, key),
        );
        readingKeys = new Set(requested);
        const started = tick();
        try {
          const results = await Promise.all(
            Array.from(
              { length: Math.ceil(requested.length / 200) },
              async (_, i) => {
                const batch = requested.slice(i * 200, (i + 1) * 200);
                const response = await read(batch);
                for (const key of batch)
                  if (!Object.hasOwn(response.result, key))
                    throw new Error(`Keyed read omitted key ${key}`);
                return response;
              },
            ),
          );
          const retained = (key: string) =>
            !all && !dirty.has(key) && !readingKeys.has(key);
          for (const key of requested) startedAt.set(key, started);
          previous = {
            result: Object.fromEntries([
              ...Object.entries(previous?.result ?? {}).filter(([key]) =>
                retained(key),
              ),
              ...results.flatMap((response) => Object.entries(response.result)),
            ]),
            dependencies: [
              ...new Map(
                [
                  ...(all ? [] : (previous?.dependencies ?? [])),
                  ...results.flatMap((r) => r.dependencies),
                ].map((dependency) => [JSON.stringify(dependency), dependency]),
              ).values(),
            ],
            keyDependencies: Object.fromEntries([
              ...Object.entries(previous?.keyDependencies ?? {}).filter(
                ([key]) => retained(key),
              ),
              ...results.flatMap((response) =>
                Object.entries(response.keyDependencies),
              ),
            ]),
          };
          return previous;
        } catch (error) {
          for (const key of refreshedKeys) dirtyKeys.add(key);
          refreshAll ||= refreshedAll;
          throw error;
        }
      }).then((data) => {
        recordKeyedRead(client, queryKey, startedAt);
        return data;
      });
    },
  });
  const listeners = new Set<() => void>();
  let stop: (() => void) | undefined;
  return {
    observer,
    subscribe(requested: readonly string[], listener: () => void) {
      let added = false;
      for (const key of requested) {
        if (!keys.has(key)) added = true;
        keys.set(key, (keys.get(key) ?? 0) + 1);
      }
      const cached = getLiveReadData<KeyedData<Value>>(client, queryKey);
      const missing = requested.filter(
        (key) => !Object.hasOwn(cached?.result ?? {}, key),
      );
      if (!stop) missingOnly = cached === undefined;
      listeners.add(listener);
      if (!stop) {
        stop = observer.subscribe(() => {
          for (const notify of listeners) notify();
        });
      }
      if (added && missing.length > 0) {
        if (observer.getCurrentResult().isFetching) {
          if (
            readingKeys.size > 0 &&
            missing.some((key) => !readingKeys.has(key))
          )
            restartLiveRead(observer.getCurrentQuery());
        } else {
          missingOnly = true;
          void observer.refetch({ cancelRefetch: false });
        }
      }
      return () => {
        listeners.delete(listener);
        for (const key of requested) {
          const count = (keys.get(key) ?? 1) - 1;
          if (count > 0) keys.set(key, count);
          else keys.delete(key);
        }
        queueMicrotask(() => {
          if (listeners.size === 0) {
            stop?.();
            stop = undefined;
          }
        });
      };
    },
  };
}

export function useQuerySelection<Snapshot, Selection>(
  subscribe: (listener: () => void) => () => void,
  getSnapshot: () => Snapshot,
  select: (snapshot: Snapshot) => Selection,
): Selection {
  const committed = useRef<{ value: Selection } | null>(null);
  const getSelection = useMemo(() => {
    let cached: { snapshot: Snapshot; value: Selection } | undefined;
    return () => {
      const snapshot = getSnapshot();
      if (cached && Object.is(cached.snapshot, snapshot)) return cached.value;
      cached = {
        snapshot,
        value: replaceEqualDeep(
          cached?.value ?? committed.current?.value,
          select(snapshot),
        ),
      };
      return cached.value;
    };
  }, [getSnapshot, select]);
  const value = useSyncExternalStore(subscribe, getSelection, getSelection);
  useEffect(() => {
    committed.current = { value };
  }, [value]);
  return value;
}
