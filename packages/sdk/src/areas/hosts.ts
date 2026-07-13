import { hostProviderCliInstallEventSchema } from "@bb/server-contract";
import type {
  HostCloneDefaultPathQuery,
  HostDirectoryQuery,
  HostPathsExistRequest,
  HostPickFolderRequest,
  HostProviderCliInstallRequest,
  UpdateHostRequest,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs, PublicApiOutput } from "./common.js";

export interface HostGetArgs {
  hostId: string;
}

export interface HostUpdateArgs extends UpdateHostRequest {
  hostId: string;
}

export interface HostDirectoryArgs extends HostDirectoryQuery {
  hostId: string;
}

export interface HostCloneDefaultPathArgs extends HostCloneDefaultPathQuery {
  hostId: string;
}

export interface HostPathsExistArgs extends HostPathsExistRequest {
  hostId: string;
}

export interface HostPickFolderArgs extends HostPickFolderRequest {
  hostId: string;
}

export interface HostProviderCliInstallArgs extends HostProviderCliInstallRequest {
  hostId: string;
}

export type HostGetResult = PublicApiOutput<"/hosts/:id", "$get">;
export type HostListResult = PublicApiOutput<"/hosts", "$get">;

export interface HostsArea {
  createJoinCode(): Promise<PublicApiOutput<"/hosts/join-codes", "$post">>;
  delete(args: HostGetArgs): Promise<{ ok: true }>;
  directory(
    args: HostDirectoryArgs,
  ): Promise<PublicApiOutput<"/hosts/:id/directory", "$get">>;
  get(args: HostGetArgs): Promise<HostGetResult>;
  cloneDefaultPath(
    args: HostCloneDefaultPathArgs,
  ): Promise<PublicApiOutput<"/hosts/:id/clone-default-path", "$get">>;
  installProviderCli(
    args: HostProviderCliInstallArgs,
  ): Promise<PublicApiOutput<"/hosts/:id/provider-clis/install", "$post">[]>;
  list(): Promise<HostListResult>;
  pathsExist(
    args: HostPathsExistArgs,
  ): Promise<PublicApiOutput<"/hosts/:id/paths/exist", "$post">>;
  pickFolder(
    args: HostPickFolderArgs,
  ): Promise<PublicApiOutput<"/hosts/:id/pick-folder", "$post">>;
  providerCliStatus(
    args: HostGetArgs,
  ): Promise<PublicApiOutput<"/hosts/:id/provider-clis/status", "$get">>;
  update(
    args: HostUpdateArgs,
  ): Promise<PublicApiOutput<"/hosts/:id", "$patch">>;
}

export function createHostsArea(args: CreateSdkAreaArgs): HostsArea {
  const { transport } = args;
  return {
    async createJoinCode() {
      return transport.readJson(
        transport.api.v1.hosts["join-codes"].$post({ json: {} }),
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
    async directory(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"].directory.$get({
          param: { id: input.hostId },
          query: { path: input.path },
        }),
      );
    },
    async get(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"].$get({
          param: { id: input.hostId },
        }),
      );
    },
    async cloneDefaultPath(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"]["clone-default-path"].$get({
          param: { id: input.hostId },
          query: { projectId: input.projectId },
        }),
      );
    },
    async installProviderCli(input) {
      const response = await transport.resolve(
        transport.api.v1.hosts[":id"]["provider-clis"].install.$post({
          param: { id: input.hostId },
          json: {
            provider: input.provider,
            actionKind: input.actionKind,
          },
        }),
      );
      const text = await Response.prototype.text.call(response);
      return text
        .split(/\r?\n/u)
        .filter((line) => line.trim().length > 0)
        .map((line) =>
          hostProviderCliInstallEventSchema.parse(JSON.parse(line)),
        );
    },
    async list() {
      return transport.readJson(transport.api.v1.hosts.$get());
    },
    async pathsExist(input) {
      const { hostId, ...json } = input;
      return transport.readJson(
        transport.api.v1.hosts[":id"].paths.exist.$post({
          param: { id: hostId },
          json,
        }),
      );
    },
    async pickFolder(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"]["pick-folder"].$post({
          param: { id: input.hostId },
          json: { clientHostId: input.clientHostId },
        }),
      );
    },
    async providerCliStatus(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"]["provider-clis"].status.$get({
          param: { id: input.hostId },
        }),
      );
    },
    async update(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"].$patch({
          param: { id: input.hostId },
          json: { name: input.name },
        }),
      );
    },
  };
}
