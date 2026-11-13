import { streamBody } from "@bb/operations";
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
import type { OperationCaller } from "@bb/operations";
import {
  publicApiRoutes,
  type OldServerCopyDeleteJob,
} from "@bb/server-contract";
import { ApiError } from "../errors.js";
import type { OperationRoutes } from "../kernel/http-door.js";
import { createJobRegistry } from "../services/lib/job-registry.js";
import { callHostOnlineRpc } from "../services/hosts/online-rpc.js";
import {
  assertUsableHostId,
  readPrimaryHostIdFromDataDir,
} from "../services/hosts/primary-host.js";
import {
  isServerMoveInFlight,
  type ServerMoveCoordinator,
} from "../services/server-move/coordinator.js";
import { exportServerArchive } from "../services/server-move/export.js";
import type { AppDeps } from "../types.js";

const SERVER_EXPORT_WORK_DIR_NAME = "server-export";
const DELETE_OLD_SERVER_COPY_TIMEOUT_MS = 5 * 60_000;

function assertServerManagementAllowed(caller: OperationCaller): void {
  if (caller.user === "machine") {
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

function serverExportFileName(now: Date): string {
  return `bb-server-${now.toISOString().slice(0, 10)}.tar.gz`;
}

export function registerServerMoveRoutes(
  operations: OperationRoutes,
  deps: AppDeps,
  serverMove: ServerMoveCoordinator,
): void {
  const routes = publicApiRoutes.server;

  operations.implement(routes.checkMove, async (payload, { caller }) => {
    assertServerManagementAllowed(caller);
    assertServerMoveExperimentEnabled(deps);
    return serverMove.check(payload);
  });

  operations.implement(routes.startMove, async (payload, { caller }) => {
    assertServerManagementAllowed(caller);
    assertServerMoveExperimentEnabled(deps);
    return serverMove.start(payload);
  });

  operations.implement(routes.moveStatus, async (_input, { caller }) => {
    assertServerManagementAllowed(caller);
    return {
      move: serverMove.getStatus(),
      lastMove: await readLastServerMove(deps.config.dataDir),
    };
  });

  operations.implement(routes.cancelMove, (_input, { caller }) => {
    assertServerManagementAllowed(caller);
    return serverMove.cancel();
  });

  operations.implement(routes.export, async (_input, { caller }) => {
    assertServerManagementAllowed(caller);
    assertServerMoveExperimentEnabled(deps);
    if (isServerMoveInFlight(serverMove.getStatus())) {
      throw new ApiError(
        409,
        "server_move_in_progress",
        "The server can't be exported while it is moving",
      );
    }
    const now = new Date();
    const fileName = serverExportFileName(now);
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
    return streamBody(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      contentType: "application/gzip",
      headers: {
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="${fileName}"`,
        "content-length": String(archive.sizeBytes),
        "x-bb-archive-sha256": archive.sha256,
      },
    });
  });

  const deleteJobs = createJobRegistry<OldServerCopyDeleteJob>({
    isActive: (job) => job.state === "running",
    fail: ({ id, hostId }, error) => ({
      id,
      hostId,
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
    }),
    notifyChanged: () => {},
  });

  const startDeleteJob = async (caller: OperationCaller, hostId: string) => {
    assertServerManagementAllowed(caller);
    assertServerMoveExperimentEnabled(deps);
    assertUsableHostId(deps, { hostId });
    const lastMove = await readLastServerMoveFile(deps.config.dataDir);
    if (lastMove === null || lastMove.fromHostId !== hostId) {
      throw new ApiError(
        404,
        "old_server_copy_not_found",
        "This machine doesn't have an old server copy",
      );
    }
    return deleteJobs.start({
      key: hostId,
      lane: hostId,
      create: (id) => ({ id, hostId, state: "running" }),
      run: async ({ job }) => {
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
        return { ...job, state: "completed", deleted: result.deleted };
      },
    });
  };

  operations.implement(
    publicApiRoutes.hosts.deleteOldServerCopy,
    async ({ id }, { caller }) => {
      const job = await startDeleteJob(caller, id);
      const outcome = await deleteJobs.settled(job.id);
      if (outcome?.job.state !== "completed") throw outcome?.error;
      return { deleted: outcome.job.deleted };
    },
  );

  operations.implement(
    publicApiRoutes.hosts.oldServerCopyDeleteJobStart,
    async ({ id }, { caller }) => ({
      job: await startDeleteJob(caller, id),
    }),
  );

  operations.implement(
    publicApiRoutes.hosts.oldServerCopyDeleteJobGet,
    ({ id, jobId }) => {
      const job = deleteJobs.get(jobId);
      if (job?.hostId !== id) {
        throw new ApiError(
          404,
          "old_server_copy_delete_job_not_found",
          "Unknown delete job; the server may have restarted",
        );
      }
      return { job };
    },
  );
}
