import type {
  CockpitActionRequest,
  CockpitDiscovery,
  CockpitDiscoveryQuery,
  CockpitReceipt,
} from "@bb/domain";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

export interface CockpitDiscoverArgs {
  hostId?: string | null;
  signal?: AbortSignal;
}

export type CockpitDiscoverResult = CockpitDiscovery;
export type CockpitActResult = CockpitReceipt;

export interface CockpitArea {
  discover(args?: CockpitDiscoverArgs): Promise<CockpitDiscoverResult>;
  act(args: CockpitActionRequest): Promise<CockpitActResult>;
}

export function createCockpitArea(args: CreateSdkAreaArgs): CockpitArea {
  const { transport } = args;
  return {
    async discover(input) {
      const query: {
        hostId?: string;
      } =
        input?.hostId === undefined || input.hostId === null
          ? {}
          : { hostId: input.hostId };
      return transport.readJson(
        transport.api.v1.cockpit.$get(
          { query },
          ...signalRequestArgs(input?.signal),
        ),
      );
    },
    async act(input) {
      return transport.readJson(
        transport.api.v1.cockpit.actions.$post({ json: input }),
      );
    },
  };
}

export type { CockpitActionRequest, CockpitDiscovery, CockpitDiscoveryQuery };
