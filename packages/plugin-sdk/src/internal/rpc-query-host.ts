import { useCallback, useEffect, useMemo } from "react";
import {
  useQuery,
  useIsFetching,
  type QueryClient,
} from "@tanstack/react-query";
import {
  invalidateTags,
  pluginTagScope,
  runTaggedRead,
  taggedQueryOptions,
  optimisticQueryUpdate,
  type TaggedOptimisticUpdate,
  createTaggedKeyedQueryOwner,
  useTaggedMutation,
  useQuerySelection,
} from "@bb/query-tags";
import {
  canonicalPluginReadInput,
  jsonValueSchema,
  type JsonValue,
} from "@bb/domain";
import { z } from "zod";
import type {
  ExperimentalRpcKeyedQueryState,
  ExperimentalRpcMutationOptions,
  ExperimentalRpcOptimisticCache,
  PluginSdkApp,
} from "../app-contract.js";

export interface RpcQueryHost {
  pluginId: string;
  queryClient: QueryClient;
  call(pluginId: string, method: string, input: JsonValue): Promise<unknown>;
  subscribe(pluginId: string): () => void;
  watch?(
    pluginId: string,
    method: string,
    read: { input: JsonValue } | { key: string },
  ): () => void;
}
const envelopeSchema = z.object({
  result: jsonValueSchema,
  whileWatched: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  keyTags: z.record(z.string(), z.array(z.string())).default({}),
  invalidated: z.array(z.string()).default([]),
});
type Envelope = z.infer<typeof envelopeSchema>;
import type {
  PluginRpcContract,
  PluginRpcCallArgs,
  PluginRpcResult,
  StandardSchemaV1InferInput,
} from "../rpc-contract.js";
const rpcQueryKey = (pluginId: string, method: string, input: JsonValue) => [
  "plugin-rpc",
  pluginId,
  method,
  input,
];
const keyedQueryKey = (pluginId: string, method: string) =>
  rpcQueryKey(pluginId, method, { keyed: true });
function optimisticCache<Contract extends PluginRpcContract>(
  pluginId: string,
  updates: TaggedOptimisticUpdate[],
): ExperimentalRpcOptimisticCache<Contract> {
  const add = (prediction: TaggedOptimisticUpdate) => {
    updates.push({
      ...prediction,
      update: (current) => jsonValueSchema.parse(prediction.update(current)),
    });
  };
  return {
    update(method, input, update) {
      add(
        optimisticQueryUpdate(
          rpcQueryKey(pluginId, method, jsonValueSchema.parse(input ?? null)),
          update,
          ["result"],
        ),
      );
    },
    updateKey(method, key, update) {
      add(
        optimisticQueryUpdate(keyedQueryKey(pluginId, method), update, [
          "result",
          key,
        ]),
      );
    },
  };
}
const tagsOf = (data: Envelope) => [
  ...data.tags,
  ...Object.values(data.keyTags).flat(),
];
const watchedMethods = new WeakMap<QueryClient, Set<string>>();
const owners = new WeakMap<
  QueryClient,
  Map<string, ReturnType<typeof createTaggedKeyedQueryOwner<JsonValue>>>
>();
async function callWithDeadline(
  host: RpcQueryHost,
  pluginId: string,
  method: string,
  input: JsonValue,
  timeoutMs: number | undefined,
) {
  if (timeoutMs === undefined) return host.call(pluginId, method, input);
  const deadlineMs = z.number().positive().finite().parse(timeoutMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      host.call(pluginId, method, input),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `RPC "${method}" timed out after ${deadlineMs / 1000} seconds`,
              ),
            ),
          deadlineMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function createRpcQueryHooks(useHost: () => RpcQueryHost) {
  function useSubscription(
    host: RpcQueryHost,
    pluginId: string,
    enabled: boolean,
  ) {
    useEffect(
      () => (enabled ? host.subscribe(pluginId) : undefined),
      [host, pluginId, enabled],
    );
  }
  const experimental_useRpcQuery: PluginSdkApp["experimental_useRpcQuery"] = (
    options,
  ) => {
    const host = useHost();
    const pluginId = options.pluginId ?? host.pluginId;
    const input = jsonValueSchema.parse(options.input ?? null);
    const queryKey = rpcQueryKey(pluginId, options.method, input);
    useSubscription(host, pluginId, options.enabled ?? true);
    const query = useQuery(
      {
        queryKey,
        enabled: options.enabled,
        refetchOnMount: options.refetchOnMount,
        ...taggedQueryOptions(host.queryClient, queryKey, {
          scope: pluginTagScope(pluginId),
          tagsOf,
        }),
        queryFn: () =>
          runTaggedRead(host.queryClient, queryKey, async () =>
            envelopeSchema.parse(
              await callWithDeadline(
                host,
                pluginId,
                options.method,
                input,
                options.timeoutMs,
              ),
            ),
          ),
      },
      host.queryClient,
    );
    const watchIdentity = canonicalPluginReadInput(input);
    useEffect(() => {
      if (options.enabled === false || !query.data?.whileWatched) return;
      return host.watch?.(pluginId, options.method, {
        input: jsonValueSchema.parse(JSON.parse(watchIdentity)),
      });
    }, [
      host,
      pluginId,
      options.method,
      watchIdentity,
      options.enabled,
      query.data?.whileWatched,
    ]);
    const refetch = useCallback(async () => {
      await query.refetch();
    }, [query.refetch]);
    return {
      data: query.data?.result,
      dataUpdatedAt: query.dataUpdatedAt,
      error: query.error,
      isLoading: query.isLoading,
      isFetching: query.isFetching,
      refetch,
    } as ReturnType<PluginSdkApp["experimental_useRpcQuery"]>;
  };
  function experimental_useRpcKeyedQuery<
    T = JsonValue,
    Selection = Record<string, T>,
  >(options: {
    pluginId?: string;
    method: string;
    keys: readonly string[];
    enabled?: boolean;
    select?(data: Record<string, T>): Selection;
  }): ExperimentalRpcKeyedQueryState<T, Selection> {
    const host = useHost();
    const pluginId = options.pluginId ?? host.pluginId;
    const enabled = options.enabled ?? true;
    const identity = JSON.stringify([...new Set(options.keys)].sort());
    const keys = useMemo(
      () => z.array(z.string()).parse(JSON.parse(identity)),
      [identity],
    );
    let watched = watchedMethods.get(host.queryClient);
    if (!watched) {
      watched = new Set();
      watchedMethods.set(host.queryClient, watched);
    }
    const producers = watched;
    let cache = owners.get(host.queryClient);
    if (!cache) {
      cache = new Map();
      owners.set(host.queryClient, cache);
    }
    const id = JSON.stringify([pluginId, options.method]);
    let owner = cache.get(id);
    if (!owner) {
      owner = createTaggedKeyedQueryOwner({
        client: host.queryClient,
        queryKey: keyedQueryKey(pluginId, options.method),
        scope: pluginTagScope(pluginId),
        read: async (keys) => {
          const response = envelopeSchema.parse(
            await host.call(pluginId, options.method, { keys: [...keys] }),
          );
          if (response.whileWatched) producers.add(id);
          else producers.delete(id);
          return {
            ...response,
            result: z
              .record(z.string(), jsonValueSchema)
              .parse(response.result),
          };
        },
      });
      cache.set(id, owner);
    }
    const current = owner;
    useSubscription(host, pluginId, enabled && keys.length > 0);
    const subscribe = useCallback(
      (listener: () => void) =>
        enabled && keys.length > 0
          ? current.subscribe(keys, listener)
          : () => {},
      [current, keys, enabled],
    );
    const getSnapshot = useCallback(
      () => current.observer.getCurrentResult(),
      [current],
    );
    const { select: selectRows } = options;
    const select = useCallback(
      (query: ReturnType<typeof current.observer.getCurrentResult>) => {
        const rows = query.data?.result ?? {};
        const data = Object.fromEntries(
          keys
            .filter((key) => Object.hasOwn(rows, key))
            .map((key) => [key, rows[key]]),
        ) as Record<string, T>;
        return {
          whileWatched: producers.has(id),
          data: selectRows ? selectRows(data) : data,
          dataUpdatedAt: query.dataUpdatedAt,
          error: query.error,
          isLoading: enabled && keys.length > 0 && query.isLoading,
          isFetching: query.isFetching,
        };
      },
      [keys, enabled, selectRows, producers, id],
    );
    const query = useQuerySelection(subscribe, getSnapshot, select);
    useEffect(() => {
      if (!enabled || !query.whileWatched) return;
      const releases = keys.map((key) =>
        host.watch?.(pluginId, options.method, { key }),
      );
      return () => {
        releases.forEach((release) => release?.());
      };
    }, [host, pluginId, options.method, keys, enabled, query.whileWatched]);
    const refetch = useCallback(async () => {
      await current.observer.refetch();
    }, [current]);
    return {
      ...query,
      refetch,
    } as ExperimentalRpcKeyedQueryState<T, Selection>;
  }
  function experimental_useRpcMutation<
    Contract extends PluginRpcContract = PluginRpcContract,
    Method extends keyof Contract & string = keyof Contract & string,
  >(options: ExperimentalRpcMutationOptions<Contract, Method>) {
    const host = useHost();
    const pluginId = options.pluginId ?? host.pluginId;
    const mutation = useTaggedMutation<
      StandardSchemaV1InferInput<Contract[Method]["input"]>,
      PluginRpcResult<Contract[Method]>
    >(
      host.queryClient,
      (tags) =>
        invalidateTags(host.queryClient, pluginTagScope(pluginId), tags),
      async (input) => {
        const response = envelopeSchema.parse(
          await callWithDeadline(
            host,
            pluginId,
            options.method,
            jsonValueSchema.parse(input),
            options.timeoutMs,
          ),
        );
        return {
          ...response,
          result: response.result as PluginRpcResult<Contract[Method]>,
        };
      },
      (input) => {
        const updates: TaggedOptimisticUpdate[] = [];
        options.optimistic?.(
          input,
          optimisticCache<Contract>(pluginId, updates),
        );
        return updates;
      },
    );
    const { mutate } = mutation;
    return {
      ...mutation,
      mutate: useCallback(
        (...args: PluginRpcCallArgs<Contract[Method]>) =>
          mutate(
            (args[0] ?? null) as StandardSchemaV1InferInput<
              Contract[Method]["input"]
            >,
          ),
        [mutate],
      ),
    };
  }
  function experimental_useRpcRefresh() {
    const host = useHost();
    const isRefreshing =
      useIsFetching(
        { queryKey: ["plugin-rpc", host.pluginId] },
        host.queryClient,
      ) > 0;
    return {
      isRefreshing,
      refresh: () => {
        void invalidateTags(
          host.queryClient,
          pluginTagScope(host.pluginId),
          null,
        );
      },
    };
  }
  return {
    experimental_useRpcQuery,
    experimental_useRpcKeyedQuery,
    experimental_useRpcMutation,
    experimental_useRpcRefresh,
  };
}
