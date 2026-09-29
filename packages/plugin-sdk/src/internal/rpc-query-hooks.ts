import { useCallback, useEffect, useRef } from "react";
import {
  hashKey,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
  type UseQueryResult,
  type InfiniteData,
} from "@tanstack/react-query";
import type {
  ExperimentalRpcQuerySignal,
  ExperimentalRpcInfiniteQueryOptions,
  PluginSdkApp,
} from "../app-contract.js";
import type {
  PluginRpcContract,
  PluginRpcResult,
  PluginRpcMethodContract,
} from "../rpc-contract.js";

import type { JsonValue } from "../json-value.js";

export function useCoreQueryResult<Data>(
  query: UseQueryResult<Data, Error>,
  enabled = true,
) {
  const refresh = query.refetch;
  const refetch = useCallback(async () => {
    if (enabled) await refresh({ cancelRefetch: false });
  }, [enabled, refresh]);
  return { ...query, refetch };
}

export interface RpcQueryHost {
  pluginId: string;
  call(method: string, input: unknown, signal: AbortSignal): Promise<unknown>;
  subscribe(channel: string, handler: (payload: unknown) => void): () => void;
  onConnected(handler: () => void): () => void;
}

interface RefreshEntry {
  users: number;
  schedule(): void;
  dispose(): void;
}

const refreshEntries = new WeakMap<QueryClient, Map<string, RefreshEntry>>();

function registerRefresh(client: QueryClient, queryKey: QueryKey) {
  let entries = refreshEntries.get(client);
  if (!entries) {
    entries = new Map();
    refreshEntries.set(client, entries);
  }
  const key = hashKey(queryKey);
  let entry = entries.get(key);
  if (!entry) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let dirty = false;
    let disposed = false;
    const flush = async () => {
      timer = undefined;
      if (disposed || running) return;
      running = true;
      dirty = false;
      await client.invalidateQueries({
        queryKey,
        exact: true,
        refetchType: "none",
      });
      const pending = client
        .getQueryCache()
        .find({ queryKey, exact: true })?.promise;
      if (
        client.getQueryState(queryKey)?.fetchStatus === "fetching" &&
        pending
      ) {
        await pending.catch(() => {});
      }
      if (!disposed) {
        dirty = false;
        await client.refetchQueries(
          { queryKey, exact: true, type: "active" },
          { cancelRefetch: false },
        );
      }
      running = false;
      if (dirty && !disposed) schedule();
    };
    const schedule = () => {
      dirty = true;
      if (!disposed && !running && timer === undefined) {
        timer = setTimeout(() => void flush(), 50);
      }
    };
    entry = {
      users: 0,
      schedule,
      dispose() {
        disposed = true;
        if (timer !== undefined) clearTimeout(timer);
        void client.invalidateQueries({
          queryKey,
          exact: true,
          refetchType: "none",
        });
      },
    };
    entries.set(key, entry);
  }
  entry.users += 1;
  return {
    schedule: entry.schedule,
    dispose() {
      entry.users -= 1;
      if (entry.users === 0) {
        entry.dispose();
        entries.delete(key);
      }
    },
  };
}

function useQuerySignals(
  host: RpcQueryHost,
  queryKey: QueryKey,
  signals: readonly ExperimentalRpcQuerySignal[] | undefined,
  enabled: boolean,
) {
  const client = useQueryClient();
  const latest = useRef(signals);
  useEffect(() => {
    latest.current = signals;
  });
  const cachedQuery = client.getQueryCache().find({ queryKey, exact: true });
  const channels = JSON.stringify(
    [...new Set(signals?.map((signal) => signal.channel))].sort(),
  );
  useEffect(() => {
    if (!enabled || !cachedQuery) return;
    const registration = registerRefresh(client, cachedQuery.queryKey);
    const subscriptions = [
      ...new Set(latest.current?.map((signal) => signal.channel)),
    ].map((channel) =>
      host.subscribe(channel, (payload) => {
        if (
          latest.current?.some(
            (signal) =>
              signal.channel === channel &&
              (!signal.affects || signal.affects(payload)),
          )
        )
          registration.schedule();
      }),
    );
    subscriptions.push(host.onConnected(registration.schedule));
    return () => {
      for (const unsubscribe of subscriptions) unsubscribe();
      registration.dispose();
    };
  }, [host, client, cachedQuery, channels, enabled]);
}

async function readRpc<Method extends PluginRpcMethodContract>(
  host: Pick<RpcQueryHost, "pluginId" | "call">,
  name: string,
  method: Method | undefined,
  input: unknown,
  signal: AbortSignal,
  timeoutMs?: number,
): Promise<PluginRpcResult<Method>> {
  if (method !== undefined) {
    const result = await method.input["~standard"].validate(input);
    if (result.issues) {
      throw new Error(
        `Invalid RPC query input: ${result.issues.map((issue) => issue.message).join("; ")}`,
      );
    }
  }
  signal.throwIfAborted();
  if (timeoutMs === undefined)
    return (await host.call(name, input, signal)) as PluginRpcResult<Method>;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("RPC query timeoutMs must be positive and finite");
  const controller = new AbortController();
  const requestSignal = AbortSignal.any([signal, controller.signal]);
  const timer = setTimeout(
    () =>
      controller.abort(
        new Error(`RPC query ${name} timed out after ${timeoutMs}ms`),
      ),
    timeoutMs,
  );
  let onAbort = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(requestSignal.reason);
    requestSignal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return (await Promise.race([
      host.call(name, input, requestSignal),
      aborted,
    ])) as PluginRpcResult<Method>;
  } finally {
    clearTimeout(timer);
    requestSignal.removeEventListener("abort", onAbort);
  }
}

export function createRpcQueryHooks(
  useHost: () => RpcQueryHost,
): Pick<
  PluginSdkApp,
  "experimental_useRpcQuery" | "experimental_useRpcInfiniteQuery"
> {
  return {
    experimental_useRpcQuery: function useRpcQuery(options) {
      const host = useHost();
      const queryKey = [
        "plugin-rpc-query",
        host.pluginId,
        "single",
        options.method,
        options.input,
      ];
      const query = useQuery({
        queryKey,
        queryFn: ({ signal }) =>
          readRpc(
            host,
            options.method,
            options.contract?.[options.method],
            options.input,
            signal,
            options.timeoutMs,
          ),
        enabled: options.enabled ?? true,
        staleTime: options.staleTime ?? 30_000,
        retry: false,
      });
      useQuerySignals(
        host,
        queryKey,
        options.realtime,
        options.enabled ?? true,
      );
      const { refetch } = useCoreQueryResult(query, options.enabled ?? true);
      return {
        data: query.data,
        error: query.error,
        isLoading: query.isLoading,
        isFetching: query.isFetching,
        refetch,
      };
    },
    experimental_useRpcInfiniteQuery: function useRpcInfiniteQuery<
      Contract extends PluginRpcContract,
      Method extends Extract<keyof Contract, string>,
      PageParam extends JsonValue,
    >(
      options: ExperimentalRpcInfiniteQueryOptions<Contract, Method, PageParam>,
    ) {
      const host = useHost();
      const queryKey = [
        "plugin-rpc-query",
        host.pluginId,
        "infinite",
        options.method,
        options.input,
        options.initialPageParam,
      ];
      const query = useInfiniteQuery<
        PluginRpcResult<Contract[Method]>,
        Error,
        InfiniteData<PluginRpcResult<Contract[Method]>, PageParam>,
        QueryKey,
        PageParam
      >({
        queryKey,
        queryFn: ({ pageParam, signal }) =>
          readRpc<Contract[Method]>(
            host,
            options.method,
            options.contract?.[options.method],
            options.getPageInput(options.input, pageParam as PageParam),
            signal,
            options.timeoutMs,
          ),
        initialPageParam: options.initialPageParam,
        getNextPageParam: options.getNextPageParam,
        enabled: options.enabled ?? true,
        staleTime: options.staleTime ?? 30_000,
        retry: false,
      });
      useQuerySignals(
        host,
        queryKey,
        options.realtime,
        options.enabled ?? true,
      );
      const { refetch } = useCoreQueryResult(query, options.enabled ?? true);
      const { isFetching, hasNextPage, fetchNextPage: nextPage } = query;
      const fetchNextPage = useCallback(async () => {
        if (options.enabled !== false && !isFetching && hasNextPage)
          await nextPage({ cancelRefetch: false });
      }, [options.enabled, isFetching, hasNextPage, nextPage]);
      return {
        data: query.data,
        error: query.error,
        isLoading: query.isLoading,
        isFetching: query.isFetching,
        refetch,
        hasNextPage: query.hasNextPage,
        isFetchingNextPage: query.isFetchingNextPage,
        isFetchNextPageError: query.isFetchNextPageError,
        fetchNextPage,
      };
    },
  };
}
