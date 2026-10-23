import { z } from "zod";
import {
  environmentSchema,
  workspaceDescriptorSchema,
  type WorkspaceDescriptor,
  type Environment,
  type EnvironmentStatus,
} from "@bb/domain";
import {
  commitActionResponseSchema,
  updateEnvironmentRequestSchema,
} from "@bb/server-contract";
import type {
  CommitActionResponse,
  EnvironmentArchiveThreadsResponse,
  EnvironmentDiffBranchesQuery,
  EnvironmentDiffBranchesResponse,
  EnvironmentDiffFileQuery,
  EnvironmentDiffFileResponse,
  EnvironmentDiffPatchRequest,
  EnvironmentDiffPatchResponse,
  EnvironmentDiffQuery,
  EnvironmentDiffResponse,
  EnvironmentDiffFilesResponse,
  EnvironmentDiffViewedClearRequest,
  EnvironmentDiffViewedMarkRequest,
  EnvironmentDiffViewedResponse,
  EnvironmentPathsQuery,
  EnvironmentStatusResponse,
  EnvironmentStatusQuery,
  UpdateEnvironmentRequest,
  WorkspacePathListResponse,
  SystemEnvironmentProvider,
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

export interface EnvironmentStatusArgs extends EnvironmentStatusQuery {
  environmentId: string;
  signal?: AbortSignal;
}

export type EnvironmentDiffArgs = EnvironmentDiffQuery & {
  environmentId: string;
  signal?: AbortSignal;
};

export type EnvironmentDiffFilesArgs = EnvironmentDiffArgs & {
  ignoreWhitespace?: boolean;
};

export type EnvironmentDiffFileArgs = EnvironmentDiffFileQuery & {
  environmentId: string;
  signal?: AbortSignal;
};

export interface EnvironmentDiffBranchesArgs extends EnvironmentDiffBranchesQuery {
  environmentId: string;
  signal?: AbortSignal;
}

export interface EnvironmentCommitArgs {
  environmentId: string;
}

export type EnvironmentDiffPatchArgs = EnvironmentDiffPatchRequest & {
  environmentId: string;
  signal?: AbortSignal;
};

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
export type EnvironmentDiffResult = EnvironmentDiffResponse;
export type EnvironmentDiffBranchesResult = EnvironmentDiffBranchesResponse;
export type EnvironmentDiffFileResult = EnvironmentDiffFileResponse;
export type EnvironmentDiffFilesResult = EnvironmentDiffFilesResponse;
export type EnvironmentDiffPatchResult = EnvironmentDiffPatchResponse;
export type EnvironmentDiffViewedResult = EnvironmentDiffViewedResponse;
export type EnvironmentGetResult = Environment;
export type EnvironmentPathsResult = WorkspacePathListResponse;
export type EnvironmentStatusResult = EnvironmentStatusResponse;
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
  experimental_describeWorkspace(
    args: EnvironmentGetArgs,
  ): Promise<WorkspaceDescriptor>;
  experimental_cleanup(
    args: EnvironmentActionArgs & { recover?: boolean },
  ): Promise<{ ok: true }>;
  archiveThreads(
    args: EnvironmentActionArgs,
  ): Promise<EnvironmentArchiveThreadsResult>;
  commit(args: EnvironmentCommitArgs): Promise<EnvironmentCommitResult>;
  diff(args: EnvironmentDiffArgs): Promise<EnvironmentDiffResult>;
  diffBranches(
    args: EnvironmentDiffBranchesArgs,
  ): Promise<EnvironmentDiffBranchesResult>;
  diffFile(args: EnvironmentDiffFileArgs): Promise<EnvironmentDiffFileResult>;
  diffFiles(
    args: EnvironmentDiffFilesArgs,
  ): Promise<EnvironmentDiffFilesResult>;
  diffPatch(
    args: EnvironmentDiffPatchArgs,
  ): Promise<EnvironmentDiffPatchResult>;
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
  status(args: EnvironmentStatusArgs): Promise<EnvironmentStatusResult>;
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

function environmentStatusQuery(
  args: EnvironmentStatusArgs,
): EnvironmentStatusQuery {
  return {
    mergeBaseBranch: args.mergeBaseBranch,
  };
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

function environmentDiffFileQuery(
  args: EnvironmentDiffFileArgs,
): EnvironmentDiffFileQuery {
  switch (args.target) {
    case "uncommitted":
      return {
        path: args.path,
        side: args.side,
        target: args.target,
      };
    case "branch_committed":
    case "all":
      return {
        mergeBaseRef: args.mergeBaseRef,
        path: args.path,
        side: args.side,
        target: args.target,
      };
    case "commit":
      return {
        path: args.path,
        sha: args.sha,
        side: args.side,
        target: args.target,
      };
  }
}

function environmentDiffBranchesQuery(
  args: EnvironmentDiffBranchesArgs,
): EnvironmentDiffBranchesQuery {
  return {
    ...(args.query !== undefined ? { query: args.query } : {}),
    ...(args.limit !== undefined ? { limit: args.limit } : {}),
    ...(args.selectedBranch !== undefined
      ? { selectedBranch: args.selectedBranch }
      : {}),
  };
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
  return {
    async experimental_describeWorkspace(input) {
      return workspaceDescriptorSchema.parse(
        await transport.readJson(
          transport.api.v1.environments[":id"].workspace.$get(
            { param: { id: input.environmentId } },
            ...signalRequestArgs(input.signal),
          ),
        ),
      );
    },
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
    async diff(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].diff.$get(
          {
            param: { id: input.environmentId },
            query: environmentDiffQuery(input),
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async diffBranches(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].diff.branches.$get(
          {
            param: { id: input.environmentId },
            query: environmentDiffBranchesQuery(input),
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async diffFile(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].diff.file.$get(
          {
            param: { id: input.environmentId },
            query: environmentDiffFileQuery(input),
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async diffFiles(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].diff.files.$get(
          {
            param: { id: input.environmentId },
            query: {
              ...environmentDiffQuery(input),
              ...(input.ignoreWhitespace === true
                ? { ignoreWhitespace: "true" as const }
                : {}),
            },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async diffPatch(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].diff.patch.$post(
          {
            param: { id: input.environmentId },
            json: {
              paths: input.paths,
              target: input.target,
              ignoreWhitespace: input.ignoreWhitespace,
            },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
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
    async status(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].status.$get(
          {
            param: { id: input.environmentId },
            query: environmentStatusQuery(input),
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
}
