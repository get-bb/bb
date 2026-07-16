import type {
  CreateThreadFolderRequest,
  DeleteThreadFolderRequest,
  ThreadFolderMutationResponse,
  ThreadFolderResponse,
  UpdateThreadFolderRequest,
} from "@bb/server-contract";
import {
  sidebarBootstrapResponseSchema,
  threadFolderMutationResponseSchema,
  threadFolderSchema,
} from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

export type ThreadFolderCreateResult = ThreadFolderResponse;
export type ThreadFolderUpdateResult = ThreadFolderMutationResponse;
export type ThreadFolderDeleteResult = ThreadFolderMutationResponse;
export type ThreadFolderListResult = ThreadFolderResponse[];

export interface ThreadFolderListArgs {
  signal?: AbortSignal;
}

export interface ThreadFoldersArea {
  create(args: CreateThreadFolderRequest): Promise<ThreadFolderCreateResult>;
  delete(args: DeleteThreadFolderRequest): Promise<ThreadFolderDeleteResult>;
  list(args?: ThreadFolderListArgs): Promise<ThreadFolderListResult>;
  update(args: UpdateThreadFolderRequest): Promise<ThreadFolderUpdateResult>;
}

export function createThreadFoldersArea(
  args: CreateSdkAreaArgs,
): ThreadFoldersArea {
  const { transport } = args;
  return {
    async create(input) {
      const body = await transport.readJson(
        transport.api.v1["thread-folders"].$post({ json: input }),
      );
      return threadFolderSchema.parse(body);
    },
    async delete(input) {
      const body = await transport.readJson(
        transport.api.v1["thread-folders"].$delete({ json: input }),
      );
      return threadFolderMutationResponseSchema.parse(body);
    },
    async list(input) {
      const body = await transport.readJson(
        transport.api.v1["sidebar-bootstrap"].$get(
          {},
          ...signalRequestArgs(input?.signal),
        ),
      );
      return sidebarBootstrapResponseSchema.parse(body).folders;
    },
    async update(input) {
      const body = await transport.readJson(
        transport.api.v1["thread-folders"].$patch({ json: input }),
      );
      return threadFolderMutationResponseSchema.parse(body);
    },
  };
}
