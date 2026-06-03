import { environmentSchema, type Environment } from "@bb/domain";
import {
  commitActionResponseSchema,
  squashMergeActionResponseSchema,
} from "@bb/server-contract";
import type {
  CommitActionResponse,
  EnvironmentDiffBranchesQuery,
  EnvironmentDiffBranchesResponse,
  EnvironmentDiffFileQuery,
  EnvironmentDiffFileResponse,
  EnvironmentDiffQuery,
  EnvironmentDiffResponse,
  EnvironmentStatusQuery,
  EnvironmentStatusResponse,
  SquashMergeActionResponse,
  UpdateEnvironmentRequest,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs } from "./common.js";

export interface EnvironmentGetArgs {
  environmentId: string;
}

export interface EnvironmentUpdateArgs {
  environmentId: string;
  mergeBaseBranch: string | null;
}

export interface EnvironmentStatusArgs extends EnvironmentStatusQuery {
  environmentId: string;
}

export type EnvironmentDiffArgs = EnvironmentDiffQuery & {
  environmentId: string;
};

export type EnvironmentDiffFileArgs = EnvironmentDiffFileQuery & {
  environmentId: string;
};

export interface EnvironmentDiffBranchesArgs
  extends EnvironmentDiffBranchesQuery {
  environmentId: string;
}

export interface EnvironmentCommitArgs {
  environmentId: string;
}

export interface EnvironmentSquashMergeArgs {
  environmentId: string;
  mergeBaseBranch: string;
}

export interface EnvironmentsArea {
  commit(args: EnvironmentCommitArgs): Promise<CommitActionResponse>;
  diff(args: EnvironmentDiffArgs): Promise<EnvironmentDiffResponse>;
  diffBranches(
    args: EnvironmentDiffBranchesArgs,
  ): Promise<EnvironmentDiffBranchesResponse>;
  diffFile(args: EnvironmentDiffFileArgs): Promise<EnvironmentDiffFileResponse>;
  get(args: EnvironmentGetArgs): Promise<Environment>;
  squashMerge(
    args: EnvironmentSquashMergeArgs,
  ): Promise<SquashMergeActionResponse>;
  status(args: EnvironmentStatusArgs): Promise<EnvironmentStatusResponse>;
  update(args: EnvironmentUpdateArgs): Promise<Environment>;
}

function environmentUpdateJson(
  args: EnvironmentUpdateArgs,
): UpdateEnvironmentRequest {
  return {
    mergeBaseBranch: args.mergeBaseBranch,
  };
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
  };
}

export function createEnvironmentsArea(
  args: CreateSdkAreaArgs,
): EnvironmentsArea {
  const { transport } = args;
  return {
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
        transport.api.v1.environments[":id"].diff.$get({
          param: { id: input.environmentId },
          query: environmentDiffQuery(input),
        }),
      );
    },
    async diffBranches(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].diff.branches.$get({
          param: { id: input.environmentId },
          query: environmentDiffBranchesQuery(input),
        }),
      );
    },
    async diffFile(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].diff.file.$get({
          param: { id: input.environmentId },
          query: environmentDiffFileQuery(input),
        }),
      );
    },
    async get(input) {
      const body = await transport.readJson(
        transport.api.v1.environments[":id"].$get({
          param: { id: input.environmentId },
        }),
      );
      return environmentSchema.parse(body);
    },
    async squashMerge(input) {
      const body = await transport.readJson(
        transport.api.v1.environments[":id"].actions.$post({
          param: { id: input.environmentId },
          json: {
            action: "squash_merge",
            options: {
              mergeBaseBranch: input.mergeBaseBranch,
            },
          },
        }),
      );
      return squashMergeActionResponseSchema.parse(body);
    },
    async status(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].status.$get({
          param: { id: input.environmentId },
          query: environmentStatusQuery(input),
        }),
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
