import { hostProviderCliInstallEventSchema } from "@bb/server-contract";
import type { Host } from "@bb/domain";
import type {
  CreateHostJoinCodeResponse,
  HostCloneDefaultPathQuery,
  HostCloneDefaultPathResponse,
  HostDirectoryListing,
  HostDirectoryQuery,
  HostPathsExistRequest,
  HostPathsExistResponse,
  HostPickFolderRequest,
  HostPickFolderResponse,
  HostProviderCliInstallEvent,
  HostProviderCliInstallRequest,
  HostProviderCliStatusResponse,
  UpdateHostRequest,
} from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

export interface HostGetArgs {
  hostId: string;
  signal?: AbortSignal;
}

export interface HostDeleteArgs {
  hostId: string;
}

export interface HostUpdateArgs extends UpdateHostRequest {
  hostId: string;
}

export interface HostDirectoryArgs extends HostDirectoryQuery {
  hostId: string;
  signal?: AbortSignal;
}

export interface HostCloneDefaultPathArgs extends HostCloneDefaultPathQuery {
  hostId: string;
  signal?: AbortSignal;
}

export interface HostPathsExistArgs extends HostPathsExistRequest {
  hostId: string;
  signal?: AbortSignal;
}

export interface HostPickFolderArgs extends HostPickFolderRequest {
  hostId: string;
  signal?: AbortSignal;
}

export interface HostProviderCliInstallArgs extends HostProviderCliInstallRequest {
  hostId: string;
}

export interface HostListArgs {
  signal?: AbortSignal;
}

export type HostCreateJoinCodeResult = CreateHostJoinCodeResponse;
export type HostDeleteResult = { ok: true };
export type HostDirectoryResult = HostDirectoryListing;
export type HostGetResult = Host;
export type HostCloneDefaultPathResult = HostCloneDefaultPathResponse;
export type HostProviderCliInstallResult = HostProviderCliInstallEvent[];
export type HostListResult = Host[];
export type HostPathsExistResult = HostPathsExistResponse;
export type HostPickFolderResult = HostPickFolderResponse;
export type HostProviderCliStatusResult = HostProviderCliStatusResponse;
export type HostUpdateResult = Host;

export interface HostsArea {
  createJoinCode(): Promise<HostCreateJoinCodeResult>;
  delete(args: HostDeleteArgs): Promise<HostDeleteResult>;
  directory(args: HostDirectoryArgs): Promise<HostDirectoryResult>;
  get(args: HostGetArgs): Promise<HostGetResult>;
  cloneDefaultPath(
    args: HostCloneDefaultPathArgs,
  ): Promise<HostCloneDefaultPathResult>;
  installProviderCli(
    args: HostProviderCliInstallArgs,
  ): Promise<HostProviderCliInstallResult>;
  list(args?: HostListArgs): Promise<HostListResult>;
  pathsExist(args: HostPathsExistArgs): Promise<HostPathsExistResult>;
  pickFolder(args: HostPickFolderArgs): Promise<HostPickFolderResult>;
  providerCliStatus(args: HostGetArgs): Promise<HostProviderCliStatusResult>;
  update(args: HostUpdateArgs): Promise<HostUpdateResult>;
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
        transport.api.v1.hosts[":id"].directory.$get(
          {
            param: { id: input.hostId },
            query: { path: input.path },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async get(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"].$get(
          {
            param: { id: input.hostId },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async cloneDefaultPath(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"]["clone-default-path"].$get(
          {
            param: { id: input.hostId },
            query: { projectId: input.projectId },
          },
          ...signalRequestArgs(input.signal),
        ),
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
    async list(input) {
      return transport.readJson(
        transport.api.v1.hosts.$get(
          {},
          ...signalRequestArgs(input?.signal),
        ),
      );
    },
    async pathsExist(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"].paths.exist.$post(
          {
            param: { id: input.hostId },
            json: { paths: input.paths },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async pickFolder(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"]["pick-folder"].$post(
          {
            param: { id: input.hostId },
            json: { clientHostId: input.clientHostId },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async providerCliStatus(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"]["provider-clis"].status.$get(
          {
            param: { id: input.hostId },
          },
          ...signalRequestArgs(input.signal),
        ),
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
