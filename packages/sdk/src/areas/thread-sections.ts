import type {
  CreateThreadSectionRequest,
  DeleteThreadSectionRequest,
  ThreadSectionMutationResponse,
  ThreadSectionResponse,
  UpdateThreadSectionRequest,
} from "@bb/server-contract";
import {
  threadSectionMutationResponseSchema,
  threadSectionSchema,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs } from "./common.js";

export type ThreadSectionCreateResult = ThreadSectionResponse;
export type ThreadSectionUpdateResult = ThreadSectionMutationResponse;
export type ThreadSectionDeleteResult = ThreadSectionMutationResponse;
export type ThreadSectionListResult = ThreadSectionResponse[];

export interface ThreadSectionListArgs {
  signal?: AbortSignal;
}

export interface ThreadSectionsArea {
  create(args: CreateThreadSectionRequest): Promise<ThreadSectionCreateResult>;
  delete(args: DeleteThreadSectionRequest): Promise<ThreadSectionDeleteResult>;
  list(args?: ThreadSectionListArgs): Promise<ThreadSectionListResult>;
  update(args: UpdateThreadSectionRequest): Promise<ThreadSectionUpdateResult>;
}

export function createThreadSectionsArea(
  args: CreateSdkAreaArgs,
): ThreadSectionsArea {
  const { call } = args.operations;
  return {
    async create(input) {
      return threadSectionSchema.parse(
        await call("threadSections.create", input),
      );
    },
    async delete(input) {
      return threadSectionMutationResponseSchema.parse(
        await call("threadSections.delete", input),
      );
    },
    async list(input) {
      return threadSectionSchema
        .array()
        .parse(await call("threadSections.list", {}, input?.signal));
    },
    async update(input) {
      return threadSectionMutationResponseSchema.parse(
        await call("threadSections.update", input),
      );
    },
  };
}
