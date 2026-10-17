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
import { jsonValueSchema, type JsonValue } from "@bb/domain";
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
}
const envelopeSchema = z.object({
  result: jsonValueSchema,
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
const owners = new WeakMap<
  QueryClient,
  Map<string, ReturnType<typeof createTaggedKeyedQueryOwner<JsonValue>>>
>();
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
        ...taggedQueryOptions(host.queryClient, queryKey, {
          scope: pluginTagScope(pluginId),
          tagsOf,
        }),
        queryFn: () =>
          runTaggedRead(host.queryClient, queryKey, async () =>
            envelopeSchema.parse(
              await host.call(pluginId, options.method, input),
            ),
          ),
      },
      host.queryClient,
    );
    return {
      data: query.data?.result,
      error: query.error,
      isLoading: query.isLoading,
      isFetching: query.isFetching,
      refetch: async () => {
        await query.refetch();
      },
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
          data: selectRows ? selectRows(data) : data,
          error: query.error,
          isLoading: enabled && keys.length > 0 && query.isLoading,
          isFetching: query.isFetching,
        };
      },
      [keys, enabled, selectRows],
    );
    const query = useQuerySelection(subscribe, getSnapshot, select);
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
    return useTaggedMutation<
      PluginRpcCallArgs<Contract[Method]>,
      PluginRpcResult<Contract[Method]>
    >(
      host.queryClient,
      (tags) =>
        invalidateTags(host.queryClient, pluginTagScope(pluginId), tags),
      async (...args) => {
        const response = envelopeSchema.parse(
          await host.call(
            pluginId,
            options.method,
            jsonValueSchema.parse(args[0] ?? null),
          ),
        );
        return {
          ...response,
          result: response.result as PluginRpcResult<Contract[Method]>,
        };
      },
      (...args) => {
        const updates: TaggedOptimisticUpdate[] = [];
        options.optimistic?.(
          (args[0] ?? null) as StandardSchemaV1InferInput<
            Contract[Method]["input"]
          >,
          optimisticCache<Contract>(pluginId, updates),
        );
        return updates;
      },
    );
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
