import { useSyncExternalStore } from "react";
import { QueryClient } from "@tanstack/react-query";
import { usageRpcSuccessSchema, type UsageSnapshot } from "./usage-schema.js";

export interface UsageReadInput {
  force: boolean;
  machineIds: string[] | null;
  providerIds: string[];
  maxAgeMs: number;
}

const client = new QueryClient();
const snapshotKey = ["usage-snapshot"];
interface Snapshot {
  data: UsageSnapshot | null;
  error: string | null;
  isRefreshing: boolean;
}
let snapshot: Snapshot = { data: null, error: null, isRefreshing: false };
let queue: Promise<unknown> = Promise.resolve();
client.setQueryDefaults(snapshotKey, { gcTime: Infinity });
const subscribe = (listener: () => void) =>
  client.getQueryCache().subscribe(listener);
function getSnapshot(): Snapshot {
  const current =
    client.getQueryData<Omit<Snapshot, "isRefreshing">>(snapshotKey);
  const data = current?.data ?? null;
  const error = current?.error ?? null;
  const isRefreshing = client.isFetching({ queryKey: ["usage-read"] }) > 0;
  if (
    snapshot.data !== data ||
    snapshot.error !== error ||
    snapshot.isRefreshing !== isRefreshing
  ) {
    snapshot = { data, error, isRefreshing };
  }
  return snapshot;
}

function rpcErrorMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const error = Reflect.get(body, "error");
  if (typeof error === "string") return error;
  if (typeof error !== "object" || error === null) return null;
  const message = Reflect.get(error, "message");
  return typeof message === "string" ? message : null;
}

async function fetchUsage(
  pluginId: string,
  input: UsageReadInput,
  signal: AbortSignal,
): Promise<UsageSnapshot> {
  const response = await fetch(
    `/api/v1/plugins/${encodeURIComponent(pluginId)}/rpc/getUsage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        force: input.force,
        machineIds: input.machineIds,
        maxAgeMs: input.maxAgeMs,
        providerIds: input.providerIds,
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
    },
  );
  if (!response.ok)
    throw new Error(`Usage request returned HTTP ${response.status}.`);
  const body: unknown = await response.json();
  const parsed = usageRpcSuccessSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(
      rpcErrorMessage(body) ?? "Provider usage could not be loaded.",
    );
  }
  return parsed.data.result;
}

export async function readUsage(
  pluginId: string,
  input: UsageReadInput,
  signal?: AbortSignal,
): Promise<UsageSnapshot> {
  try {
    const data = await client.fetchQuery({
      queryKey: ["usage-read", pluginId, input],
      staleTime: 0,
      retry: false,
      queryFn: ({ signal: querySignal }) => {
        const request = queue.then(() =>
          fetchUsage(pluginId, input, querySignal),
        );
        queue = request.catch(() => undefined);
        return request;
      },
    });
    if (!signal?.aborted)
      client.setQueryData(snapshotKey, { data, error: null });
    return data;
  } catch (error) {
    if (!signal?.aborted)
      client.setQueryData(snapshotKey, {
        data: client.getQueryData<Snapshot>(snapshotKey)?.data ?? null,
        error: "Couldn’t refresh usage.",
      });
    throw error;
  }
}

export function useUsageSnapshot() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
