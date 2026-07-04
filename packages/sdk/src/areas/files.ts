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
}

export interface FileListArgs {
  hostId?: string;
  path: string;
  query?: string;
  limit?: number;
}

export type FileReadResult = PublicApiOutput<"/files/read", "$post">;
export type FileWriteResult = PublicApiOutput<"/files/write", "$post">;
export type FileListResult = PublicApiOutput<"/files/list", "$post">;

export interface FilesArea {
  read(args: FileReadArgs): Promise<FileReadResult>;
  write(args: FileWriteArgs): Promise<FileWriteResult>;
  list(args: FileListArgs): Promise<FileListResult>;
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
  };
}
