import type {
  SystemExecutionOptionsResponse,
  SystemProviderInfo,
  SystemProviderCatalogEntry,
  SystemProvidersQuery,
} from "@bb/server-contract";
import { readExecutionOptions, type CreateSdkAreaArgs } from "./common.js";

export type ProviderHostRoutingArgs =
  | { environmentId: string; hostId?: never }
  | { environmentId?: never; hostId: string }
  | { environmentId?: never; hostId?: never };

export type ProviderListArgs = ProviderHostRoutingArgs & {
  capability?: SystemProvidersQuery["capability"];
  signal?: AbortSignal;
};
export type ProviderModelsArgs = (
  | { environmentId: string; hostId?: never; projectId?: never }
  | { environmentId?: never; hostId: string; projectId?: string }
  | { environmentId?: never; hostId?: never; projectId?: string }
) & {
  providerId?: string;
  preferCached?: boolean;
  signal?: AbortSignal;
};

export type ProviderListResult = SystemProviderInfo[];
export type ProviderModelsResult = SystemExecutionOptionsResponse;

export interface ProvidersArea {
  catalog(): Promise<SystemProviderCatalogEntry[]>;
  setEnabled(args: {
    providerId: string;
    enabled: boolean;
  }): Promise<SystemProviderCatalogEntry[]>;
  list(args?: ProviderListArgs): Promise<ProviderListResult>;
  models(args?: ProviderModelsArgs): Promise<ProviderModelsResult>;
}

export function createProvidersArea(args: CreateSdkAreaArgs): ProvidersArea {
  const { operations } = args;
  const { call } = operations;
  return {
    catalog: () => call("system.providerCatalog", {}),
    setEnabled: ({ providerId, enabled }) =>
      call("system.providerEnabled", { id: providerId, enabled }),
    list: (input = {}) =>
      call(
        "system.providers",
        {
          capability: input.capability,
          environmentId: input.environmentId,
          hostId: input.hostId,
        },
        input.signal,
      ),
    models: (input = {}) => readExecutionOptions(operations, input),
  };
}
