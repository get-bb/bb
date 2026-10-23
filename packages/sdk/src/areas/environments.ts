import { createPluginsArea } from "./plugins.js";
import { createRetiredEnvironmentReads } from "./retired-environment-reads.js";
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
  type EnvironmentDiffQuery,
  type EnvironmentDiffViewedClearRequest,
  type EnvironmentDiffViewedMarkRequest,
  type EnvironmentDiffViewedResponse,
  type EnvironmentPathsQuery,
  type UpdateEnvironmentRequest,
  type WorkspacePathListResponse,
  type SystemEnvironmentProvider,
} from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

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

export type EnvironmentDiffArgs = EnvironmentDiffQuery & {
  environmentId: string;
  signal?: AbortSignal;
};

export interface EnvironmentCommitArgs {
  environmentId: string;
}

export type EnvironmentDiffViewedMarkArgs = EnvironmentDiffViewedMarkRequest & {
  environmentId: string;
};

export type EnvironmentDiffViewedClearArgs =
  EnvironmentDiffViewedClearRequest & {
    environmentId: string;
  };

export interface EnvironmentPathsArgs extends EnvironmentPathsQuery {
  environmentId: string;
  signal?: AbortSignal;
}

export type EnvironmentArchiveThreadsResult = EnvironmentArchiveThreadsResponse;
export type EnvironmentCommitResult = CommitActionResponse;
export type EnvironmentDiffViewedResult = EnvironmentDiffViewedResponse;
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
  experimental_diffViewed(
    args: EnvironmentDiffArgs & { paths?: string[] },
  ): Promise<EnvironmentDiffViewedResult>;
  experimental_markDiffViewed(
    args: EnvironmentDiffViewedMarkArgs,
  ): Promise<{ ok: true }>;
  experimental_clearDiffViewed(
    args: EnvironmentDiffViewedClearArgs,
  ): Promise<{ ok: true }>;
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

function environmentDiffQuery(args: EnvironmentDiffArgs): EnvironmentDiffQuery {
  switch (args.target) {
    case "uncommitted":
      return { target: args.target };
    case "branch_committed":
    case "all":
      return { target: args.target, mergeBaseBranch: args.mergeBaseBranch };
    case "commit":
      return { target: args.target, sha: args.sha };
  }
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
  const { transport } = args;
  const area: EnvironmentsArea = {
    async archiveThreads(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"]["archive-threads"].$post({
          param: { id: input.environmentId },
        }),
      );
    },
    async commit(input) {
      const body = await transport.readJson(
        transport.api.v1.environments[":id"].actions.$post({
          param: { id: input.environmentId },
          json: {
            action: "commit",
          },
        }),
      );
      return commitActionResponseSchema.parse(body);
    },
    async experimental_diffViewed(input) {
      if (input.paths !== undefined) {
        return transport.readJson(
          transport.api.v1.environments[":id"].diff.viewed.$post(
            {
              param: { id: input.environmentId },
              json: { ...environmentDiffQuery(input), paths: input.paths },
            },
            ...signalRequestArgs(input.signal),
          ),
        );
      }
      return transport.readJson(
        transport.api.v1.environments[":id"].diff.viewed.$get(
          {
            param: { id: input.environmentId },
            query: environmentDiffQuery(input),
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async experimental_markDiffViewed(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].diff.viewed.$put({
          param: { id: input.environmentId },
          json: {
            target: input.target,
            path: input.path,
            revision: input.revision,
          },
        }),
      );
    },
    async experimental_clearDiffViewed(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].diff.viewed.$delete({
          param: { id: input.environmentId },
          json: { target: input.target, path: input.path },
        }),
      );
    },
    async list(input) {
      return transport.readJson(
        transport.api.v1.environments.$get(
          {
            query: {
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
              ...(input?.limit === undefined
                ? {}
                : { limit: String(input.limit) }),
              ...(input?.offset === undefined
                ? {}
                : { offset: String(input.offset) }),
            },
          },
          ...signalRequestArgs(input?.signal),
        ),
      );
    },
    async listProviders(input) {
      const response = await transport.readJson(
        transport.api.v1.system["environment-providers"].$get(
          {
            query: {
              ...(input?.projectId === undefined
                ? {}
                : { projectId: input.projectId }),
              ...(input?.hostId === undefined ? {} : { hostId: input.hostId }),
            },
          },
          ...signalRequestArgs(input?.signal),
        ),
      );
      return response.providers;
    },
    async experimental_cleanup(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"]["cleanup"].$post({
          param: { id: input.environmentId },
          query: { recover: input.recover === true ? "true" : "false" },
        }),
      );
    },
    async delete(input) {
      const body = await transport.readJson(
        transport.api.v1.environments[":id"].$delete({
          param: { id: input.environmentId },
        }),
      );
      return okResponseSchema.parse(body);
    },
    async get(input) {
      const body = await transport.readJson(
        transport.api.v1.environments[":id"].$get(
          {
            param: { id: input.environmentId },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
      return environmentSchema.parse(body);
    },
    async paths(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].paths.$get(
          {
            param: { id: input.environmentId },
            query: environmentPathsQuery(input),
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async update(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].$patch({
          param: { id: input.environmentId },
          json: environmentUpdateJson(input),
        }),
      );
    },
  };
  return Object.assign(
    area,
    createRetiredEnvironmentReads(createPluginsArea(args).callRpc),
  );
}
