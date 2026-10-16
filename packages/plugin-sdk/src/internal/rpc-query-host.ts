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
  taggedQueryMeta,
  createTaggedKeyedQueryOwner,
  useTaggedMutation,
  useQuerySelection,
} from "@bb/query-tags";
import { jsonValueSchema, type JsonValue } from "@bb/domain";
import { z } from "zod";
import type {
  ExperimentalRpcKeyedQueryState,
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
    const queryKey = ["plugin-rpc", pluginId, options.method, input];
    useSubscription(host, pluginId, options.enabled ?? true);
    const query = useQuery(
      {
        queryKey,
        enabled: options.enabled,
        meta: taggedQueryMeta({ scope: pluginTagScope(pluginId), tagsOf }),
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
        queryKey: ["plugin-rpc", pluginId, options.method, { keyed: true }],
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
  const experimental_useRpcMutation: PluginSdkApp["experimental_useRpcMutation"] =
    (options) => {
      const host = useHost();
      const pluginId = options.pluginId ?? host.pluginId;
      return useTaggedMutation(
        host.queryClient,
        (tags) =>
          invalidateTags(host.queryClient, pluginTagScope(pluginId), tags),
        async (input?: JsonValue) =>
          envelopeSchema.parse(
            await host.call(pluginId, options.method, input ?? null),
          ),
      ) as ReturnType<PluginSdkApp["experimental_useRpcMutation"]>;
    };
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
