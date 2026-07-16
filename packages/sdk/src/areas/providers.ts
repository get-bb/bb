import type {
  SystemExecutionOptionsResponse,
  SystemProviderInfo,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs } from "./common.js";

/** Select exactly one provider-discovery host source, or omit both for primary. */
export type ProviderHostRoutingArgs =
  | { environmentId: string; hostId?: never }
  | { environmentId?: never; hostId: string }
  | { environmentId?: never; hostId?: never };

export type ProviderListArgs = ProviderHostRoutingArgs & {
  signal?: AbortSignal;
};
export type ProviderModelsArgs = ProviderHostRoutingArgs & {
  providerId?: string;
  signal?: AbortSignal;
};

export type ProviderListResult = SystemProviderInfo[];
export type ProviderModelsResult = SystemExecutionOptionsResponse;

export interface ProvidersArea {
  /** List providers on the environment host, explicit host, or primary host. */
  list(args?: ProviderListArgs): Promise<ProviderListResult>;
  /** List models on the environment host, explicit host, or primary host. */
  models(args?: ProviderModelsArgs): Promise<ProviderModelsResult>;
}

export function createProvidersArea(args: CreateSdkAreaArgs): ProvidersArea {
  const { transport } = args;
  return {
    async list(input = {}) {
      return transport.readJson(
        transport.api.v1.system.providers.$get(
          {
            query: {
              environmentId: input.environmentId,
              hostId: input.hostId,
            },
          },
          { init: { signal: input.signal } },
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
          { init: { signal: input.signal } },
        ),
      );
    },
  };
}
