import type {
  experimental_HostLifecycleRequest,
  experimental_HostLifecycleResponse,
  experimental_HostReadinessRequest,
  experimental_HostReadinessResponse,
} from "@bb/server-contract";
import { hostProviderCliInstallEventSchema } from "@bb/server-contract";
import type { Host, JsonValue } from "@bb/domain";
import type {
  CreateHostJoinCodeResponse,
  CreateMachineRequest,
  MachineLaunchStatus,
  HostCloneDefaultPathQuery,
  HostCloneDefaultPathResponse,
  HostDirectoryListing,
  HostDirectoryQuery,
  HostActionResponse,
  HostPathsExistRequest,
  HostPathsExistResponse,
  HostPickFolderRequest,
  HostPickFolderResponse,
  HostProviderCliInstallEvent,
  HostProviderCliInstallRequest,
  HostProviderCliStatusResponse,
  HostRetryUpdateResponse,
  UpdateHostRequest,
  SystemMachineProvider,
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

export interface HostRetryUpdateArgs {
  hostId: string;
}

export interface HostActionArgs {
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

export interface MachineCreateArgs extends CreateMachineRequest {
  signal?: AbortSignal;
}

export interface MachineProviderListArgs {
  projectId?: string;
  signal?: AbortSignal;
}

export type HostCreateJoinCodeResult = CreateHostJoinCodeResponse;
export type HostDeleteResult = { ok: true };
export type HostDirectoryResult = HostDirectoryListing;
export type HostGetResult = Host & { connectMachineId: string | null };
export type HostCloneDefaultPathResult = HostCloneDefaultPathResponse;
export type HostProviderCliInstallResult = HostProviderCliInstallEvent[];
export type HostListResult = Host[];
export type HostPathsExistResult = HostPathsExistResponse;
export type HostPickFolderResult = HostPickFolderResponse;
export type HostProviderCliStatusResult = HostProviderCliStatusResponse;
export type HostRetryUpdateResult = HostRetryUpdateResponse;
export type HostActionResult = HostActionResponse;
export type HostUpdateResult = Host;
export type MachineProviderListResult = SystemMachineProvider[];

export interface HostsArea {
  experimental_providerDetails(
    args: HostGetArgs,
  ): Promise<{ summary: string; values: JsonValue } | null>;
  experimental_lifecycle(
    args: experimental_HostLifecycleRequest & { hostId: string },
  ): Promise<experimental_HostLifecycleResponse>;
  experimental_ensureReady(
    args: experimental_HostReadinessRequest & { hostId: string },
  ): Promise<experimental_HostReadinessResponse>;
  create(args: MachineCreateArgs): Promise<Host>;
  submit(args: MachineCreateArgs): Promise<MachineLaunchStatus>;
  launch(args: {
    id: string;
    signal?: AbortSignal;
  }): Promise<MachineLaunchStatus>;
  experimental_enrollmentCommand(args: {
    id: string;
    scope?: "launch" | "thread";
    signal?: AbortSignal;
  }): Promise<{ command: string | null; expiresAt: number | null }>;
  cancel(args: { id: string }): Promise<MachineLaunchStatus>;
  follow(args: {
    id: string;
    signal?: AbortSignal;
    onProgress?: (status: MachineLaunchStatus) => void;
  }): Promise<Host>;
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
  listProviders(
    args?: MachineProviderListArgs,
  ): Promise<MachineProviderListResult>;
  pathsExist(args: HostPathsExistArgs): Promise<HostPathsExistResult>;
  pickFolder(args: HostPickFolderArgs): Promise<HostPickFolderResult>;
  providerCliStatus(args: HostGetArgs): Promise<HostProviderCliStatusResult>;
  resume(args: HostActionArgs): Promise<HostActionResult>;
  retryCleanup(args: HostActionArgs): Promise<HostActionResult>;
  retryUpdate(args: HostRetryUpdateArgs): Promise<HostRetryUpdateResult>;
  suspend(args: HostActionArgs): Promise<HostActionResult>;
  update(args: HostUpdateArgs): Promise<HostUpdateResult>;
}

export function createHostsArea(args: CreateSdkAreaArgs): HostsArea {
  const { transport } = args;
  return {
    async experimental_providerDetails(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"]["provider-details"].$get(
          { param: { id: input.hostId } },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async experimental_lifecycle(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"].lifecycle.$post({
          param: { id: input.hostId },
          json: { keep: input.keep },
        }),
      );
    },
    async experimental_ensureReady(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"].ready.$post({
          param: { id: input.hostId },
          json: { providerId: input.providerId, projectId: input.projectId },
        }),
      );
    },
    async create(input) {
      const launch = await this.submit(input);
      return this.follow({ id: launch.id, signal: input.signal });
    },
    async launch(input) {
      return transport.readJson(
        transport.api.v1.hosts.launches[":id"].$get(
          { param: { id: input.id } },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async experimental_enrollmentCommand(input) {
      return transport.readJson(
        transport.api.v1.hosts.launches[":id"]["enrollment-command"].$get(
          { param: { id: input.id }, query: { scope: input.scope } },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async cancel(input) {
      return transport.readJson(
        transport.api.v1.hosts.launches[":id"].cancel.$post({
          param: { id: input.id },
        }),
      );
    },
    async follow(input) {
      for (;;) {
        input.signal?.throwIfAborted();
        const status = await this.launch(input);
        input.onProgress?.(status);
        if (status.phase === "ready" && status.hostId !== null)
          return this.get({ hostId: status.hostId, signal: input.signal });
        if (status.terminal)
          throw new Error(status.message ?? "Machine creation cancelled");
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      }
    },
    async submit(input) {
      return transport.readJson(
        transport.api.v1.hosts.$post(
          {
            json: {
              machineProviderId: input.machineProviderId,
              projectId: input.projectId,
              inputs: input.inputs,
              ...(input.key === undefined ? {} : { key: input.key }),
            },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async createJoinCode() {
      return transport.readJson(
        transport.api.v1.hosts["join-codes"].$post({
          json: {},
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
      const text: string = await response.text();
      return text
        .split(/\r?\n/u)
        .filter((line) => line.trim().length > 0)
        .map((line) =>
          hostProviderCliInstallEventSchema.parse(JSON.parse(line)),
        );
    },
    async list(input) {
      return transport.readJson(
        transport.api.v1.hosts.$get({}, ...signalRequestArgs(input?.signal)),
      );
    },
    async listProviders(input) {
      const response = await transport.readJson(
        transport.api.v1.system["machine-providers"].$get(
          {
            query:
              input?.projectId === undefined
                ? {}
                : { projectId: input.projectId },
          },
          ...signalRequestArgs(input?.signal),
        ),
      );
      return response.providers;
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
    async resume(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"].resume.$post({
          param: { id: input.hostId },
        }),
      );
    },
    async retryCleanup(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"]["retry-cleanup"].$post({
          param: { id: input.hostId },
        }),
      );
    },
    async retryUpdate(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"]["retry-update"].$post({
          param: { id: input.hostId },
        }),
      );
    },
    async suspend(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"].suspend.$post({
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
