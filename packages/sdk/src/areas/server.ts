import type {
  ServerMoveCheckRequest,
  ServerMoveCheckResponse,
  ServerMoveStartRequest,
  ServerMoveStatus,
  ServerMoveStatusResponse,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs } from "./common.js";

export type {
  ServerMoveCheckItem,
  ServerMoveCheckRequest,
  ServerMoveCheckResponse,
  ServerMoveStartRequest,
  ServerMoveState,
  ServerMoveStatus,
  ServerMoveStatusResponse,
  ServerMoveStep,
} from "@bb/server-contract";

export interface ServerMoveCheckArgs extends ServerMoveCheckRequest {
  signal?: AbortSignal;
}

export interface ServerMoveStatusArgs {
  signal?: AbortSignal;
}

export interface ServerExportArgs {
  signal?: AbortSignal;
}

export interface ServerExportResult {
  fileName: string;
  body: ReadableStream<Uint8Array>;
  sha256: string;
}

export interface ExperimentalServerArea {
  checkMove(args: ServerMoveCheckArgs): Promise<ServerMoveCheckResponse>;
  startMove(args: ServerMoveStartRequest): Promise<ServerMoveStatus>;
  moveStatus(args?: ServerMoveStatusArgs): Promise<ServerMoveStatusResponse>;
  cancelMove(): Promise<ServerMoveStatus>;
  export(args?: ServerExportArgs): Promise<ServerExportResult>;
}

const EXPORT_FILE_NAME_PATTERN = /filename="([^"]+)"/u;
const EXPORT_SHA256_HEADER = "x-bb-archive-sha256";
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

function exportFileName(contentDisposition: string | null): string {
  const match =
    contentDisposition === null
      ? null
      : EXPORT_FILE_NAME_PATTERN.exec(contentDisposition);
  return match?.[1] ?? "bb-server-export";
}

export function createServerArea(
  args: CreateSdkAreaArgs,
): ExperimentalServerArea {
  const { operations } = args;
  const { call } = operations;
  return {
    checkMove: ({ targetHostId, serverUrl, signal }) =>
      call("server.checkMove", { targetHostId, serverUrl }, { signal }),
    startMove: (input) =>
      call("server.startMove", {
        targetHostId: input.targetHostId,
        serverUrl: input.serverUrl,
        stopRunningWork: input.stopRunningWork,
        archiveExistingTargetServerData: input.archiveExistingTargetServerData,
      }),
    moveStatus: (input) =>
      call("server.moveStatus", {}, { signal: input?.signal }),
    cancelMove: () => call("server.cancelMove", {}),
    async export(input) {
      const response = await call(
        "server.export",
        {},
        { signal: input?.signal },
      );
      if (response.body !== "stream") {
        throw new Error("The server returned an empty export");
      }
      const sha256 = response.headers[EXPORT_SHA256_HEADER];
      if (sha256 === undefined || !SHA256_HEX_PATTERN.test(sha256)) {
        await response.stream.cancel().catch(() => undefined);
        throw new Error(
          "The server did not send a SHA-256 digest for the export",
        );
      }
      return {
        fileName: exportFileName(
          response.headers["content-disposition"] ?? null,
        ),
        body: response.stream,
        sha256,
      };
    },
  };
}
