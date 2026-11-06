import type {
  MachineEnvironmentReplace,
  MachineEnvironmentSet,
  ProjectMachineEnvironmentList,
  CommandListResponse,
  CopyProjectAttachmentsRequest,
  CreateProjectRequest,
  CreateProjectSourceRequest,
  ProjectBranchesResponse,
  ProjectBranchesQuery,
  ProjectCommandsQuery,
  ProjectFilesQuery,
  ProjectResponse,
  ProjectWithThreadsResponse,
  ProjectListQuery,
  ProjectPathsQuery,
  PromptHistoryResponse,
  PromptHistoryQuery,
  ReorderProjectRequest,
  SidebarBootstrapResponse,
  UpdateProjectRequest,
  UpdateProjectSourceRequest,
  UploadedPromptAttachment,
  WorkspacePathListResponse,
  WorkspaceFileListResponse,
} from "@bb/server-contract";
import { uploadedPromptAttachmentSchema } from "@bb/server-contract";
import type { ProjectExecutionDefaults, ProjectSource } from "@bb/domain";
import { readOperationBody } from "@bb/operations";
import type { CreateSdkAreaArgs } from "./common.js";

export interface ProjectListArgs {
  include?: ProjectListQuery["include"];
  includePersonal?: boolean;
  signal?: AbortSignal;
}

export interface ProjectCreateArgs extends CreateProjectRequest {}

export interface ProjectGetArgs {
  projectId: string;
  signal?: AbortSignal;
}

export interface ProjectUpdateArgs extends UpdateProjectRequest {
  projectId: string;
}

export interface ProjectDeleteArgs {
  projectId: string;
}

export interface ProjectReorderArgs extends ReorderProjectRequest {
  projectId: string;
}

export interface ProjectPromptHistoryArgs extends PromptHistoryQuery {
  projectId: string;
  signal?: AbortSignal;
}

export type ProjectWorkspaceRoutingArgs =
  | { environmentId: string; hostId?: never }
  | { environmentId?: never; hostId: string }
  | { environmentId?: never; hostId?: never };

export type ProjectFilesArgs = ProjectWorkspaceRoutingArgs &
  Omit<ProjectFilesQuery, "environmentId" | "hostId"> & {
    projectId: string;
    signal?: AbortSignal;
  };

export type ProjectPathsArgs = ProjectWorkspaceRoutingArgs &
  Omit<ProjectPathsQuery, "environmentId" | "hostId"> & {
    projectId: string;
    signal?: AbortSignal;
  };

export type ProjectCommandsArgs = ProjectWorkspaceRoutingArgs &
  Omit<ProjectCommandsQuery, "environmentId" | "hostId"> & {
    projectId: string;
    signal?: AbortSignal;
  };

export type ProjectFileContentArgs = ProjectWorkspaceRoutingArgs & {
  path: string;
  projectId: string;
  signal?: AbortSignal;
};

export interface ProjectBranchesArgs extends ProjectBranchesQuery {
  projectId: string;
  signal?: AbortSignal;
}

export interface ProjectDefaultExecutionOptionsArgs {
  projectId: string;
  signal?: AbortSignal;
}

export interface ProjectSidebarBootstrapArgs {
  signal?: AbortSignal;
}

export interface ProjectAttachmentFileLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  readonly name: string;
  readonly type?: string;
}

export type ProjectAttachmentUploadFile =
  | ArrayBuffer
  | Blob
  | ProjectAttachmentFileLike
  | Uint8Array;

interface ProjectAttachmentUploadArgsBase {
  mimeType?: string;
  projectId: string;
}

export type ProjectAttachmentUploadArgs = ProjectAttachmentUploadArgsBase &
  (
    | {
        clientFile: ProjectAttachmentFileLike;
        filename?: string;
      }
    | {
        clientFile: ArrayBuffer | Blob | Uint8Array;
        filename: string;
      }
  );

export interface ProjectAttachmentReadArgs {
  path: string;
  projectId: string;
  signal?: AbortSignal;
}

export interface ProjectAttachmentCopyArgs extends CopyProjectAttachmentsRequest {
  projectId: string;
}

export type ProjectSourceAddArgs = CreateProjectSourceRequest & {
  projectId: string;
};

export interface ProjectSourceUpdateArgs extends UpdateProjectSourceRequest {
  projectId: string;
  sourceId: string;
}

export interface ProjectSourceDeleteArgs {
  projectId: string;
  sourceId: string;
}

export type ProjectBranchesResult = ProjectBranchesResponse;
export interface ProjectAttachmentReadResult {
  bytes: Uint8Array;
  mimeType: string;
  sizeBytes: number;
}
export type ProjectAttachmentUploadResult = UploadedPromptAttachment;
export type ProjectCommandsResult = CommandListResponse;
export type ProjectCreateResult = ProjectResponse;
export type ProjectDefaultExecutionOptionsResult = ProjectExecutionDefaults | null;
export type ProjectDeleteResult = { ok: true };
export interface ProjectFileContentResult {
  content: string;
  contentEncoding: "utf8" | "base64";
  mimeType: string;
  sizeBytes: number;
}
export type ProjectFilesResult = WorkspaceFileListResponse;
export type ProjectGetResult = ProjectResponse;
export type ProjectListResult =
  | ProjectResponse[]
  | ProjectWithThreadsResponse[];
export type ProjectPathsResult = WorkspacePathListResponse;
export type ProjectPromptHistoryResult = PromptHistoryResponse;
export type ProjectReorderResult = ProjectResponse[];
export type ProjectSidebarBootstrapResult = SidebarBootstrapResponse;
export type ProjectSourceAddResult = ProjectSource;
export type ProjectSourceDeleteResult = { ok: true };
export type ProjectSourceUpdateResult = ProjectSource;
export type ProjectUpdateResult = ProjectResponse;

export interface ProjectSourcesArea {
  add(args: ProjectSourceAddArgs): Promise<ProjectSourceAddResult>;
  delete(args: ProjectSourceDeleteArgs): Promise<ProjectSourceDeleteResult>;
  update(args: ProjectSourceUpdateArgs): Promise<ProjectSourceUpdateResult>;
}

export interface ProjectAttachmentsArea {
  copy(args: ProjectAttachmentCopyArgs): Promise<void>;
  read(args: ProjectAttachmentReadArgs): Promise<ProjectAttachmentReadResult>;
  upload(
    args: ProjectAttachmentUploadArgs,
  ): Promise<ProjectAttachmentUploadResult>;
}

export interface ProjectsArea {
  machineEnvironment(args: {
    projectId: string;
  }): Promise<ProjectMachineEnvironmentList>;
  replaceMachineEnvironment(
    args: { projectId: string } & MachineEnvironmentReplace,
  ): Promise<ProjectMachineEnvironmentList>;
  setMachineEnvironmentVariable(
    args: { projectId: string } & MachineEnvironmentSet,
  ): Promise<ProjectMachineEnvironmentList>;
  deleteMachineEnvironmentVariable(args: {
    projectId: string;
    name: string;
  }): Promise<ProjectMachineEnvironmentList>;
  attachments: ProjectAttachmentsArea;
  branches(args: ProjectBranchesArgs): Promise<ProjectBranchesResult>;
  commands(args: ProjectCommandsArgs): Promise<ProjectCommandsResult>;
  create(args: ProjectCreateArgs): Promise<ProjectCreateResult>;
  defaultExecutionOptions(
    args: ProjectDefaultExecutionOptionsArgs,
  ): Promise<ProjectDefaultExecutionOptionsResult>;
  delete(args: ProjectDeleteArgs): Promise<ProjectDeleteResult>;
  fileContent(args: ProjectFileContentArgs): Promise<ProjectFileContentResult>;
  files(args: ProjectFilesArgs): Promise<ProjectFilesResult>;
  get(args: ProjectGetArgs): Promise<ProjectGetResult>;
  list(args?: ProjectListArgs): Promise<ProjectListResult>;
  paths(args: ProjectPathsArgs): Promise<ProjectPathsResult>;
  promptHistory(
    args: ProjectPromptHistoryArgs,
  ): Promise<ProjectPromptHistoryResult>;
  reorder(args: ProjectReorderArgs): Promise<ProjectReorderResult>;
  sidebarBootstrap(
    args?: ProjectSidebarBootstrapArgs,
  ): Promise<ProjectSidebarBootstrapResult>;
  sources: ProjectSourcesArea;
  update(args: ProjectUpdateArgs): Promise<ProjectUpdateResult>;
}

function projectUpdateJson(args: ProjectUpdateArgs): UpdateProjectRequest {
  return {
    name: args.name,
  };
}

function projectSourceAddJson(
  args: ProjectSourceAddArgs,
): CreateProjectSourceRequest {
  if (args.type === "local_path") {
    return { hostId: args.hostId, path: args.path, type: args.type };
  }
  return {
    hostId: args.hostId,
    type: args.type,
    ...(args.remoteUrl !== undefined ? { remoteUrl: args.remoteUrl } : {}),
    ...(args.targetPath !== undefined ? { targetPath: args.targetPath } : {}),
  };
}

function projectSourceUpdateJson(
  args: ProjectSourceUpdateArgs,
): UpdateProjectSourceRequest {
  return {
    isDefault: args.isDefault,
    path: args.path,
    type: args.type,
  };
}

function embeddedAttachmentFilename(
  clientFile: ProjectAttachmentUploadFile,
): string | undefined {
  if ("name" in clientFile && typeof clientFile.name === "string") {
    return clientFile.name;
  }
  return undefined;
}

function projectListQuery(input: ProjectListArgs): ProjectListQuery {
  return {
    ...(input.include === undefined ? {} : { include: input.include }),
    ...(input.includePersonal === undefined
      ? {}
      : { includePersonal: input.includePersonal ? "true" : "false" }),
  };
}

function embeddedAttachmentMimeType(
  clientFile: ProjectAttachmentUploadFile,
): string | undefined {
  if ("type" in clientFile && typeof clientFile.type === "string") {
    return clientFile.type;
  }
  return undefined;
}

function hasAttachmentArrayBuffer(
  clientFile: ProjectAttachmentUploadFile,
): clientFile is Blob | ProjectAttachmentFileLike {
  return "arrayBuffer" in clientFile;
}

async function attachmentBytes(
  clientFile: ProjectAttachmentUploadFile,
): Promise<ArrayBuffer> {
  if (hasAttachmentArrayBuffer(clientFile)) {
    return clientFile.arrayBuffer();
  }
  if (ArrayBuffer.isView(clientFile)) {
    return Uint8Array.from(clientFile).buffer;
  }
  return clientFile.slice(0);
}

function resolveAttachmentFilename(input: ProjectAttachmentUploadArgs): string {
  const filename =
    input.filename ?? embeddedAttachmentFilename(input.clientFile);
  if (!filename || filename.trim().length === 0) {
    throw new Error("Project attachment filename must not be empty");
  }
  return filename;
}

function validProjectFilePath(path: string): string {
  const segments = path.split("/");
  if (
    path.includes("\0") ||
    path.includes("\\") ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new Error(`Invalid file path: ${path}`);
  }
  return path;
}

function isUtf8FileContent(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType.startsWith("image/") && !mimeType.startsWith("image/svg+xml")) {
    return false;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeBase64(bytes: Uint8Array): string {
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const block =
      (first << 16) | ((second ?? 0) << 8) | (third === undefined ? 0 : third);
    encoded += BASE64_ALPHABET.charAt((block >> 18) & 63);
    encoded += BASE64_ALPHABET.charAt((block >> 12) & 63);
    encoded +=
      second === undefined ? "=" : BASE64_ALPHABET.charAt((block >> 6) & 63);
    encoded += third === undefined ? "=" : BASE64_ALPHABET.charAt(block & 63);
  }
  return encoded;
}

export function createProjectsArea(args: CreateSdkAreaArgs): ProjectsArea {
  const { operations } = args;
  const { call, send } = operations;
  const attachments: ProjectAttachmentsArea = {
    async copy({ projectId, ...rest }) {
      await send("projects.copyAttachments", { id: projectId, ...rest });
    },
    async read({ projectId, path, signal }) {
      const body = await call(
        "projects.attachmentContent",
        { id: projectId, path },
        { signal },
      );
      const bytes = await readOperationBody(body);
      return {
        bytes,
        mimeType: body.contentType ?? "application/octet-stream",
        sizeBytes: bytes.byteLength,
      };
    },
    async upload(input) {
      const filename = resolveAttachmentFilename(input);
      const mimeType =
        input.mimeType ?? embeddedAttachmentMimeType(input.clientFile) ?? "";
      const file = new File(
        [await attachmentBytes(input.clientFile)],
        filename,
        {
          type: mimeType,
        },
      );
      return uploadedPromptAttachmentSchema.parse(
        await call("projects.uploadAttachment", { id: input.projectId, file }),
      );
    },
  };
  const sources: ProjectSourcesArea = {
    add: (input) =>
      call("projects.createSource", {
        id: input.projectId,
        ...projectSourceAddJson(input),
      }),
    async delete({ projectId, sourceId }) {
      await send("projects.deleteSource", { id: projectId, sourceId });
      return { ok: true };
    },
    update: (input) =>
      call("projects.updateSource", {
        id: input.projectId,
        sourceId: input.sourceId,
        ...projectSourceUpdateJson(input),
      }),
  };

  return {
    attachments,
    branches: ({ projectId, signal, ...query }) =>
      call("projects.branches", { id: projectId, ...query }, { signal }),
    commands: ({ projectId, signal, ...query }) =>
      call("projects.commands", { id: projectId, ...query }, { signal }),
    create: (input) => call("projects.create", input),
    async delete({ projectId }) {
      await send("projects.delete", { id: projectId });
      return { ok: true };
    },
    defaultExecutionOptions: ({ projectId, signal }) =>
      call("projects.defaultExecutionOptions", { id: projectId }, { signal }),
    async fileContent(input) {
      const { projectId, path, signal, environmentId, hostId } = input;
      const filePath = validProjectFilePath(path);
      const body =
        environmentId !== undefined
          ? await call(
              "environments.file",
              { id: environmentId, filePath },
              { signal },
            )
          : hostId !== undefined
            ? await call(
                "projects.hostFile",
                { id: projectId, hostId, filePath },
                { signal },
              )
            : await call(
                "projects.file",
                { id: projectId, filePath },
                { signal },
              );
      const bytes = await readOperationBody(body);
      const mimeType = body.contentType ?? "application/octet-stream";
      const contentEncoding = isUtf8FileContent(bytes, mimeType)
        ? "utf8"
        : "base64";
      return {
        content:
          contentEncoding === "utf8"
            ? new TextDecoder().decode(bytes)
            : encodeBase64(bytes),
        contentEncoding,
        mimeType,
        sizeBytes: bytes.byteLength,
      };
    },
    files: ({ projectId, signal, ...query }) =>
      call("projects.files", { id: projectId, ...query }, { signal }),
    machineEnvironment: ({ projectId }) =>
      call("projects.machineEnvironment", { id: projectId }),
    replaceMachineEnvironment: ({ projectId, variables }) =>
      call("projects.replaceMachineEnvironment", { id: projectId, variables }),
    setMachineEnvironmentVariable: ({ projectId, name, value, note }) =>
      call("projects.setMachineEnvironmentVariable", {
        id: projectId,
        name,
        value,
        note,
      }),
    deleteMachineEnvironmentVariable: ({ projectId, name }) =>
      call("projects.deleteMachineEnvironmentVariable", {
        id: projectId,
        name,
      }),
    get: ({ projectId, signal }) =>
      call("projects.get", { id: projectId }, { signal }),
    list: (input = {}) => {
      const { signal, ...query } = input;
      return call("projects.list", projectListQuery(query), { signal });
    },
    paths: ({ projectId, signal, ...query }) =>
      call("projects.paths", { id: projectId, ...query }, { signal }),
    promptHistory: ({ projectId, limit, signal }) =>
      call("projects.promptHistory", { id: projectId, limit }, { signal }),
    reorder: ({ projectId, previousProjectId, nextProjectId }) =>
      call("projects.reorder", {
        id: projectId,
        previousProjectId,
        nextProjectId,
      }),
    sidebarBootstrap: (input = {}) =>
      call("projects.sidebarBootstrap", {}, { signal: input.signal }),
    sources,
    update: (input) =>
      call("projects.update", {
        id: input.projectId,
        ...projectUpdateJson(input),
      }),
  };
}
