import { useMemo } from "react";
import { gitReadFailureError } from "bb-plugin-bb--git/read-error";
import { gitRpcContract } from "bb-plugin-bb--git/contract";
import { usePluginRpcQuery } from "@/lib/plugin-rpc-hooks";
import type { QueryOptions } from "./query-helpers";

export function useEnvironmentWorkStatus(
  environmentId: string | null | undefined,
  mergeBaseBranch?: string,
  options?: QueryOptions,
) {
  const query = usePluginRpcQuery({
    pluginId: "bb--git",
    contract: gitRpcContract,
    method: "status",
    input: {
      environmentId: environmentId ?? "",
      mergeBaseBranch: mergeBaseBranch ?? null,
    },
    enabled: (options?.enabled ?? true) && Boolean(environmentId),
  });
  const failure =
    query.data?.outcome === "unavailable" ? query.data.failure : undefined;
  const error = useMemo(
    () => query.error ?? (failure ? gitReadFailureError(failure) : null),
    [query.error, failure],
  );
  return { ...query, error };
}
