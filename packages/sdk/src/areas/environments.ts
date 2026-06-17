import { environmentSchema } from "@bb/domain";
import {
  commitActionResponseSchema,
  squashMergeActionResponseSchema,
  updateEnvironmentRequestSchema,
} from "@bb/server-contract";
import type {
  EnvironmentDiffBranchesQuery,
  EnvironmentDiffFileQuery,
  EnvironmentDiffQuery,
  EnvironmentStatusQuery,
  UpdateEnvironmentRequest,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs, PublicApiOutput } from "./common.js";

export interface EnvironmentGetArgs {
  environmentId: string;
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
}

export type EnvironmentDiffArgs = EnvironmentDiffQuery & {
  environmentId: string;
};

export type EnvironmentDiffFileArgs = EnvironmentDiffFileQuery & {
  environmentId: string;
};

export interface EnvironmentDiffBranchesArgs extends EnvironmentDiffBranchesQuery {
  environmentId: string;
}

export interface EnvironmentCommitArgs {
  environmentId: string;
}

export interface EnvironmentSquashMergeArgs {
  environmentId: string;
  mergeBaseBranch: string;
}

type EnvironmentActionResult = PublicApiOutput<
  "/environments/:id/actions",
  "$post"
>;
export type EnvironmentCommitResult = Extract<
  EnvironmentActionResult,
  { action: "commit" }
>;
export type EnvironmentDiffResult = PublicApiOutput<
  "/environments/:id/diff",
  "$get"
>;
export type EnvironmentDiffBranchesResult = PublicApiOutput<
  "/environments/:id/diff/branches",
  "$get"
>;
export type EnvironmentDiffFileResult = PublicApiOutput<
  "/environments/:id/diff/file",
  "$get"
>;
export type EnvironmentGetResult = PublicApiOutput<"/environments/:id", "$get">;
export type EnvironmentSquashMergeResult = Extract<
  EnvironmentActionResult,
  { action: "squash_merge" }
>;
export type EnvironmentStatusResult = PublicApiOutput<
  "/environments/:id/status",
  "$get"
>;
export type EnvironmentUpdateResult = PublicApiOutput<
  "/environments/:id",
  "$patch"
>;

export interface EnvironmentsArea {
  commit(args: EnvironmentCommitArgs): Promise<EnvironmentCommitResult>;
  diff(args: EnvironmentDiffArgs): Promise<EnvironmentDiffResult>;
  diffBranches(
    args: EnvironmentDiffBranchesArgs,
  ): Promise<EnvironmentDiffBranchesResult>;
  diffFile(args: EnvironmentDiffFileArgs): Promise<EnvironmentDiffFileResult>;
  get(args: EnvironmentGetArgs): Promise<EnvironmentGetResult>;
  squashMerge(
    args: EnvironmentSquashMergeArgs,
  ): Promise<EnvironmentSquashMergeResult>;
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
