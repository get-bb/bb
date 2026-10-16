import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  QueryObserver,
  useMutation,
  replaceEqualDeep,
  type Query,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

export const CORE_TAG_SCOPE = "core";

export interface TaggedQueryRegistration<Data> {
  scope: string;
  tagsOf(data: Data): readonly string[];
}

export interface TaggedMutationOutcome<Result> {
  result: Result;
  invalidated: readonly string[];
}

const registrations = new WeakMap<object, TaggedQueryRegistration<unknown>>();
const reads = new WeakMap<object, { tags: Set<string>; restart: boolean }>();

export function taggedQueryMeta<Data>(
  registration: TaggedQueryRegistration<Data>,
): Record<string, unknown> {
  const meta = {};
  registrations.set(meta, {
    scope: registration.scope,
    tagsOf: (data) => registration.tagsOf(data as Data),
  });
  return meta;
}

function registrationOf(query: Query) {
  return query.meta === undefined ? undefined : registrations.get(query.meta);
}

export async function runTaggedRead<Data>(
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
    const pending = { tags: new Set<string>(), restart: false };
    reads.set(query, pending);
    try {
      const result = await read();
      if (
        pending.restart ||
        registration?.tagsOf(result).some((tag) => pending.tags.has(tag))
      )
        continue;
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
    const matches =
      tags === null ||
      (query.state.data === undefined && pending === undefined) ||
      (query.state.data !== undefined &&
        registration
          .tagsOf(query.state.data)
          .some((tag) => tags.includes(tag)));
    if (pending !== undefined) {
      if (matches) pending.restart = true;
      else for (const tag of tags ?? []) pending.tags.add(tag);
      if (query.isActive() && query.promise !== undefined)
        pendingReads.push(query.promise);
    }
    if (matches) matched.add(query);
  }
  await Promise.allSettled([
    client.invalidateQueries(
      { predicate: (query) => matched.has(query) },
      { cancelRefetch: false },
    ),
    ...pendingReads,
  ]);
}

export async function runTaggedMutation<Result>(
  invalidate: (tags: readonly string[]) => Promise<void>,
  call: () => Promise<TaggedMutationOutcome<Result>>,
): Promise<Result> {
  const { result, invalidated } = await call();
  if (invalidated.length > 0) await invalidate(invalidated);
  return result;
}

export const pluginTagScope = (pluginId: string): string =>
  `plugin:${pluginId}`;

export function restartTaggedRead(query: object): void {
  const pending = reads.get(query);
  if (pending) pending.restart = true;
}

export function useTaggedMutation<Args extends unknown[], Result>(
  client: QueryClient,
  invalidate: (tags: readonly string[]) => Promise<void>,
  call: (...args: Args) => Promise<TaggedMutationOutcome<Result>>,
) {
  const mutation = useMutation<Result, Error, Args>(
    {
      mutationFn: (args) => runTaggedMutation(invalidate, () => call(...args)),
    },
    client,
  );
  const { mutateAsync } = mutation;
  const mutate = useCallback(
    (...args: Args) => mutateAsync(args),
    [mutateAsync],
  );
  return {
    mutate,
    isPending: mutation.isPending,
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
  const observer = new QueryObserver<KeyedData<Value>>(client, {
    queryKey,
    staleTime: Infinity,
    retry: false,
    meta: taggedQueryMeta({
      scope,
      tagsOf: (data: KeyedData<Value>) => [
        ...data.tags,
        ...Object.values(data.keyTags).flat(),
      ],
    }),
    queryFn: () =>
      runTaggedRead(client, queryKey, async () => {
        await Promise.resolve();
        const cached = client.getQueryData<KeyedData<Value>>(queryKey);
        const invalidated =
          client.getQueryState(queryKey)?.isInvalidated ?? false;
        const previous = invalidated ? undefined : cached;
        const requested = [...keys.keys()].filter(
          (key) =>
            !missingOnly ||
            invalidated ||
            !Object.hasOwn(previous?.result ?? {}, key),
        );
        missingOnly = false;
        readingKeys = new Set(requested);
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
        return {
          result: Object.fromEntries([
            ...Object.entries(previous?.result ?? {}),
            ...results.flatMap((response) => Object.entries(response.result)),
          ]),
          tags: [...(previous?.tags ?? []), ...results.flatMap((r) => r.tags)],
          keyTags: Object.fromEntries([
            ...Object.entries(previous?.keyTags ?? {}),
            ...results.flatMap((response) => Object.entries(response.keyTags)),
          ]),
        };
      }),
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
      const missing = requested.filter(
        (key) =>
          !Object.hasOwn(observer.getCurrentResult().data?.result ?? {}, key),
      );
      if (!stop && observer.getCurrentResult().data === undefined)
        missingOnly = true;
      listeners.add(listener);
      if (!stop) {
        restartTaggedRead(observer.getCurrentQuery());
        void client.invalidateQueries({
          queryKey,
          exact: true,
          refetchType: "none",
        });
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
