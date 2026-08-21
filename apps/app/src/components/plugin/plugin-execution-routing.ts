import type { SystemProvidersQuery } from "@bb/server-contract";
import type { ExperimentalProviderModelPickerRouting } from "@get-bb/plugin-sdk";

export interface ResolvedPluginExecutionRouting {
  key: string;
  query: SystemProvidersQuery;
}

/** Keep every plugin execution control on the same routed query identity. */
export function resolvePluginExecutionRouting(
  routing: ExperimentalProviderModelPickerRouting | undefined,
): ResolvedPluginExecutionRouting {
  if (routing?.kind === "host") {
    return {
      key: `host:${routing.hostId}`,
      query: { hostId: routing.hostId },
    };
  }
  if (routing?.kind === "environment") {
    return {
      key: `environment:${routing.environmentId}`,
      query: { environmentId: routing.environmentId },
    };
  }
  return { key: "primary", query: {} };
}
