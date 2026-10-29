import type {
  ExperimentalRpcKeyedMethod,
  ExperimentalRpcKeyedValue,
} from "../rpc-contract.js";
import { experimental_PluginRpcCallError } from "../rpc-contract.js";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useIsFetching, type QueryClient } from "@tanstack/react-query";
import {
  invalidateTags,
  useTaggedQuery,
  pluginTagScope,
  runTaggedRead,
  taggedQueryOptions,
  optimisticQueryUpdate,
  optimisticKeyedUpdate,
  KeyedCollection,
  type OptimisticUpdate,
  createTaggedKeyedQueryOwner,
  useTaggedMutation,
  useQuerySelection,
} from "@bb/query-tags";
import {
  canonicalPluginReadInput,
  jsonValueSchema,
  type JsonValue,
} from "@bb/domain";
import { rpcResponseTags } from "./rpc-tags.js";
import { z } from "zod";
import type {
  ExperimentalRpcKeyedQueryState,
  ExperimentalRpcMutationOptions,
  ExperimentalRpcOptimisticCache,
  PluginSdkApp,
} from "../app-contract.js";

export interface RpcQueryHost {
  pluginId: string | null;
  queryClient: QueryClient;
  call(pluginId: string, method: string, input: JsonValue): Promise<unknown>;
  subscribe(pluginId: string): () => void;
  watch?(
    pluginId: string,
    method: string,
    read: { input: JsonValue } | { key: string },
  ): () => void;
}
interface RpcResponse {
  result: JsonValue;
  tags: string[];
  keyTags: Record<string, string[]>;
  invalidated: string[];
}
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
const keyListSchema = z.array(z.string());
const jsonRecordSchema = z.record(z.string(), jsonValueSchema);
const keyedCollections = new Map<string, KeyedCollection<unknown>>();
function keyedCollection(pluginId: string, method: string) {
  const name = JSON.stringify([pluginId, method]);
  let collection = keyedCollections.get(name);
  if (!collection) {
    collection = new KeyedCollection(name);
    keyedCollections.set(name, collection);
  }
  return collection;
}
function parsedUpdate<Value>(update: (current: Value) => unknown) {
  return (current: unknown) => jsonValueSchema.parse(update(current as Value));
}
function optimisticCache<Contract extends PluginRpcContract>(
  pluginId: string,
  updates: OptimisticUpdate[],
): ExperimentalRpcOptimisticCache<Contract> {
  return {
    update(method, input, update) {
      updates.push(
        optimisticQueryUpdate(
          rpcQueryKey(pluginId, method, jsonValueSchema.parse(input ?? null)),
          parsedUpdate(update),
          ["result"],
        ),
      );
    },
    updateKey(method, key, update) {
      updates.push(
        optimisticKeyedUpdate(
          keyedCollection(pluginId, method),
          key,
          parsedUpdate(update),
        ),
      );
    },
  };
}
async function callRpc(
  host: RpcQueryHost,
  pluginId: string,
  contract: PluginRpcContract,
  method: string,
  input: JsonValue,
): Promise<RpcResponse> {
  let raw: unknown;
  try {
    raw = await host.call(pluginId, method, input);
  } catch (error) {
    throw experimental_PluginRpcCallError.from(error);
  }
  const result = jsonValueSchema.safeParse(raw);
  if (!result.success)
    throw new experimental_PluginRpcCallError({
      code: "invalid_response",
      message: `Invalid RPC response for ${method}`,
    });
  const methodContract = contract[method];
  if (methodContract === undefined)
    throw new experimental_PluginRpcCallError({
      code: "unknown_method",
      message: `rpc method "${method}" isn't in the contract`,
    });
  const parsedInput = await methodContract.input["~standard"].validate(input);
  if (parsedInput.issues !== undefined)
    throw new experimental_PluginRpcCallError({
      code: "invalid_input",
      message: `rpc input validation failed for ${method}`,
    });
  return {
    result: result.data,
    ...rpcResponseTags(methodContract, parsedInput.value, result.data),
  };
}

function resolvePluginId(
  host: RpcQueryHost,
  pluginId: string | undefined,
): string {
  const resolved = pluginId ?? host.pluginId;
  if (resolved === null) {
    throw new Error(
      "plugin RPC hooks outside a plugin slot component need an explicit pluginId",
    );
  }
  return resolved;
}

const tagsOf = (data: RpcResponse) => [
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
    const pluginId = resolvePluginId(host, options.pluginId);
    const input = jsonValueSchema.parse(options.input ?? null);
    const queryKey = rpcQueryKey(pluginId, options.method, input);
    useSubscription(host, pluginId, options.enabled ?? true);
    const watchIdentity = canonicalPluginReadInput(input);
    useEffect(() => {
      if (options.enabled === false) return;
      return host.watch?.(pluginId, options.method, {
        input: jsonValueSchema.parse(JSON.parse(watchIdentity)),
      });
    }, [host, pluginId, options.method, watchIdentity, options.enabled]);
    const query = useTaggedQuery(
      {
        queryKey,
        enabled: options.enabled,
        ...taggedQueryOptions(host.queryClient, queryKey, {
          scope: pluginTagScope(pluginId),
          tagsOf,
        }),
        queryFn: () =>
          runTaggedRead(host.queryClient, queryKey, async () =>
            callRpc(host, pluginId, options.contract, options.method, input),
          ),
      },
      host.queryClient,
    );
    return {
      data: query.data?.result,
      error:
        query.error === null
          ? null
          : experimental_PluginRpcCallError.from(
              query.error,
              "invalid_response",
            ),
      isLoading: (options.enabled ?? true) && query.isLoading,
      isFetching: query.isFetching,
      refetch: async () => {
        await query.refetch();
      },
    } as ReturnType<PluginSdkApp["experimental_useRpcQuery"]>;
  };
  function experimental_useRpcKeyedQuery<
    Contract extends PluginRpcContract,
    Method extends ExperimentalRpcKeyedMethod<Contract>,
    Selection = Record<string, ExperimentalRpcKeyedValue<Contract[Method]>>,
  >(options: {
    contract: Contract;
    pluginId?: string;
    method: Method;
    keys: readonly string[];
    enabled?: boolean;
    select?(
      data: Record<string, ExperimentalRpcKeyedValue<Contract[Method]>>,
    ): Selection;
  }): ExperimentalRpcKeyedQueryState<
    ExperimentalRpcKeyedValue<Contract[Method]>,
    Selection
  > {
    type T = ExperimentalRpcKeyedValue<Contract[Method]>;
    const host = useHost();
    const pluginId = resolvePluginId(host, options.pluginId);
    const enabled = options.enabled ?? true;
    const identity = JSON.stringify([...new Set(options.keys)].sort());
    const keys = useMemo(
      () => keyListSchema.parse(JSON.parse(identity)),
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
        collection: keyedCollection(pluginId, options.method),
        read: async (keys) => {
          const response = await callRpc(
            host,
            pluginId,
            options.contract,
            options.method,
            { keys: [...keys] },
          );
          return {
            ...response,
            result: jsonRecordSchema.parse(response.result),
          };
        },
      });
      cache.set(id, owner);
    }
    const current = owner;
    useSubscription(host, pluginId, enabled && keys.length > 0);
    const subscribe = useCallback(
      (listener: () => void) =>
        current.subscribe(enabled ? keys : [], listener),
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
          error:
            query.error === null
              ? null
              : experimental_PluginRpcCallError.from(
                  query.error,
                  "invalid_response",
                ),
          isLoading:
            enabled &&
            keys.some((key) => !Object.hasOwn(rows, key)) &&
            query.isFetching,
          isFetching: query.isFetching,
        };
      },
      [keys, enabled, selectRows],
    );
    const query = useQuerySelection(subscribe, getSnapshot, select);
    const watches = useMemo(
      () => new Map<string, (() => void) | undefined>(),
      [host, pluginId, options.method],
    );
    useEffect(
      () => () => {
        for (const release of watches.values()) release?.();
        watches.clear();
      },
      [watches],
    );
    useEffect(() => {
      const wanted = new Set(enabled ? keys : []);
      for (const [key, release] of watches) {
        if (wanted.has(key)) continue;
        release?.();
        watches.delete(key);
      }
      for (const key of wanted) {
        if (!watches.has(key))
          watches.set(key, host.watch?.(pluginId, options.method, { key }));
      }
    }, [host, pluginId, options.method, keys, enabled, watches]);
    const heldKeys = useRef(keys);
    useEffect(() => {
      heldKeys.current = keys;
    }, [keys]);
    const refetch = useCallback(async () => {
      await current.refresh(heldKeys.current);
    }, [current]);
    const refetchKeys = useCallback(
      async (requested: readonly string[]) => {
        await current.refresh(requested.filter((key) => keys.includes(key)));
      },
      [current, keys],
    );
    return {
      ...query,
      refetch,
      refetchKeys,
    } as ExperimentalRpcKeyedQueryState<T, Selection>;
  }
  function experimental_useRpcMutation<
    Contract extends PluginRpcContract = PluginRpcContract,
    Method extends keyof Contract & string = keyof Contract & string,
  >(options: ExperimentalRpcMutationOptions<Contract, Method>) {
    const host = useHost();
    const pluginId = resolvePluginId(host, options.pluginId);
    const mutation = useTaggedMutation<
      StandardSchemaV1InferInput<Contract[Method]["input"]>,
      PluginRpcResult<Contract[Method]>
    >({
      client: host.queryClient,
      meta: { showErrorToast: false },
      invalidate: (tags) =>
        invalidateTags(host.queryClient, pluginTagScope(pluginId), tags),
      call: async (input) => {
        const response = await callRpc(
          host,
          pluginId,
          options.contract,
          options.method,
          jsonValueSchema.parse(input),
        );
        return {
          ...response,
          result: response.result as PluginRpcResult<Contract[Method]>,
        };
      },
      optimistic: (input) => {
        const updates: OptimisticUpdate[] = [];
        options.optimistic?.(
          input,
          optimisticCache<Contract>(pluginId, updates),
        );
        return updates;
      },
    });
    const { mutate } = mutation;
    return {
      ...mutation,
      error:
        mutation.error === null
          ? null
          : experimental_PluginRpcCallError.from(
              mutation.error,
              "invalid_input",
            ),
      mutate: useCallback(
        async (...args: PluginRpcCallArgs<Contract[Method]>) => {
          try {
            return await mutate(
              (args[0] ?? null) as StandardSchemaV1InferInput<
                Contract[Method]["input"]
              >,
            );
          } catch (error) {
            throw experimental_PluginRpcCallError.from(error);
          }
        },
        [mutate],
      ),
    };
  }
  function experimental_useRpcRefresh() {
    const host = useHost();
    const pluginId = resolvePluginId(host, undefined);
    const isRefreshing =
      useIsFetching({ queryKey: ["plugin-rpc", pluginId] }, host.queryClient) >
      0;
    return {
      isRefreshing,
      refresh: () => {
        void invalidateTags(host.queryClient, pluginTagScope(pluginId), null);
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
