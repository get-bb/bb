import {
  hostProviderCliInstallJobListResponseSchema,
  hostProviderCliInstallJobResponseSchema,
  oldServerCopyDeleteJobResponseSchema,
  type HostProviderCliInstallJob,
} from "@bb/server-contract";
import type { Host, HostType } from "@bb/domain";
import type {
  CreateHostJoinCodeResponse,
  CreateMachineRequest,
  HostEnrollmentCommandResponse,
  HostReconnectResponse,
  HostCloneDefaultPathQuery,
  HostCloneDefaultPathResponse,
  HostDirectoryListing,
  HostDirectoryQuery,
  HostDiscoveredReposResponse,
  HostActionResponse,
  HostPathsExistRequest,
  HostPathsExistResponse,
  HostPickFolderRequest,
  HostPickFolderResponse,
  HostProviderCliInstallEvent,
  HostProviderCliInstallRequest,
  HostProviderCliStatusResponse,
  HostRetryUpdateResponse,
  DeleteOldServerCopyResponse,
  UpdateHostRequest,
  SystemMachineProvider,
} from "@bb/server-contract";
import { waitForJob } from "../job-wait.js";
import type { CreateSdkAreaArgs } from "./common.js";

const JOB_POLL_INTERVAL_MS = 1_000;

export interface HostGetArgs {
  hostId: string;
  signal?: AbortSignal;
}

export interface HostProviderCliStatusArgs extends HostGetArgs {
  refresh?: boolean;
}

export interface HostDeleteArgs {
  hostId: string;
  force?: boolean;
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

export interface HostReconnectArgs extends HostActionArgs {
  signal?: AbortSignal;
}

export interface HostDirectoryArgs extends HostDirectoryQuery {
  hostId: string;
  signal?: AbortSignal;
}

export interface HostDiscoverReposArgs {
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
  signal?: AbortSignal;
}

export interface HostProviderCliInstallJobArgs {
  hostId: string;
  jobId: string;
  signal?: AbortSignal;
}

export interface HostProviderCliInstallJobWaitArgs
  extends HostProviderCliInstallJobArgs {
  onJob?: (job: HostProviderCliInstallJob) => void;
}

export interface HostProviderCliInstallJobsArea {
  list(args: HostGetArgs): Promise<HostProviderCliInstallJob[]>;
  get(args: HostProviderCliInstallJobArgs): Promise<HostProviderCliInstallJob>;
  wait(
    args: HostProviderCliInstallJobWaitArgs,
  ): Promise<HostProviderCliInstallJob>;
}

export interface HostListArgs {
  includeCreating?: boolean;
  type?: HostType;
  signal?: AbortSignal;
}

export interface MachineCreateArgs extends CreateMachineRequest {
  wait?: boolean;
  signal?: AbortSignal;
}

export interface MachineProviderListArgs {
  signal?: AbortSignal;
}

export type HostCreateJoinCodeResult = CreateHostJoinCodeResponse;
export type HostDeleteResult = { ok: true };
export type HostDirectoryResult = HostDirectoryListing;
export type HostDiscoverReposResult = HostDiscoveredReposResponse;
export type HostGetResult = Host & {
  connectMachineId: string | null;
  threadStorageRootPath: string | null;
};
export type HostEnrollmentCommandResult = HostEnrollmentCommandResponse;
export type HostReconnectResult = HostReconnectResponse;
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
  experimental_create(args: MachineCreateArgs): Promise<Host>;
  experimental_getEnrollmentCommand(
    args: HostGetArgs,
  ): Promise<HostEnrollmentCommandResult>;
  experimental_reconnect(args: HostReconnectArgs): Promise<HostReconnectResult>;
  /** @deprecated Use experimental_create() and experimental_getEnrollmentCommand() for bootstrap enrollment. */
  createJoinCode(): Promise<HostCreateJoinCodeResult>;
  delete(args: HostDeleteArgs): Promise<HostDeleteResult>;
  experimental_deleteOldServerCopy(
    args: HostActionArgs,
  ): Promise<DeleteOldServerCopyResponse>;
  directory(args: HostDirectoryArgs): Promise<HostDirectoryResult>;
  experimental_discoverRepos(
    args: HostDiscoverReposArgs,
  ): Promise<HostDiscoverReposResult>;
  get(args: HostGetArgs): Promise<HostGetResult>;
  cloneDefaultPath(
    args: HostCloneDefaultPathArgs,
  ): Promise<HostCloneDefaultPathResult>;
  installProviderCli(
    args: HostProviderCliInstallArgs,
  ): Promise<HostProviderCliInstallResult>;
  experimental_startProviderCliInstall(
    args: HostProviderCliInstallArgs,
  ): Promise<HostProviderCliInstallJob>;
  experimental_providerCliInstallJobs: HostProviderCliInstallJobsArea;
  list(args?: HostListArgs): Promise<HostListResult>;
  experimental_listProviders(
    args?: MachineProviderListArgs,
  ): Promise<MachineProviderListResult>;
  pathsExist(args: HostPathsExistArgs): Promise<HostPathsExistResult>;
  pickFolder(args: HostPickFolderArgs): Promise<HostPickFolderResult>;
  providerCliStatus(
    args: HostProviderCliStatusArgs,
  ): Promise<HostProviderCliStatusResult>;
  experimental_resume(args: HostActionArgs): Promise<Host>;
  experimental_retryCleanup(args: HostActionArgs): Promise<HostActionResult>;
  retryUpdate(args: HostRetryUpdateArgs): Promise<HostRetryUpdateResult>;
  experimental_suspend(args: HostActionArgs): Promise<Host>;
  experimental_reconcile(args: HostActionArgs): Promise<Host>;
  update(args: HostUpdateArgs): Promise<HostUpdateResult>;
}

export function createHostsArea(args: CreateSdkAreaArgs): HostsArea {
  const { operations } = args;
  const { call, send } = operations;

  async function startProviderCliInstall(
    input: HostProviderCliInstallArgs,
  ): Promise<HostProviderCliInstallJob> {
    return hostProviderCliInstallJobResponseSchema.parse(
      await call(
        "hosts.providerCliInstallJobStart",
        {
          id: input.hostId,
          provider: input.provider,
          actionKind: input.actionKind,
        },
        { signal: input.signal },
      ),
    ).job;
  }

  const providerCliInstallJobs: HostProviderCliInstallJobsArea = {
    async list(input) {
      return hostProviderCliInstallJobListResponseSchema.parse(
        await call(
          "hosts.providerCliInstallJobList",
          { id: input.hostId },
          { signal: input.signal },
        ),
      ).jobs;
    },
    async get(input) {
      return hostProviderCliInstallJobResponseSchema.parse(
        await call(
          "hosts.providerCliInstallJobGet",
          { id: input.hostId, jobId: input.jobId },
          { signal: input.signal },
        ),
      ).job;
    },
    async wait(input) {
      return waitForJob({
        job: null,
        isActive: (job) => job.state === "running",
        read: () => providerCliInstallJobs.get(input),
        intervalMs: JOB_POLL_INTERVAL_MS,
        signal: input.signal,
        onJob: input.onJob,
      });
    },
  };

  return {
    async experimental_create(input) {
      let host = await call(
        "hosts.create",
        {
          machineProviderId: input.machineProviderId,
          inputs: input.inputs,
          ...(input.key === undefined ? {} : { key: input.key }),
        },
        { signal: input.signal },
      );
      if (input.wait === false) return host;
      for (;;) {
        input.signal?.throwIfAborted();
        if (host.lifecycle.phase === "active") return host;
        if (
          host.lifecycle.phase === "removing" ||
          host.lifecycle.phase === "destroyed"
        )
          throw new Error(
            host.lifecycle.message ?? "Machine creation cancelled",
          );
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
        host = await this.get({ hostId: host.id, signal: input.signal });
      }
    },
    experimental_getEnrollmentCommand: ({ hostId, signal }) =>
      call("hosts.enrollmentCommand", { id: hostId }, { signal }),
    experimental_reconnect: ({ hostId, signal }) =>
      call("hosts.reconnect", { id: hostId }, { signal }),
    createJoinCode: () => call("hosts.createJoinCode", {}),
    async delete({ hostId, force }) {
      await send("hosts.delete", {
        id: hostId,
        ...(force ? { force: "true" } : {}),
      });
      return { ok: true };
    },
    async experimental_deleteOldServerCopy(input) {
      const started = oldServerCopyDeleteJobResponseSchema.parse(
        await call("hosts.oldServerCopyDeleteJobStart", { id: input.hostId }),
      ).job;
      const job = await waitForJob({
        job: started,
        isActive: (current) => current.state === "running",
        read: async () =>
          oldServerCopyDeleteJobResponseSchema.parse(
            await call("hosts.oldServerCopyDeleteJobGet", {
              id: input.hostId,
              jobId: started.id,
            }),
          ).job,
        intervalMs: JOB_POLL_INTERVAL_MS,
      });
      if (job.state === "completed") return { deleted: job.deleted };
      throw new Error(
        job.state === "failed" ? job.error : "Deleting the old copy did not finish",
      );
    },
    directory: ({ hostId, path, signal }) =>
      call("hosts.directory", { id: hostId, path }, { signal }),
    experimental_discoverRepos: ({ hostId, signal }) =>
      call("hosts.discoveredRepos", { id: hostId }, { signal }),
    get: ({ hostId, signal }) => call("hosts.get", { id: hostId }, { signal }),
    cloneDefaultPath: ({ hostId, projectId, signal }) =>
      call("hosts.cloneDefaultPath", { id: hostId, projectId }, { signal }),
    async installProviderCli(input) {
      const job = await startProviderCliInstall(input);
      const settled = await providerCliInstallJobs.wait({
        hostId: input.hostId,
        jobId: job.id,
        signal: input.signal,
      });
      if (settled.state === "completed") return settled.events;
      throw new Error(
        settled.state === "failed"
          ? settled.error
          : "Provider CLI install did not finish",
      );
    },
    experimental_startProviderCliInstall: startProviderCliInstall,
    experimental_providerCliInstallJobs: providerCliInstallJobs,
    list: (input) =>
      call(
        "hosts.list",
        {
          ...(input?.includeCreating === undefined
            ? {}
            : { includeCreating: input.includeCreating ? "true" : "false" }),
          ...(input?.type === undefined ? {} : { type: input.type }),
        },
        { signal: input?.signal },
      ),
    async experimental_listProviders(input) {
      const response = await call(
        "system.machineProviders",
        {},
        { signal: input?.signal },
      );
      return response.providers;
    },
    pathsExist: ({ hostId, paths, signal }) =>
      call("hosts.pathsExist", { id: hostId, paths }, { signal }),
    pickFolder: ({ hostId, clientHostId, signal }) =>
      call("hosts.pickFolder", { id: hostId, clientHostId }, { signal }),
    providerCliStatus: ({ hostId, refresh, signal }) =>
      call(
        "hosts.providerCliStatus",
        { id: hostId, ...(refresh ? { refresh: "true" } : {}) },
        { signal },
      ),
    experimental_resume: ({ hostId }) => call("hosts.resume", { id: hostId }),
    experimental_retryCleanup: ({ hostId }) =>
      call("hosts.retryCleanup", { id: hostId }),
    retryUpdate: ({ hostId }) => call("hosts.retryUpdate", { id: hostId }),
    experimental_reconcile: ({ hostId }) =>
      call("hosts.reconcile", { id: hostId }),
    experimental_suspend: ({ hostId }) => call("hosts.suspend", { id: hostId }),
    update: ({ hostId, name }) => call("hosts.update", { id: hostId, name }),
  };
}
