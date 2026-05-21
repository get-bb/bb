import type { Hono } from "hono";
import { z } from "zod";
import { jsonValueSchema, type JsonValue } from "@bb/domain";
import {
  typedRoutes,
  type PublicApiSchema,
  type StatusStateBroadcastMessage,
} from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { requirePublicThread } from "../../services/lib/entity-lookup.js";
import {
  STATUS_DATA_NO_STORE_CACHE_CONTROL,
  STATUS_STATE_CLIENT_HEADER,
  STATUS_STATE_OPERATION_HEADER,
  createStatusDataEtag,
  createStatusDataGetResponse,
  deleteStatusDataEntry,
  listStatusData,
  parseStatusDataKey,
  readStatusDataEntryOrNull,
  requireStatusDataEntry,
  statusDataRootPath,
  writeStatusDataEntry,
} from "../../services/threads/status-data-files.js";
import { resolveThreadStoragePathFromRoot } from "../../services/threads/thread-storage.js";

interface BrowserStatusStateSetPayload {
  value: JsonValue;
}

interface ThreadStatusDataTarget {
  statusDataRootPath: string;
}

interface RequireThreadStatusDataTargetArgs {
  threadId: string;
}

interface PutBrowserStatusStateArgs {
  headers: Headers;
  key: string;
  payload: BrowserStatusStateSetPayload;
  threadId: string;
}

interface DeleteBrowserStatusStateArgs {
  headers: Headers;
  key: string;
  threadId: string;
}

const browserStatusStateSetPayloadSchema = z
  .object({
    value: jsonValueSchema,
  })
  .strict();

function requireThreadStatusDataTarget(
  deps: AppDeps,
  args: RequireThreadStatusDataTargetArgs,
): ThreadStatusDataTarget {
  const thread = requirePublicThread(deps.db, args.threadId);
  const threadStoragePath = resolveThreadStoragePathFromRoot({
    threadId: thread.id,
    threadStorageRootPath: deps.config.threadStorageRootPath,
  });
  return {
    statusDataRootPath: statusDataRootPath(threadStoragePath),
  };
}

async function parseBrowserStatusStateSetPayload(
  request: Request,
): Promise<BrowserStatusStateSetPayload> {
  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    throw new ApiError(400, "invalid_request", "Request body must be JSON");
  }
  const parsed = browserStatusStateSetPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_request", "Invalid status state payload");
  }
  return parsed.data;
}

async function putBrowserStatusState(
  deps: AppDeps,
  args: PutBrowserStatusStateArgs,
): Promise<Response> {
  const key = parseStatusDataKey(args.key);
  const target = requireThreadStatusDataTarget(deps, {
    threadId: args.threadId,
  });
  const previous = await readStatusDataEntryOrNull({
    statusDataRootPath: target.statusDataRootPath,
    key,
  });
  const writeResult = await writeStatusDataEntry({
    statusDataRootPath: target.statusDataRootPath,
    key,
    value: args.payload.value,
  });
  deps.statusDataFileEvents.recordSuppressedFileEvent({
    filePath: writeResult.filePath,
    version: writeResult.version,
  });

  const message: StatusStateBroadcastMessage = {
    type: "status-data.changed",
    threadId: args.threadId,
    key,
    value: args.payload.value,
    deleted: false,
    previousValue: previous?.value ?? null,
    previousValuePresent: previous !== null,
    version: writeResult.version,
    writerClientId: args.headers.get(STATUS_STATE_CLIENT_HEADER),
    operationId: args.headers.get(STATUS_STATE_OPERATION_HEADER),
  };
  deps.statusDataFileEvents.rememberEntry({
    key,
    threadId: args.threadId,
    value: args.payload.value,
    version: writeResult.version,
  });
  deps.hub.notifyThreadStatusData(message);

  return new Response(
    JSON.stringify(createStatusDataGetResponse(writeResult)),
    {
      status: 200,
      headers: {
        "cache-control": STATUS_DATA_NO_STORE_CACHE_CONTROL,
        "content-type": "application/json",
        etag: createStatusDataEtag(writeResult.version),
      },
    },
  );
}

async function deleteBrowserStatusState(
  deps: AppDeps,
  args: DeleteBrowserStatusStateArgs,
): Promise<Response> {
  const key = parseStatusDataKey(args.key);
  const target = requireThreadStatusDataTarget(deps, {
    threadId: args.threadId,
  });
  const previous = await readStatusDataEntryOrNull({
    statusDataRootPath: target.statusDataRootPath,
    key,
  });
  const deleteResult = await deleteStatusDataEntry({
    statusDataRootPath: target.statusDataRootPath,
    key,
  });
  if (deleteResult.deleted) {
    deps.statusDataFileEvents.recordSuppressedFileEvent({
      filePath: deleteResult.filePath,
      version: null,
    });
    deps.statusDataFileEvents.forgetEntry({
      key,
      threadId: args.threadId,
    });
    const message: StatusStateBroadcastMessage = {
      type: "status-data.changed",
      threadId: args.threadId,
      key,
      value: null,
      deleted: true,
      previousValue: previous?.value ?? null,
      previousValuePresent: previous !== null,
      version: null,
      writerClientId: args.headers.get(STATUS_STATE_CLIENT_HEADER),
      operationId: args.headers.get(STATUS_STATE_OPERATION_HEADER),
    };
    deps.hub.notifyThreadStatusData(message);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "cache-control": STATUS_DATA_NO_STORE_CACHE_CONTROL,
      "content-type": "application/json",
    },
  });
}

export function registerThreadStatusDataRoutes(app: Hono, deps: AppDeps): void {
  const { get } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  get("/threads/:id/status-data", async (context) => {
    const target = requireThreadStatusDataTarget(deps, {
      threadId: context.req.param("id"),
    });
    context.header("cache-control", STATUS_DATA_NO_STORE_CACHE_CONTROL);
    return context.json(
      await listStatusData({ statusDataRootPath: target.statusDataRootPath }),
    );
  });

  get("/threads/:id/status-data/:key", async (context) => {
    const target = requireThreadStatusDataTarget(deps, {
      threadId: context.req.param("id"),
    });
    const key = parseStatusDataKey(context.req.param("key"));
    const entry = await requireStatusDataEntry({
      statusDataRootPath: target.statusDataRootPath,
      key,
    });
    context.header("cache-control", STATUS_DATA_NO_STORE_CACHE_CONTROL);
    context.header("etag", createStatusDataEtag(entry.version));
    return context.json(createStatusDataGetResponse(entry));
  });

  // Contract-private, not network-private: the injected same-origin
  // window.bbStatusState client uses this endpoint for browser mutations.
  app.put("/threads/:id/status-state/:key", async (context) => {
    return putBrowserStatusState(deps, {
      threadId: context.req.param("id"),
      key: context.req.param("key"),
      headers: context.req.raw.headers,
      payload: await parseBrowserStatusStateSetPayload(context.req.raw),
    });
  });

  app.delete("/threads/:id/status-state/:key", async (context) => {
    return deleteBrowserStatusState(deps, {
      threadId: context.req.param("id"),
      key: context.req.param("key"),
      headers: context.req.raw.headers,
    });
  });
}
