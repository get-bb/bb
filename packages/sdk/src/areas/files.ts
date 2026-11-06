import type {
  CreateFilePreviewResponse,
  HostFileListResponse,
  HostFileReadResponse,
  HostFileWriteResponse,
  HostMkdirResponse,
  HostMovePathResponse,
  HostPathListResponse,
  HostRemovePathResponse,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs } from "./common.js";

export interface FileReadArgs {
  hostId?: string;
  path: string;
  rootPath?: string;
  /**
   * Read the file as it is at this git revision of the repository at
   * `rootPath` instead of from disk. Requires `rootPath`; `path` stays the
   * file's absolute path in the working tree.
   */
  ref?: string;
  signal?: AbortSignal;
}

export interface FileWriteArgs {
  hostId?: string;
  path: string;
  rootPath?: string;
  content: string;
  contentEncoding?: "utf8" | "base64";
  createParents?: boolean;
  expectedSha256?: string | null;
  mode?: number;
}

export interface FileListArgs {
  hostId?: string;
  path: string;
  query?: string;
  limit?: number;
  includeHidden?: boolean;
  excludeNames?: string[];
  signal?: AbortSignal;
}

export interface PathListArgs extends FileListArgs {
  includeFiles: boolean;
  includeDirectories: boolean;
}

export interface FileMkdirArgs {
  hostId?: string;
  path: string;
  rootPath?: string;
  recursive?: boolean;
}

export interface FileMoveArgs {
  hostId?: string;
  sourcePath: string;
  destinationPath: string;
  rootPath?: string;
}

export interface FileRemoveArgs {
  hostId?: string;
  path: string;
  rootPath?: string;
  recursive?: boolean;
}

export interface FilePreviewArgs {
  hostId?: string;
  rootPath: string;
  signal?: AbortSignal;
  ttlMs?: number;
}

export type FileReadResult = HostFileReadResponse;
export type FileWriteResult = HostFileWriteResponse;
export type FileListResult = HostFileListResponse;
export type PathListResult = HostPathListResponse;
export type FileMkdirResult = HostMkdirResponse;
export type FileMoveResult = HostMovePathResponse;
export type FileRemoveResult = HostRemovePathResponse;
export type FilePreviewResult = CreateFilePreviewResponse;

export interface FilesArea {
  read(args: FileReadArgs): Promise<FileReadResult>;
  write(args: FileWriteArgs): Promise<FileWriteResult>;
  list(args: FileListArgs): Promise<FileListResult>;
  listPaths(args: PathListArgs): Promise<PathListResult>;
  mkdir(args: FileMkdirArgs): Promise<FileMkdirResult>;
  move(args: FileMoveArgs): Promise<FileMoveResult>;
  remove(args: FileRemoveArgs): Promise<FileRemoveResult>;
  createPreview(args: FilePreviewArgs): Promise<FilePreviewResult>;
}

export function createFilesArea(args: CreateSdkAreaArgs): FilesArea {
  const { call } = args.operations;
  return {
    read: ({ hostId, path, rootPath, ref, signal }) =>
      call("files.read", { hostId, path, rootPath, ref }, { signal }),
    write: (input) => call("files.write", input),
    list: (input) =>
      call(
        "files.list",
        {
          excludeNames: input.excludeNames,
          hostId: input.hostId,
          includeHidden: input.includeHidden,
          limit: input.limit,
          path: input.path,
          query: input.query,
        },
        { signal: input.signal },
      ),
    listPaths: (input) =>
      call(
        "files.listPaths",
        {
          excludeNames: input.excludeNames,
          hostId: input.hostId,
          includeDirectories: input.includeDirectories,
          includeFiles: input.includeFiles,
          includeHidden: input.includeHidden,
          limit: input.limit,
          path: input.path,
          query: input.query,
        },
        { signal: input.signal },
      ),
    mkdir: (input) => call("files.mkdir", input),
    move: (input) => call("files.move", input),
    remove: (input) => call("files.remove", input),
    createPreview: ({ hostId, rootPath, ttlMs, signal }) =>
      call("files.createPreview", { hostId, rootPath, ttlMs }, { signal }),
  };
}
