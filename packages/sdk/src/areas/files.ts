import type { CreateSdkAreaArgs, PublicApiOutput } from "./common.js";

/**
 * Host file primitives. `hostId` may be omitted to target the server's
 * primary (local) host. `rootPath`, when set, confines the target beneath
 * that absolute root on the host (symlink-safe).
 */
export interface FileReadArgs {
  hostId?: string;
  path: string;
  rootPath?: string;
}

export interface FileWriteArgs {
  hostId?: string;
  path: string;
  rootPath?: string;
  content: string;
  /** Defaults to "utf8". */
  contentEncoding?: "utf8" | "base64";
  /** Defaults to false. */
  createParents?: boolean;
  /**
   * Optimistic-concurrency guard: omitted → unconditional write; a hash →
   * write only when the current content hashes to it (use `read().sha256`);
   * null → create-only. A failed guard resolves to the `conflict` outcome.
   */
  expectedSha256?: string | null;
  /** POSIX permission bits used when creating a file (for example 0o600). */
  mode?: number;
}

export interface FileListArgs {
  hostId?: string;
  path: string;
  query?: string;
  limit?: number;
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
  ttlMs?: number;
}

export type FileReadResult = PublicApiOutput<"/files/read", "$post">;
export type FileWriteResult = PublicApiOutput<"/files/write", "$post">;
export type FileListResult = PublicApiOutput<"/files/list", "$post">;
export type PathListResult = PublicApiOutput<"/files/paths", "$post">;
export type FileMkdirResult = PublicApiOutput<"/files/mkdir", "$post">;
export type FileMoveResult = PublicApiOutput<"/files/move", "$post">;
export type FileRemoveResult = PublicApiOutput<"/files/remove", "$post">;
export type FilePreviewResult = PublicApiOutput<"/files/previews", "$post">;

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
  const { transport } = args;
  return {
    async read(input) {
      return transport.readJson(
        transport.api.v1.files.read.$post({ json: input }),
      );
    },
    async write(input) {
      return transport.readJson(
        transport.api.v1.files.write.$post({ json: input }),
      );
    },
    async list(input) {
      return transport.readJson(
        transport.api.v1.files.list.$post({ json: input }),
      );
    },
    async listPaths(input) {
      return transport.readJson(
        transport.api.v1.files.paths.$post({ json: input }),
      );
    },
    async mkdir(input) {
      return transport.readJson(
        transport.api.v1.files.mkdir.$post({ json: input }),
      );
    },
    async move(input) {
      return transport.readJson(
        transport.api.v1.files.move.$post({ json: input }),
      );
    },
    async remove(input) {
      return transport.readJson(
        transport.api.v1.files.remove.$post({ json: input }),
      );
    },
    async createPreview(input) {
      return transport.readJson(
        transport.api.v1.files.previews.$post({ json: input }),
      );
    },
  };
}
