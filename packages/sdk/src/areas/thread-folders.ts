import type {
  CreateThreadFolderRequest,
  DeleteThreadFolderRequest,
  UpdateThreadFolderRequest,
} from "@bb/server-contract";
import {
  sidebarBootstrapResponseSchema,
  threadFolderMutationResponseSchema,
  threadFolderSchema,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs, PublicApiOutput } from "./common.js";

export type ThreadFolderCreateResult = PublicApiOutput<
  "/thread-folders",
  "$post"
>;
export type ThreadFolderUpdateResult = PublicApiOutput<
  "/thread-folders",
  "$patch"
>;
export type ThreadFolderDeleteResult = PublicApiOutput<
  "/thread-folders",
  "$delete"
>;

export interface ThreadFoldersArea {
  create(args: CreateThreadFolderRequest): Promise<ThreadFolderCreateResult>;
  delete(args: DeleteThreadFolderRequest): Promise<ThreadFolderDeleteResult>;
  list(): Promise<ThreadFolderCreateResult[]>;
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
    async list() {
      const body = await transport.readJson(
        transport.api.v1["sidebar-bootstrap"].$get(),
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
