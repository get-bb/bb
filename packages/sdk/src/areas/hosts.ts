import type { CreateSdkAreaArgs, PublicApiOutput } from "./common.js";

export interface HostGetArgs {
  hostId: string;
}

export type HostGetResult = PublicApiOutput<"/hosts/:id", "$get">;
export type HostListResult = PublicApiOutput<"/hosts", "$get">;

export interface HostsArea {
  get(args: HostGetArgs): Promise<HostGetResult>;
  list(): Promise<HostListResult>;
}

export function createHostsArea(args: CreateSdkAreaArgs): HostsArea {
  const { transport } = args;
  return {
    async get(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"].$get({
          param: { id: input.hostId },
        }),
      );
    },
    async list() {
      return transport.readJson(transport.api.v1.hosts.$get());
    },
  };
}
