import type { Host } from "@bb/domain";
import type {
  CreateHostJoinRequest,
  CreateHostJoinResponse,
  UpdateHostRequest,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs, OkResponse } from "./common.js";

export interface HostGetArgs {
  hostId: string;
}

export interface HostUpdateArgs extends UpdateHostRequest {
  hostId: string;
}

export interface HostDeleteArgs {
  hostId: string;
}

export type HostJoinArgs = CreateHostJoinRequest;

export interface HostCancelJoinArgs {
  hostId: string;
}

export interface HostsArea {
  cancelJoin(args: HostCancelJoinArgs): Promise<OkResponse>;
  createJoin(args: HostJoinArgs): Promise<CreateHostJoinResponse>;
  delete(args: HostDeleteArgs): Promise<OkResponse>;
  get(args: HostGetArgs): Promise<Host>;
  list(): Promise<Host[]>;
  update(args: HostUpdateArgs): Promise<Host>;
}

function hostUpdateJson(args: HostUpdateArgs): UpdateHostRequest {
  return {
    ...(args.name !== undefined ? { name: args.name } : {}),
  };
}

export function createHostsArea(args: CreateSdkAreaArgs): HostsArea {
  const { transport } = args;
  return {
    async cancelJoin(input) {
      await transport.readVoid(
        transport.api.v1.hosts[":id"].join.$delete({
          param: { id: input.hostId },
        }),
      );
      return { ok: true };
    },
    async createJoin(input) {
      return transport.readJson(
        transport.api.v1.hosts.join.$post({
          json: input,
        }),
      );
    },
    async delete(input) {
      await transport.readVoid(
        transport.api.v1.hosts[":id"].$delete({
          param: { id: input.hostId },
        }),
      );
      return { ok: true };
    },
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
    async update(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"].$patch({
          param: { id: input.hostId },
          json: hostUpdateJson(input),
        }),
      );
    },
  };
}
