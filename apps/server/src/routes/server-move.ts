import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { getExperiments } from "@bb/db";
import type { LastServerMove } from "@bb/domain";
import {
  readLastServerMoveFile,
  writeLastServerMoveFile,
} from "@bb/server-archive";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import {
  getGateAuthKind,
  type GateAuthHeaderReader,
} from "../request-context.js";
import { callHostOnlineRpc } from "../services/hosts/online-rpc.js";
import {
  assertUsableHostId,
  readPrimaryHostIdFromDataDir,
} from "../services/hosts/primary-host.js";
import type { ServerMoveCoordinator } from "../services/server-move/coordinator.js";
import { exportServerArchive } from "../services/server-move/export.js";
import type { AppDeps } from "../types.js";

const SERVER_EXPORT_WORK_DIR_NAME = "server-export";
const DELETE_OLD_SERVER_COPY_TIMEOUT_MS = 5 * 60_000;

function assertServerManagementAllowed(context: GateAuthHeaderReader): void {
  if (getGateAuthKind(context) === "machine") {
    throw new ApiError(
      403,
      "machine_host_management_forbidden",
      "Machine credentials cannot move, export, or clean up the server",
    );
  }
}

export const SERVER_MOVE_EXPERIMENT_DISABLED_MESSAGE =
  'Moving the server is off. Turn on the "Server move" experiment in Settings → Experiments, or run bb settings experiment serverMove true, then try again.';

function assertServerMoveExperimentEnabled(deps: AppDeps): void {
  if (!getExperiments(deps.db).serverMove) {
    throw new ApiError(
      403,
      "server_move_experiment_disabled",
      SERVER_MOVE_EXPERIMENT_DISABLED_MESSAGE,
    );
  }
}

export async function readLastServerMove(
  dataDir: string,
): Promise<LastServerMove | null> {
  const file = await readLastServerMoveFile(dataDir);
  if (file === null) {
    return null;
  }
  const { version: _version, ...lastMove } = file;
  return lastMove;
}

function serverExportFileName(now: Date, encrypted: boolean): string {
  const date = now.toISOString().slice(0, 10);
  return `bb-server-${date}.${encrypted ? "bbsa" : "tar.gz"}`;
}

export function registerServerMoveRoutes(
  app: Hono,
  deps: AppDeps,
  serverMove: ServerMoveCoordinator,
): void {
  const { del, get, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });
  const routes = publicApiRoutes.server;

  post(routes.checkMove, async (context, payload) => {
    assertServerManagementAllowed(context);
    assertServerMoveExperimentEnabled(deps);
    return context.json(await serverMove.check(payload));
  });

  post(routes.startMove, async (context, payload) => {
    assertServerManagementAllowed(context);
    assertServerMoveExperimentEnabled(deps);
    return context.json(await serverMove.start(payload));
  });

  get(routes.moveStatus, async (context) => {
    assertServerManagementAllowed(context);
    return context.json({
      move: serverMove.getStatus(),
      lastMove: await readLastServerMove(deps.config.dataDir),
    });
  });

  post(routes.cancelMove, (context) => {
    assertServerManagementAllowed(context);
    return context.json(serverMove.cancel());
  });

  post(routes.export, async (context, payload) => {
    assertServerManagementAllowed(context);
    assertServerMoveExperimentEnabled(deps);
    const status = serverMove.getStatus();
    if (
      status !== null &&
      (status.state === "preparing" ||
        status.state === "switching" ||
        status.state === "completed")
    ) {
      throw new ApiError(
        409,
        "server_move_in_progress",
        "The server can't be exported while it is moving",
      );
    }
    const now = new Date();
    const encrypted = payload.passphrase !== null;
    const fileName = serverExportFileName(now, encrypted);
    const workDir = join(
      deps.config.dataDir,
      SERVER_EXPORT_WORK_DIR_NAME,
      randomUUID(),
    );
    const removeWorkDir = () =>
      rm(workDir, { force: true, recursive: true }).catch((error: unknown) => {
        deps.logger.warn(
          { err: error, workDir },
          "Server export could not remove its work directory",
        );
      });
    let archive: Awaited<ReturnType<typeof exportServerArchive>>;
    try {
      archive = await exportServerArchive({
        appVersion: deps.config.appVersion,
        dataDir: deps.config.dataDir,
        db: deps.db,
        encryption:
          payload.passphrase === null
            ? null
            : { kind: "passphrase", passphrase: payload.passphrase },
        fileName,
        logger: deps.logger,
        now: now.getTime(),
        sourceServerHostId: readPrimaryHostIdFromDataDir({
          dataDir: deps.config.dataDir,
        }),
        workDir,
      });
    } catch (error) {
      await removeWorkDir();
      throw error;
    }
    const stream = createReadStream(archive.path);
    stream.once("close", () => {
      void removeWorkDir();
    });
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="${fileName}"`,
        "content-length": String(archive.sizeBytes),
        "content-type": encrypted
          ? "application/octet-stream"
          : "application/gzip",
        "x-bb-archive-sha256": archive.sha256,
      },
    });
  });

  del(publicApiRoutes.hosts.deleteOldServerCopy, async (context) => {
    assertServerManagementAllowed(context);
    assertServerMoveExperimentEnabled(deps);
    const hostId = context.req.param("id");
    assertUsableHostId(deps, { hostId });
    const lastMove = await readLastServerMoveFile(deps.config.dataDir);
    if (lastMove === null || lastMove.fromHostId !== hostId) {
      throw new ApiError(
        404,
        "old_server_copy_not_found",
        "This machine doesn't have an old server copy",
      );
    }
    const result = await callHostOnlineRpc(deps, {
      hostId,
      timeoutMs: DELETE_OLD_SERVER_COPY_TIMEOUT_MS,
      command: { type: "server_move.delete_old_copy" },
    });
    if (lastMove.oldCopyDeletedAt === null) {
      await writeLastServerMoveFile(deps.config.dataDir, {
        ...lastMove,
        oldCopyDeletedAt: Date.now(),
      });
    }
    deps.hub.notifySystem(["server-move-changed"]);
    return context.json({ deleted: result.deleted });
  });
}
