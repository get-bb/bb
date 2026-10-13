import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { isLoopbackAddress } from "@bb/config/loopback";
import type { Context, Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import { getTrustedRemoteAddress } from "../request-context.js";
import type {
  ServerMoveCoordinator,
  ServerMoveDownloadKind,
} from "../services/server-move/coordinator.js";
import {
  verifyPendingServerMove,
  type PendingServerMove,
} from "../services/server-move/pending-boot.js";
import { getAuthenticatedDaemon } from "./auth.js";

export const INTERNAL_SERVER_MOVE_PENDING_PATH =
  "/internal/server-move/pending";

export interface RegisterInternalServerMoveRoutesArgs {
  pending: PendingServerMove | null;
  serverMove: ServerMoveCoordinator;
}

const DOWNLOAD_CONTENT_TYPES: Record<ServerMoveDownloadKind, string> = {
  archive: "application/octet-stream",
  "bb-app": "application/gzip",
};

async function serverMoveDownloadResponse(
  context: Context,
  serverMove: ServerMoveCoordinator,
  kind: ServerMoveDownloadKind,
): Promise<Response> {
  const daemon = getAuthenticatedDaemon(context);
  const lookup = serverMove.resolveDownload({
    hostId: daemon.hostId,
    kind,
    moveId: context.req.param("moveId") ?? "",
  });
  if (lookup.outcome === "forbidden") {
    throw new ApiError(
      403,
      "server_move_download_forbidden",
      "Only the machine the server is moving to can download this file",
    );
  }
  const stats =
    lookup.outcome === "found"
      ? await stat(lookup.download.path).catch(() => null)
      : null;
  if (lookup.outcome !== "found" || stats === null || !stats.isFile()) {
    throw new ApiError(
      404,
      "server_move_download_not_found",
      "No active server move has this file",
    );
  }
  const body = Readable.toWeb(
    createReadStream(lookup.download.path),
  ) as ReadableStream<Uint8Array>;
  return new Response(body, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-length": String(stats.size),
      "content-type": DOWNLOAD_CONTENT_TYPES[kind],
      "x-bb-artifact-sha256": lookup.download.sha256,
    },
  });
}

export function registerInternalServerMoveRoutes(
  app: Hono,
  deps: AppDeps,
  args: RegisterInternalServerMoveRoutesArgs,
): void {
  app.get("/server-move/pending", (context) => {
    const remoteAddress = getTrustedRemoteAddress(context);
    if (remoteAddress === undefined || !isLoopbackAddress(remoteAddress)) {
      throw new ApiError(
        403,
        "loopback_only",
        "This route is available only on the machine that runs the server",
      );
    }
    if (args.pending === null) {
      throw new ApiError(
        404,
        "server_move_not_pending",
        "This server isn't waiting for a move to finish",
      );
    }
    return context.json(verifyPendingServerMove(deps.db, args.pending));
  });

  app.get("/server-move/:moveId/archive", (context) =>
    serverMoveDownloadResponse(context, args.serverMove, "archive"),
  );

  app.get("/server-move/:moveId/bb-app.tgz", (context) =>
    serverMoveDownloadResponse(context, args.serverMove, "bb-app"),
  );
}
