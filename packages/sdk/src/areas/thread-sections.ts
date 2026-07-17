import type {
  CreateThreadSectionRequest,
  DeleteThreadSectionRequest,
  ThreadSectionMutationResponse,
  ThreadSectionResponse,
  UpdateThreadSectionRequest,
} from "@bb/server-contract";
import {
  sidebarBootstrapResponseSchema,
  threadSectionMutationResponseSchema,
  threadSectionSchema,
} from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

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
  const { transport } = args;
  return {
    async create(input) {
      const body = await transport.readJson(
        transport.api.v1["thread-sections"].$post({ json: input }),
      );
      return threadSectionSchema.parse(body);
    },
    async delete(input) {
      const body = await transport.readJson(
        transport.api.v1["thread-sections"].$delete({ json: input }),
      );
      return threadSectionMutationResponseSchema.parse(body);
    },
    async list(input) {
      const body = await transport.readJson(
        transport.api.v1["sidebar-bootstrap"].$get(
          {},
          ...signalRequestArgs(input?.signal),
        ),
      );
      return sidebarBootstrapResponseSchema.parse(body).sections;
    },
    async update(input) {
      const body = await transport.readJson(
        transport.api.v1["thread-sections"].$patch({ json: input }),
      );
      return threadSectionMutationResponseSchema.parse(body);
    },
  };
}
