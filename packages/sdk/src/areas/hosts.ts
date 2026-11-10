import {
  hostProviderCliInstallJobListResponseSchema,
  hostProviderCliInstallJobResponseSchema,
  oldServerCopyDeleteJobResponseSchema,
  type HostProviderCliInstallJob,
  type OldServerCopyDeleteJob,
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
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

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
  const { transport } = args;

  async function startProviderCliInstall(
    input: HostProviderCliInstallArgs,
  ): Promise<HostProviderCliInstallJob> {
    const response = await transport.readJson(
      transport.api.v1.hosts[":id"]["provider-clis"]["install-jobs"].$post(
        {
          param: { id: input.hostId },
          json: { provider: input.provider, actionKind: input.actionKind },
        },
        ...signalRequestArgs(input.signal),
      ),
    );
    return hostProviderCliInstallJobResponseSchema.parse(response).job;
  }

  const providerCliInstallJobs: HostProviderCliInstallJobsArea = {
    async list(input) {
      const response = await transport.readJson(
        transport.api.v1.hosts[":id"]["provider-clis"]["install-jobs"].$get(
          { param: { id: input.hostId } },
          ...signalRequestArgs(input.signal),
        ),
      );
      return hostProviderCliInstallJobListResponseSchema.parse(response).jobs;
    },
    async get(input) {
      const response = await transport.readJson(
        transport.api.v1.hosts[":id"]["provider-clis"]["install-jobs"][
          ":jobId"
        ].$get(
          { param: { id: input.hostId, jobId: input.jobId } },
          ...signalRequestArgs(input.signal),
        ),
      );
      return hostProviderCliInstallJobResponseSchema.parse(response).job;
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
      let host = await transport.readJson(
        transport.api.v1.hosts.$post(
          {
            json: {
              machineProviderId: input.machineProviderId,
              inputs: input.inputs,
              ...(input.key === undefined ? {} : { key: input.key }),
            },
          },
          ...signalRequestArgs(input.signal),
        ),
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
    async experimental_getEnrollmentCommand(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"]["enrollment-command"].$get(
          {
            param: { id: input.hostId },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async experimental_reconnect(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"]["reconnect-commands"].$post(
          { param: { id: input.hostId } },
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
          query: input.force ? { force: "true" } : {},
        }),
      );
      return { ok: true };
    },
    async experimental_deleteOldServerCopy(input) {
      const jobs = transport.api.v1.hosts[":id"]["old-server-copy"][
        "delete-jobs"
      ];
      const read = async (jobId: string): Promise<OldServerCopyDeleteJob> =>
        oldServerCopyDeleteJobResponseSchema.parse(
          await transport.readJson(
            jobs[":jobId"].$get({ param: { id: input.hostId, jobId } }),
          ),
        ).job;
      const started = oldServerCopyDeleteJobResponseSchema.parse(
        await transport.readJson(
          jobs.$post({ param: { id: input.hostId } }),
        ),
      ).job;
      const job = await waitForJob({
        job: started,
        isActive: (current) => current.state === "running",
        read: () => read(started.id),
        intervalMs: JOB_POLL_INTERVAL_MS,
      });
      if (job.state === "completed") return { deleted: job.deleted };
      throw new Error(
        job.state === "failed" ? job.error : "Deleting the old copy did not finish",
      );
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
    async experimental_discoverRepos(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"]["discovered-repos"].$get(
          { param: { id: input.hostId } },
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
    async list(input) {
      return transport.readJson(
        transport.api.v1.hosts.$get(
          {
            query: {
              ...(input?.includeCreating === undefined
                ? {}
                : {
                    includeCreating: input.includeCreating ? "true" : "false",
                  }),
              ...(input?.type === undefined ? {} : { type: input.type }),
            },
          },
          ...signalRequestArgs(input?.signal),
        ),
      );
    },
    async experimental_listProviders(input) {
      const response = await transport.readJson(
        transport.api.v1.system["machine-providers"].$get(
          {},
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
            query: input.refresh ? { refresh: "true" } : {},
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async experimental_resume(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"].resume.$post({
          param: { id: input.hostId },
        }),
      );
    },
    async experimental_retryCleanup(input) {
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
    async experimental_reconcile(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"].reconcile.$post({
          param: { id: input.hostId },
        }),
      );
    },
    async experimental_suspend(input) {
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
