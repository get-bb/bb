import type {
  SystemExecutionOptionsResponse,
  SystemProviderInfo,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs } from "./common.js";

export interface ProviderListArgs {
  environmentId?: string;
  hostId?: string;
}

export interface ProviderModelsArgs extends ProviderListArgs {
  providerId?: string;
}

export interface ProvidersArea {
  list(args?: ProviderListArgs): Promise<SystemProviderInfo[]>;
  models(args?: ProviderModelsArgs): Promise<SystemExecutionOptionsResponse>;
}

export function createProvidersArea(args: CreateSdkAreaArgs): ProvidersArea {
  const { transport } = args;
  return {
    async list(input = {}) {
      return transport.readJson(
        transport.api.v1.system.providers.$get({
          query: input,
        }),
      );
    },
    async models(input = {}) {
      return transport.readJson(
        transport.api.v1.system["execution-options"].$get({
          query: input,
        }),
      );
    },
  };
}
