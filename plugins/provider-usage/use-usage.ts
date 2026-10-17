import { useEffect } from "react";
import {
  experimental_useRpcQuery,
  experimental_useRpcMutation,
} from "@get-bb/plugin-sdk/app";
import type { providerUsageRpcContract } from "./server.js";
import { selectUsageMachine } from "./usage-schema.js";

export function useUsage(
  machineId: string | null,
  providerIds: string[] | null,
  maxAgeMs: number,
) {
  const inventory = experimental_useRpcQuery<
    typeof providerUsageRpcContract,
    "getUsage"
  >({
    method: "getUsage",
    input: { force: false, machineIds: null, providerIds: [], maxAgeMs },
  });
  const selected = selectUsageMachine(
    inventory.data?.machines ?? [],
    machineId,
    null,
  );
  const input = {
    force: false,
    machineIds: selected ? [selected.id] : null,
    providerIds: providerIds ?? [
      ...new Set(selected?.providers.map((provider) => provider.providerId)),
    ],
    maxAgeMs,
  };
  const usage = experimental_useRpcQuery<
    typeof providerUsageRpcContract,
    "getUsage"
  >({
    method: "getUsage",
    input,
    enabled: selected !== null && input.providerIds.length > 0,
  });
  const reload = experimental_useRpcMutation<
    typeof providerUsageRpcContract,
    "refreshUsage"
  >({ method: "refreshUsage" });
  const { reset } = reload;
  const target = JSON.stringify(input);
  useEffect(() => reset(), [target, reset]);
  useEffect(() => {
    if (inventory.isFetching || usage.isFetching) reset();
  }, [inventory.isFetching, usage.isFetching, reset]);
  const data =
    inventory.data && !inventory.error
      ? {
          machines: inventory.data.machines.map((machine) => {
            const measured = usage.data?.machines.find(
              (item) => item.id === machine.id,
            );
            return {
              ...machine,
              error:
                measured && !usage.isFetching && !usage.error
                  ? measured.error
                  : machine.error,
              providers: machine.providers.map((provider) => {
                const observation = measured?.providers.find(
                  (item) => item.id === provider.id,
                );
                return {
                  ...provider,
                  usage:
                    usage.isFetching || usage.error
                      ? provider.usage
                      : (observation?.usage ?? provider.usage),
                };
              }),
            };
          }),
        }
      : (usage.data ?? inventory.data ?? null);
  return {
    data,
    error: Boolean(inventory.error || usage.error || reload.error),
    isRefreshing: inventory.isFetching || usage.isFetching || reload.isPending,
    refresh: () => {
      const { force: _force, ...request } = input;
      void reload.mutate(request).catch(() => undefined);
    },
  };
}
