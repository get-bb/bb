import { z } from "zod";
import {
  environmentSchema,
  type Environment,
  type EnvironmentStatus,
} from "@bb/domain";
import {
  commitActionResponseSchema,
  pullRequestDraftActionResponseSchema,
  pullRequestMergeActionResponseSchema,
  pullRequestReadyActionResponseSchema,
  updateEnvironmentRequestSchema,
} from "@bb/server-contract";
import type {
  CommitActionResponse,
  EnvironmentArchiveThreadsResponse,
  EnvironmentPathsQuery,
  EnvironmentPullRequestResponse,
  PullRequestMergeMethod,
  PullRequestDraftActionResponse,
  PullRequestMergeActionResponse,
  PullRequestReadyActionResponse,
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

export interface EnvironmentCommitArgs {
  environmentId: string;
}

export interface EnvironmentPullRequestMergeArgs {
  environmentId: string;
  method: PullRequestMergeMethod;
}

export interface EnvironmentPathsArgs extends EnvironmentPathsQuery {
  environmentId: string;
  signal?: AbortSignal;
}

export type EnvironmentArchiveThreadsResult = EnvironmentArchiveThreadsResponse;
export type EnvironmentCommitResult = CommitActionResponse;
export type EnvironmentGetResult = Environment;
export type EnvironmentMarkPullRequestDraftResult =
  PullRequestDraftActionResponse;
export type EnvironmentMarkPullRequestReadyResult =
  PullRequestReadyActionResponse;
export type EnvironmentMergePullRequestResult = PullRequestMergeActionResponse;
export type EnvironmentPathsResult = WorkspacePathListResponse;
export type EnvironmentPullRequestResult = EnvironmentPullRequestResponse;
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
  experimental_cleanup(args: EnvironmentActionArgs): Promise<{ ok: true }>;
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
  pullRequest(args: EnvironmentGetArgs): Promise<EnvironmentPullRequestResult>;
  markPullRequestDraft(
    args: EnvironmentActionArgs,
  ): Promise<EnvironmentMarkPullRequestDraftResult>;
  markPullRequestReady(
    args: EnvironmentActionArgs,
  ): Promise<EnvironmentMarkPullRequestReadyResult>;
  mergePullRequest(
    args: EnvironmentPullRequestMergeArgs,
  ): Promise<EnvironmentMergePullRequestResult>;
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
  const { transport } = args;
  return {
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
    async pullRequest(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"]["pull-request"].$get(
          {
            param: { id: input.environmentId },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async markPullRequestDraft(input) {
      const body = await transport.readJson(
        transport.api.v1.environments[":id"].actions.$post({
          param: { id: input.environmentId },
          json: { action: "pull_request_draft" },
        }),
      );
      return pullRequestDraftActionResponseSchema.parse(body);
    },
    async markPullRequestReady(input) {
      const body = await transport.readJson(
        transport.api.v1.environments[":id"].actions.$post({
          param: { id: input.environmentId },
          json: { action: "pull_request_ready" },
        }),
      );
      return pullRequestReadyActionResponseSchema.parse(body);
    },
    async mergePullRequest(input) {
      const body = await transport.readJson(
        transport.api.v1.environments[":id"].actions.$post({
          param: { id: input.environmentId },
          json: {
            action: "pull_request_merge",
            options: { method: input.method },
          },
        }),
      );
      return pullRequestMergeActionResponseSchema.parse(body);
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
}
