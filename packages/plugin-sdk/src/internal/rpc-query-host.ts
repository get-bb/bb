import type {
  ExperimentalRpcKeyedMethod,
  ExperimentalRpcKeyedValue,
} from "../rpc-contract.js";
import { experimental_PluginRpcCallError } from "../rpc-contract.js";
import { useCallback, useEffect, useMemo } from "react";
import { useIsFetching, type QueryClient } from "@tanstack/react-query";
import {
  applyQueryChanges,
  mapReadChange,
  refreshLiveQueries,
  useLiveQuery,
  pluginChangeScope,
  liveQueryOptions,
  optimisticQueryUpdate,
  optimisticKeyedUpdate,
  KeyedCollection,
  type OptimisticUpdate,
  createLiveKeyedQueryOwner,
  useLiveMutation,
  useQuerySelection,
} from "@bb/query-changes";
import {
  canonicalPluginReadInput,
  pluginRpcEnvelopeSchema,
  jsonValueSchema,
  type JsonValue,
  type ReadChange,
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
  mutationMeta?: Readonly<Record<string, unknown>>;
  watch?(
    pluginId: string,
    method: string,
    read: { input: JsonValue } | { key: string },
  ): () => void;
}
type Envelope = z.infer<typeof pluginRpcEnvelopeSchema>;
import type {
  PluginRpcContract,
  PluginRpcMethodContract,
  PluginRpcCallArgs,
  PluginRpcResult,
  StandardSchemaV1,
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
const keyedCollections = new Map<string, KeyedCollection<JsonValue>>();
function keyedCollection(pluginId: string, method: string) {
  const name = JSON.stringify([pluginId, method]);
  let collection = keyedCollections.get(name);
  if (!collection) {
    collection = new KeyedCollection<JsonValue>(name);
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
async function callRpcEnvelope(
  host: RpcQueryHost,
  pluginId: string,
  method: string,
  input: JsonValue,
): Promise<Envelope> {
  let raw: unknown;
  try {
    raw = await host.call(pluginId, method, input);
  } catch (error) {
    throw experimental_PluginRpcCallError.from(error);
  }
  const parsed = pluginRpcEnvelopeSchema.safeParse(raw);
  if (!parsed.success)
    throw new experimental_PluginRpcCallError({
      code: "invalid_response",
      message: `Invalid RPC response for ${method}`,
    });
  return parsed.data;
}

function schemaValue(schema: StandardSchemaV1, value: unknown): unknown {
  const result = schema["~standard"].validate(value);
  if (result instanceof Promise) {
    void result.catch(() => {});
    throw new Error("Async patch validation requires a reload");
  }
  if (result.issues) throw new Error("Invalid patch output");
  return result.value;
}

function rpcReadChange<Data extends { result: JsonValue }>(
  method: PluginRpcMethodContract,
  input: JsonValue,
  data: Data | undefined,
  change: ReadChange,
  parse: (value: unknown) => Data["result"],
) {
  return mapReadChange(
    data,
    method.experimental_reactToChange?.(
      schemaValue(method.input, input),
      data?.result,
      change,
    ),
    "result",
    (value) => parse(schemaValue(method.output, value)),
  );
}

const dependenciesOf = (data: Envelope | undefined) =>
  data && [...data.dependencies, ...Object.values(data.keyDependencies).flat()];
const watchedMethods = new WeakMap<QueryClient, Set<string>>();
const owners = new WeakMap<
  QueryClient,
  Map<string, ReturnType<typeof createLiveKeyedQueryOwner<JsonValue>>>
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
    const query = useLiveQuery(
      {
        queryKey,
        enabled: options.enabled,
        ...liveQueryOptions(host.queryClient, queryKey, {
          read: () => callRpcEnvelope(host, pluginId, options.method, input),
          scope: pluginChangeScope(pluginId),
          dependenciesOf,
          reactToChange: (data, change) =>
            rpcReadChange(
              options.contract[options.method],
              input,
              data,
              change,
              jsonValueSchema.parse,
            ),
        }),
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
      error:
        query.error === null
          ? null
          : experimental_PluginRpcCallError.from(
              query.error,
              "invalid_response",
            ),
      isLoading: (options.enabled ?? true) && query.isLoading,
      isFetching: query.isFetching,
      refetch,
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
      owner = createLiveKeyedQueryOwner({
        client: host.queryClient,
        queryKey: keyedQueryKey(pluginId, options.method),
        scope: pluginChangeScope(pluginId),
        collection: keyedCollection(pluginId, options.method),
        reactToChange: (data, change, keys) =>
          rpcReadChange(
            options.contract[options.method],
            { keys: [...keys] },
            data,
            change,
            z.record(z.string(), jsonValueSchema).parse,
          ),
        read: async (keys) => {
          const response = await callRpcEnvelope(
            host,
            pluginId,
            options.method,
            { keys: [...keys] },
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
    const mutation = useLiveMutation<
      StandardSchemaV1InferInput<Contract[Method]["input"]>,
      PluginRpcResult<Contract[Method]>
    >({
      client: host.queryClient,
      publish: (changes) =>
        applyQueryChanges(
          host.queryClient,
          pluginChangeScope(pluginId),
          changes,
        ),
      call: async (input) => {
        const response = await callRpcEnvelope(
          host,
          pluginId,
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
      meta: host.mutationMeta,
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
    const isRefreshing =
      useIsFetching(
        { queryKey: ["plugin-rpc", host.pluginId] },
        host.queryClient,
      ) > 0;
    return {
      isRefreshing,
      refresh: () => {
        void refreshLiveQueries(
          host.queryClient,
          pluginChangeScope(host.pluginId),
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
