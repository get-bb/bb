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
  useMutation,
  useMutationState,
  replaceEqualDeep,
  type Query,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import {
  beginOptimisticMutation,
  getTaggedReadData,
  taggedReadReceipt,
  taggedStructuralSharing,
  type TaggedOptimisticUpdate,
} from "./optimistic.js";
export {
  optimisticQueryUpdate,
  type TaggedOptimisticUpdate,
} from "./optimistic.js";

export const CORE_TAG_SCOPE = "core";

export interface TaggedQueryRegistration<Data> {
  scope: string;
  tagsOf(data: Data): readonly string[];
  onInvalidate?(data: Data | undefined, tags: readonly string[] | null): void;
}

export interface TaggedMutationOutcome<Result> {
  result: Result;
  invalidated: readonly string[];
}

const registrations = new WeakMap<object, TaggedQueryRegistration<unknown>>();
const reads = new WeakMap<object, { tags: Set<string>; restart: boolean }>();

export function taggedQueryOptions<Data>(
  client: QueryClient,
  queryKey: QueryKey,
  registration: TaggedQueryRegistration<Data>,
) {
  const meta = {};
  registrations.set(meta, {
    scope: registration.scope,
    tagsOf: (data) => registration.tagsOf(data as Data),
    onInvalidate: (data, tags) =>
      registration.onInvalidate?.(data as Data | undefined, tags),
  });
  return {
    meta,
    structuralSharing: (previous: unknown, next: unknown) =>
      taggedStructuralSharing(client, queryKey, previous, next),
  };
}

function registrationOf(query: Query) {
  return query.meta === undefined ? undefined : registrations.get(query.meta);
}

export async function runTaggedRead<Data>(
  client: QueryClient,
  queryKey: QueryKey,
  read: () => Promise<Data>,
  paths: () => readonly (readonly string[])[] = () => [[]],
): Promise<Data> {
  const query = client
    .getQueryCache()
    .get(client.defaultQueryOptions({ queryKey }).queryHash);
  if (query === undefined) return read();
  const registration = registrationOf(query);
  const receipt = taggedReadReceipt(query);
  for (;;) {
    const pending = { tags: new Set<string>(), restart: false };
    reads.set(query, pending);
    const started = receipt.start();
    try {
      const result = await read();
      receipt.record(started, paths());
      const overlap = registration
        ?.tagsOf(result)
        .some((tag) => pending.tags.has(tag));
      if (overlap) registration?.onInvalidate?.(result, [...pending.tags]);
      if (pending.restart || overlap) continue;
      receipt.commit(result);
      return result;
    } catch (error) {
      if (pending.restart) continue;
      throw error;
    } finally {
      if (reads.get(query) === pending) reads.delete(query);
    }
  }
}

export async function invalidateTags(
  client: QueryClient,
  scope: string,
  tags: readonly string[] | null,
): Promise<void> {
  if (tags?.length === 0) return;
  const matched = new Set<Query>();
  const pendingReads: Promise<unknown>[] = [];
  for (const query of client.getQueryCache().getAll()) {
    const registration = registrationOf(query);
    if (registration?.scope !== scope) continue;
    const pending = reads.get(query);
    const data = getTaggedReadData(client, query.queryKey);
    const matches =
      tags === null ||
      (data === undefined && pending === undefined) ||
      (data !== undefined &&
        registration.tagsOf(data).some((tag) => tags.includes(tag)));
    if (matches) registration.onInvalidate?.(data, tags);
    if (pending !== undefined) {
      if (matches) pending.restart = true;
      else for (const tag of tags ?? []) pending.tags.add(tag);
      if (query.isActive() && query.promise !== undefined)
        pendingReads.push(query.promise);
    }
    if (matches) {
      matched.add(query);
      if (
        pending === undefined &&
        query.isActive() &&
        query.state.fetchStatus === "fetching" &&
        query.promise !== undefined
      ) {
        const refetch = () =>
          client.invalidateQueries(
            { predicate: (candidate) => candidate === query },
            { cancelRefetch: false },
          );
        pendingReads.push(query.promise.then(refetch, refetch));
      }
    }
  }
  await Promise.allSettled([
    client.invalidateQueries(
      { predicate: (query) => matched.has(query) },
      { cancelRefetch: false },
    ),
    ...pendingReads,
  ]);
}

export interface TaggedMutationOptions {
  client: QueryClient;
  optimistic: readonly TaggedOptimisticUpdate[];
}

async function executeTaggedMutation<Result>(
  invalidate: (tags: readonly string[]) => Promise<void>,
  call: () => Promise<TaggedMutationOutcome<Result>>,
  prediction: ReturnType<typeof beginOptimisticMutation> | undefined,
): Promise<Result> {
  const { result, invalidated } = await call();
  prediction?.accept();
  try {
    if (invalidated.length > 0) await invalidate(invalidated);
  } finally {
    prediction?.settle();
  }
  return result;
}

export async function runTaggedMutation<Result>(
  invalidate: (tags: readonly string[]) => Promise<void>,
  call: () => Promise<TaggedMutationOutcome<Result>>,
  options?: TaggedMutationOptions,
): Promise<Result> {
  const prediction =
    options && beginOptimisticMutation(options.client, options.optimistic);
  try {
    return await executeTaggedMutation(invalidate, call, prediction);
  } catch (error) {
    prediction?.rollback();
    throw error;
  }
}

export const pluginTagScope = (pluginId: string): string =>
  `plugin:${pluginId}`;

export function restartTaggedRead(query: object): void {
  const pending = reads.get(query);
  if (pending) pending.restart = true;
}

export function useTaggedMutation<Input, Result>(
  client: QueryClient,
  invalidate: (tags: readonly string[]) => Promise<void>,
  call: (input: Input) => Promise<TaggedMutationOutcome<Result>>,
  optimistic?: (input: Input) => readonly TaggedOptimisticUpdate[],
) {
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
      meta: { taggedMutationOwner: owner },
      mutationFn: ({ input, prediction }) =>
        executeTaggedMutation(invalidate, () => call(input), prediction),
    },
    client,
  );
  const pendingInputs = useMutationState(
    {
      filters: {
        status: "pending",
        predicate: (entry) => entry.options.meta?.taggedMutationOwner === owner,
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
  tags: string[];
  keyTags: Record<string, string[]>;
};

export function createTaggedKeyedQueryOwner<Value>(options: {
  client: QueryClient;
  queryKey: QueryKey;
  scope: string;
  read(keys: readonly string[]): Promise<KeyedData<Value>>;
}) {
  const { client, queryKey, scope, read } = options;
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
    ...taggedQueryOptions(client, queryKey, {
      scope,
      tagsOf: (data: KeyedData<Value>) => [
        ...data.tags,
        ...Object.values(data.keyTags).flat(),
      ],
      onInvalidate: (data, tags) => {
        if (
          tags === null ||
          data === undefined ||
          data.tags.some((tag) => tags.includes(tag))
        ) {
          refreshAll = true;
        } else {
          for (const [key, ownTags] of Object.entries(data.keyTags))
            if (ownTags.some((tag) => tags.includes(tag))) dirtyKeys.add(key);
        }
      },
    }),
    queryFn: () => {
      let previous = getTaggedReadData<KeyedData<Value>>(client, queryKey);
      let loaded: readonly string[] = [];
      let refresh = !missingOnly && dirtyKeys.size === 0;
      missingOnly = false;
      const refreshedKeys = new Set<string>();
      let refreshedAll = false;
      return runTaggedRead(
        client,
        queryKey,
        async () => {
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
            loaded = requested;
            previous = {
              result: Object.fromEntries([
                ...Object.entries(previous?.result ?? {}).filter(([key]) =>
                  retained(key),
                ),
                ...results.flatMap((response) =>
                  Object.entries(response.result),
                ),
              ]),
              tags: [
                ...new Set([
                  ...(all ? [] : (previous?.tags ?? [])),
                  ...results.flatMap((r) => r.tags),
                ]),
              ],
              keyTags: Object.fromEntries([
                ...Object.entries(previous?.keyTags ?? {}).filter(([key]) =>
                  retained(key),
                ),
                ...results.flatMap((response) =>
                  Object.entries(response.keyTags),
                ),
              ]),
            };
            return previous;
          } catch (error) {
            for (const key of refreshedKeys) dirtyKeys.add(key);
            refreshAll ||= refreshedAll;
            throw error;
          }
        },
        () => loaded.map((key) => ["result", key]),
      );
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
      const cached = getTaggedReadData<KeyedData<Value>>(client, queryKey);
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
            restartTaggedRead(observer.getCurrentQuery());
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
