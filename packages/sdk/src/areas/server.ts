import type {
  ServerMoveCheckRequest,
  ServerMoveCheckResponse,
  ServerMoveStartRequest,
  ServerMoveStatus,
  ServerMoveStatusResponse,
} from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

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
  passphrase: string | null;
  signal?: AbortSignal;
}

export interface ServerExportResult {
  fileName: string;
  body: ReadableStream<Uint8Array>;
}

export interface ExperimentalServerArea {
  checkMove(args: ServerMoveCheckArgs): Promise<ServerMoveCheckResponse>;
  startMove(args: ServerMoveStartRequest): Promise<ServerMoveStatus>;
  moveStatus(args?: ServerMoveStatusArgs): Promise<ServerMoveStatusResponse>;
  cancelMove(): Promise<ServerMoveStatus>;
  export(args: ServerExportArgs): Promise<ServerExportResult>;
}

const EXPORT_FILE_NAME_PATTERN = /filename="([^"]+)"/u;

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
  const { transport } = args;
  return {
    async checkMove(input) {
      return transport.readJson(
        transport.api.v1.server.move.check.$post(
          {
            json: {
              targetHostId: input.targetHostId,
              serverUrl: input.serverUrl,
            },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async startMove(input) {
      return transport.readJson(
        transport.api.v1.server.move.$post({
          json: {
            targetHostId: input.targetHostId,
            serverUrl: input.serverUrl,
            stopRunningWork: input.stopRunningWork,
            archiveExistingTargetServerData:
              input.archiveExistingTargetServerData,
          },
        }),
      );
    },
    async moveStatus(input) {
      return transport.readJson(
        transport.api.v1.server.move.$get(
          {},
          ...signalRequestArgs(input?.signal),
        ),
      );
    },
    async cancelMove() {
      return transport.readJson(transport.api.v1.server.move.cancel.$post());
    },
    async export(input) {
      const response = await transport.resolve(
        transport.api.v1.server.export.$post(
          { json: { passphrase: input.passphrase } },
          ...signalRequestArgs(input.signal),
        ),
      );
      if (response.body === null) {
        throw new Error("The server returned an empty export");
      }
      return {
        fileName: exportFileName(response.headers.get("content-disposition")),
        body: response.body,
      };
    },
  };
}
