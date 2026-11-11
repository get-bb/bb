import { createPluginsArea } from "./plugins.js";
import { createRetiredEnvironmentMembers } from "./retired-environment-members.js";
import { z } from "zod";
import {
  environmentSchema,
  type Environment,
  type EnvironmentStatus,
} from "@bb/domain";
import {
  commitActionResponseSchema,
  updateEnvironmentRequestSchema,
  type CommitActionResponse,
  type EnvironmentArchiveThreadsResponse,
  type EnvironmentPathsQuery,
  type UpdateEnvironmentRequest,
  type WorkspacePathListResponse,
  type SystemEnvironmentProvider,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs } from "./common.js";

export interface EnvironmentActionArgs {
  environmentId: string;
}

export interface EnvironmentGetArgs extends EnvironmentActionArgs {
  signal?: AbortSignal;
}

type EnvironmentMergeBaseBranchUpdateValue = Exclude<
  UpdateEnvironmentRequest["mergeBaseBranch"],
  undefined
>;

type EnvironmentNameUpdateValue = Exclude<
  UpdateEnvironmentRequest["name"],
  undefined
>;

interface EnvironmentMergeBaseBranchUpdate {
  mergeBaseBranch: EnvironmentMergeBaseBranchUpdateValue;
  name?: EnvironmentNameUpdateValue;
}

interface EnvironmentNameUpdate {
  mergeBaseBranch?: EnvironmentMergeBaseBranchUpdateValue;
  name: EnvironmentNameUpdateValue;
}

type EnvironmentUpdateFields =
  | EnvironmentMergeBaseBranchUpdate
  | EnvironmentNameUpdate;

export type EnvironmentUpdateArgs = EnvironmentUpdateFields & {
  environmentId: string;
};

export interface EnvironmentCommitArgs {
  environmentId: string;
}

export interface EnvironmentPathsArgs extends EnvironmentPathsQuery {
  environmentId: string;
  signal?: AbortSignal;
}

export type EnvironmentArchiveThreadsResult = EnvironmentArchiveThreadsResponse;
export type EnvironmentCommitResult = CommitActionResponse;
export type EnvironmentGetResult = Environment;
export type EnvironmentPathsResult = WorkspacePathListResponse;
export type EnvironmentUpdateResult = Environment;
export interface EnvironmentListArgs {
  environmentProviderId?: string;
  hostId?: string;
  instanceKey?: string;
  limit?: number;
  offset?: number;
  path?: string;
  projectId?: string;
  signal?: AbortSignal;
  status?: EnvironmentStatus;
}
export type EnvironmentListResult = Environment[];
export interface EnvironmentDeleteArgs {
  environmentId: string;
}
export type EnvironmentDeleteResult = { ok: true };
export interface EnvironmentListProvidersArgs {
  projectId?: string;
  hostId?: string;
  signal?: AbortSignal;
}
export type EnvironmentListProvidersResult = SystemEnvironmentProvider[];

const okResponseSchema = z.object({ ok: z.literal(true) });

export interface EnvironmentsArea {
  experimental_cleanup(
    args: EnvironmentActionArgs & { recover?: boolean },
  ): Promise<{ ok: true }>;
  archiveThreads(
    args: EnvironmentActionArgs,
  ): Promise<EnvironmentArchiveThreadsResult>;
  commit(args: EnvironmentCommitArgs): Promise<EnvironmentCommitResult>;
  get(args: EnvironmentGetArgs): Promise<EnvironmentGetResult>;
  list(args?: EnvironmentListArgs): Promise<EnvironmentListResult>;
  listProviders(
    args?: EnvironmentListProvidersArgs,
  ): Promise<EnvironmentListProvidersResult>;
  delete(args: EnvironmentDeleteArgs): Promise<EnvironmentDeleteResult>;
  paths(args: EnvironmentPathsArgs): Promise<EnvironmentPathsResult>;
  update(args: EnvironmentUpdateArgs): Promise<EnvironmentUpdateResult>;
}

function environmentUpdateJson(
  args: EnvironmentUpdateArgs,
): UpdateEnvironmentRequest {
  const request: UpdateEnvironmentRequest = {};
  if (args.mergeBaseBranch !== undefined) {
    request.mergeBaseBranch = args.mergeBaseBranch;
  }
  if (args.name !== undefined) {
    request.name = args.name;
  }
  return updateEnvironmentRequestSchema.parse(request);
}

function environmentPathsQuery(
  args: EnvironmentPathsArgs,
): EnvironmentPathsQuery {
  return {
    includeDirectories: args.includeDirectories,
    includeFiles: args.includeFiles,
    limit: args.limit,
    query: args.query,
  };
}

export function createEnvironmentsArea(
  args: CreateSdkAreaArgs,
): EnvironmentsArea {
  const { call } = args.operations;
  const area: EnvironmentsArea = {
    archiveThreads: ({ environmentId }) =>
      call("environments.archiveThreads", { id: environmentId }),
    async commit({ environmentId }) {
      const body = await call("environments.actions", {
        id: environmentId,
        action: "commit",
      });
      return commitActionResponseSchema.parse(body);
    },
    list: (input) =>
      call(
        "environments.list",
        {
          ...(input?.projectId === undefined
            ? {}
            : { projectId: input.projectId }),
          ...(input?.hostId === undefined ? {} : { hostId: input.hostId }),
          ...(input?.environmentProviderId === undefined
            ? {}
            : { environmentProviderId: input.environmentProviderId }),
          ...(input?.instanceKey === undefined
            ? {}
            : { instanceKey: input.instanceKey }),
          ...(input?.status === undefined ? {} : { status: input.status }),
          ...(input?.path === undefined ? {} : { path: input.path }),
          ...(input?.limit === undefined ? {} : { limit: String(input.limit) }),
          ...(input?.offset === undefined
            ? {}
            : { offset: String(input.offset) }),
        },
        { signal: input?.signal },
      ),
    async listProviders(input) {
      const response = await call(
        "system.environmentProviders",
        {
          ...(input?.projectId === undefined
            ? {}
            : { projectId: input.projectId }),
          ...(input?.hostId === undefined ? {} : { hostId: input.hostId }),
        },
        { signal: input?.signal },
      );
      return response.providers;
    },
    experimental_cleanup: ({ environmentId, recover }) =>
      call("environments.cleanup", {
        id: environmentId,
        recover: recover === true ? "true" : "false",
      }),
    async delete({ environmentId }) {
      return okResponseSchema.parse(
        await call("environments.delete", { id: environmentId }),
      );
    },
    async get({ environmentId, signal }) {
      return environmentSchema.parse(
        await call("environments.get", { id: environmentId }, { signal }),
      );
    },
    paths: (input) =>
      call(
        "environments.paths",
        { id: input.environmentId, ...environmentPathsQuery(input) },
        { signal: input.signal },
      ),
    async update(input) {
      return call("environments.update", {
        id: input.environmentId,
        ...environmentUpdateJson(input),
      });
    },
  };
  return Object.assign(
    area,
    createRetiredEnvironmentMembers(createPluginsArea(args).callRpc),
  );
}
