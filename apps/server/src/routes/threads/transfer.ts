import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { Hono } from "hono";
import {
  deleteSavedThread,
  getExperiments,
  getSavedThread,
  listSavedThreads,
  type SavedThread,
} from "@bb/db";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
  type SavedThreadResponse,
} from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { requirePublicThread } from "../../services/lib/entity-lookup.js";
import {
  removeSavedThreadFile,
  savedThreadFileExists,
  savedThreadFilePath,
} from "../../services/threads/saved-threads/thread-file.js";
import {
  isThreadSavableNow,
  requestThreadSave,
} from "../../services/threads/saved-threads/thread-saving.js";
import {
  exportThreadFile,
  importThreadFile,
  restoreSavedThread,
} from "../../services/threads/saved-threads/thread-transfer.js";
import { readMultipartFormData } from "../multipart-form-data.js";

const THREAD_FILE_CONTENT_TYPE = "application/zstd";
const SAVED_THREAD_LIST_DEFAULT_LIMIT = 50;
const SAVED_THREAD_LIST_MAX_LIMIT = 200;

const SAVED_THREADS_EXPERIMENT_DISABLED_MESSAGE =
  'Saving, exporting and importing threads is off. Turn on the "Save archived threads to files" experiment in Settings → Experiments, or run bb settings experiment savedThreads true, then try again.';

function assertSavedThreadsExperimentEnabled(deps: AppDeps): void {
  if (!getExperiments(deps.db).savedThreads) {
    throw new ApiError(
      403,
      "saved_threads_experiment_disabled",
      SAVED_THREADS_EXPERIMENT_DISABLED_MESSAGE,
    );
  }
}

function toSavedThreadResponse(saved: SavedThread): SavedThreadResponse {
  if (saved.state !== "saving" && saved.state !== "saved") {
    throw new ApiError(404, "saved_thread_not_found", "Saved thread not found");
  }
  return {
    archivedAt: saved.archivedAt,
    packedBytes: saved.packedBytes,
    projectId: saved.projectId,
    providerId: saved.providerId,
    rows: saved.rowCount,
    savedAt: saved.savedAt,
    state: saved.state,
    threadCreatedAt: saved.threadCreatedAt,
    threadId: saved.threadId,
    title: saved.title,
  };
}

function requireListedSavedThread(
  deps: AppDeps,
  threadId: string,
): SavedThread {
  const saved = getSavedThread(deps.db, threadId);
  if (saved?.state !== "saved") {
    throw new ApiError(404, "saved_thread_not_found", "Saved thread not found");
  }
  return saved;
}

function parseCount(
  value: string | undefined,
  fallback: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  return Math.min(max, Number.parseInt(value, 10));
}

export function registerThreadTransferRoutes(app: Hono, deps: AppDeps): void {
  const { del, get, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.threads;

  const makeWorkDir = () => mkdtemp(join(tmpdir(), "bb-thread-file-"));
  const removeWorkDir = (workDir: string) =>
    rm(workDir, { force: true, recursive: true }).catch((error: unknown) => {
      deps.logger.warn(
        { err: error, workDir },
        "Thread file transfer could not remove its work directory",
      );
    });

  const fileResponse = async (
    path: string,
    fileName: string,
    onClose: () => void,
  ): Promise<Response> => {
    const { size } = await stat(path);
    const stream = createReadStream(path);
    stream.once("close", onClose);
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="${fileName}"`,
        "content-length": String(size),
        "content-type": THREAD_FILE_CONTENT_TYPE,
      },
    });
  };

  get(routes.exportThread, async (context) => {
    assertSavedThreadsExperimentEnabled(deps);
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const fileName = `${thread.id}.jsonl.zst`;
    const workDir = await makeWorkDir();
    const path = join(workDir, fileName);
    try {
      await exportThreadFile(deps, { path, threadId: thread.id });
      return await fileResponse(path, fileName, () => {
        void removeWorkDir(workDir);
      });
    } catch (error) {
      await removeWorkDir(workDir);
      throw error;
    }
  });

  post(routes.importThread, async (context) => {
    assertSavedThreadsExperimentEnabled(deps);
    const formData = await readMultipartFormData(context.req);
    const fields = [...formData.keys()];
    const file = formData.get("file");
    if (fields.length !== 1 || !(file instanceof File)) {
      throw new ApiError(
        400,
        "invalid_request",
        'Thread import accepts exactly one multipart field named "file"',
      );
    }
    const workDir = await makeWorkDir();
    try {
      const path = join(workDir, "import.jsonl.zst");
      await pipeline(
        Readable.fromWeb(file.stream() as NodeReadableStream<Uint8Array>),
        createWriteStream(path),
      );
      return context.json(await importThreadFile(deps, path));
    } finally {
      await removeWorkDir(workDir);
    }
  });

  post(routes.saveThread, (context) => {
    assertSavedThreadsExperimentEnabled(deps);
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    if (!isThreadSavableNow(deps, thread.id, false)) {
      throw new ApiError(
        409,
        "thread_not_savable",
        "This thread can't be saved now: it is pinned, running, open in a client, already being saved, has pending work, or has child or forked threads still in the database",
      );
    }
    return context.json(toSavedThreadResponse(requestThreadSave(deps, thread)));
  });

  get(routes.listSaved, (context, query) => {
    const limit = parseCount(
      query.limit,
      SAVED_THREAD_LIST_DEFAULT_LIMIT,
      SAVED_THREAD_LIST_MAX_LIMIT,
    );
    const rows = listSavedThreads(deps.db, {
      limit: limit + 1,
      offset: parseCount(query.offset, 0, Number.MAX_SAFE_INTEGER),
      projectId: query.projectId ?? null,
      search: query.search ?? null,
    });
    return context.json({
      hasMore: rows.length > limit,
      savedThreads: rows.slice(0, limit).map(toSavedThreadResponse),
    });
  });

  post(routes.restoreSaved, async (context) => {
    const saved = requireListedSavedThread(deps, context.req.param("id"));
    return context.json(await restoreSavedThread(deps, saved.threadId));
  });

  del(routes.deleteSaved, async (context) => {
    const saved = requireListedSavedThread(deps, context.req.param("id"));
    if (saved.state !== "saved") {
      throw new ApiError(
        409,
        "saved_thread_busy",
        "This thread is still being saved; try again in a moment",
      );
    }
    deleteSavedThread(deps.db, saved.threadId);
    await removeSavedThreadFile(deps.config.dataDir, saved.threadId);
    return context.json({ ok: true as const });
  });

  get(routes.savedFile, async (context) => {
    const saved = requireListedSavedThread(deps, context.req.param("id"));
    if (!(await savedThreadFileExists(deps.config.dataDir, saved.threadId))) {
      throw new ApiError(
        404,
        "saved_thread_file_missing",
        "Saved thread file not found",
      );
    }
    return fileResponse(
      savedThreadFilePath(deps.config.dataDir, saved.threadId),
      `${saved.threadId}.jsonl.zst`,
      () => undefined,
    );
  });
}
