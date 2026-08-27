import type {
  SystemExecutionOptionsResponse,
  SystemProviderInfo,
  SystemProvidersQuery,
} from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

/** Select exactly one provider-discovery host source, or omit both for primary. */
export type ProviderHostRoutingArgs =
  | { environmentId: string; hostId?: never }
  | { environmentId?: never; hostId: string }
  | { environmentId?: never; hostId?: never };

export type ProviderListArgs = ProviderHostRoutingArgs & {
  capability?: SystemProvidersQuery["capability"];
  signal?: AbortSignal;
};
export type ProviderModelsArgs = ProviderHostRoutingArgs & {
  providerId?: string;
  signal?: AbortSignal;
};
export type ProviderPermissionProfilesArgs = ProviderHostRoutingArgs & {
  providerId?: string;
  signal?: AbortSignal;
};

export type ProviderListResult = SystemProviderInfo[];
export type ProviderModelsResult = SystemExecutionOptionsResponse;
export type ProviderPermissionProfilesResult =
  SystemExecutionOptionsResponse["permissionProfiles"];

export interface ProvidersArea {
  /** List providers on the environment host, explicit host, or primary host. */
  list(args?: ProviderListArgs): Promise<ProviderListResult>;
  /** List models on the environment host, explicit host, or primary host. */
  models(args?: ProviderModelsArgs): Promise<ProviderModelsResult>;
  /** List named permission profiles exposed by a provider on the target host. */
  permissionProfiles(
    args?: ProviderPermissionProfilesArgs,
  ): Promise<ProviderPermissionProfilesResult>;
}

export function createProvidersArea(args: CreateSdkAreaArgs): ProvidersArea {
  const { transport } = args;
  return {
    async list(input = {}) {
      return transport.readJson(
        transport.api.v1.system.providers.$get(
          {
            query: {
              capability: input.capability,
              environmentId: input.environmentId,
              hostId: input.hostId,
            },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async models(input = {}) {
      return transport.readJson(
        transport.api.v1.system["execution-options"].$get(
          {
            query: {
              environmentId: input.environmentId,
              hostId: input.hostId,
              providerId: input.providerId,
            },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async permissionProfiles(input = {}) {
      const executionOptions = await transport.readJson(
        transport.api.v1.system["execution-options"].$get(
          {
            query: {
              environmentId: input.environmentId,
              hostId: input.hostId,
              providerId: input.providerId,
            },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
      return executionOptions.permissionProfiles;
    },
  };
}
