import { useSyncExternalStore } from "react";
import { QueryClient } from "@tanstack/react-query";
import { usageRpcSuccessSchema, type UsageSnapshot } from "./usage-schema.js";

export interface UsageReadInput {
  force: boolean;
  machineIds: string[] | null;
  providerId: string | null;
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

export async function readUsage(
  input: UsageReadInput,
  signal?: AbortSignal,
): Promise<UsageSnapshot> {
  try {
    const data = await client.fetchQuery({
      queryKey: ["usage-read", input],
      staleTime: 0,
      retry: false,
      queryFn: async ({ signal: querySignal }) => {
        const response = await fetch(
          "/api/v1/plugins/provider-usage/rpc/getUsage",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(input),
            signal: AbortSignal.any([querySignal, AbortSignal.timeout(60_000)]),
          },
        );
        if (!response.ok)
          throw new Error(`Usage request returned HTTP ${response.status}.`);
        return usageRpcSuccessSchema.parse(await response.json()).result;
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
