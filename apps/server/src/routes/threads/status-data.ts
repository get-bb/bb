import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Hono } from "hono";
import type {
  HostDaemonCommand,
  HostFileRelativePrecondition,
} from "@bb/host-daemon-contract";
import { jsonValueSchema, type JsonValue } from "@bb/domain";
import {
  statusDataKeySchema,
  threadStatusDataPutRequestSchema,
  typedRoutes,
  type PublicApiSchema,
  type StatusDataKey,
  type StatusStateBroadcastMessage,
  type ThreadStatusDataGetResponse,
  type ThreadStatusDataListResponse,
  type ThreadStatusDataPutResponse,
} from "@bb/server-contract";
import type { AppDeps, LoggedWorkSessionDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import { queueCommandAndWait } from "../../services/hosts/command-wait.js";
import {
  decodeDaemonFileContent,
  type DaemonFileReadResult,
} from "../../services/hosts/daemon-file-response.js";
import { requireThreadStorageTarget } from "./data.js";

interface StatusDataEntry {
  key: StatusDataKey;
  value: JsonValue;
  version: string;
  sizeBytes: number;
  modifiedAtMs: number;
}

interface StatusDataWriteHeaders {
  operationId: string | null;
  precondition: HostFileRelativePrecondition;
  writerClientId: string | null;
}

interface ParseStatusDataJsonArgs {
  bytes: Buffer;
  key: StatusDataKey;
}

interface StatusDataEntryTarget {
  hostId: string;
  key: StatusDataKey;
  rootPath: string;
}

interface PutStatusDataArgs {
  headers: Headers;
  key: StatusDataKey;
  threadId: string;
  value: JsonValue;
}

interface DeleteStatusDataArgs {
  headers: Headers;
  key: StatusDataKey;
  threadId: string;
}

type HostReadRelativeCommand = Extract<
  HostDaemonCommand,
  { type: "host.read_file_relative" }
>;

type HostFileMetadataCommand = Extract<
  HostDaemonCommand,
  { type: "host.file_metadata" }
>;

const STATUS_DATA_DIRECTORY_NAME = "STATUS-data";
const STATUS_DATA_FILE_EXTENSION = ".json";
const STATUS_DATA_NO_STORE_CACHE_CONTROL = "no-store";
const STATUS_STATE_CLIENT_HEADER = "x-bb-status-state-client";
const STATUS_STATE_OPERATION_HEADER = "x-bb-status-state-operation";

function parseStatusDataKey(rawKey: string): StatusDataKey {
  const parsed = statusDataKeySchema.safeParse(rawKey);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_request", "Invalid status-data key");
  }
  return parsed.data;
}

function statusDataRelativePath(key: StatusDataKey): string {
  return `${key}${STATUS_DATA_FILE_EXTENSION}`;
}

function statusDataRootPath(storagePath: string): string {
  return path.join(storagePath, STATUS_DATA_DIRECTORY_NAME);
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalizeStatusJson(value: JsonValue): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function decodeStatusDataBytes(result: DaemonFileReadResult): Buffer {
  return Buffer.from(decodeDaemonFileContent(result));
}

function parseStatusDataJson(args: ParseStatusDataJsonArgs): JsonValue {
  try {
    return jsonValueSchema.parse(JSON.parse(args.bytes.toString("utf8")));
  } catch {
    throw new ApiError(
      422,
      "invalid_json",
      `STATUS-data/${args.key}.json does not contain valid JSON`,
    );
  }
}

function createStatusDataGetResponse(
  entry: StatusDataEntry,
): ThreadStatusDataGetResponse {
  return {
    key: entry.key,
    value: entry.value,
    version: entry.version,
    sizeBytes: entry.sizeBytes,
    modifiedAtMs: entry.modifiedAtMs,
  };
}

function createStatusDataEtag(version: string): string {
  return `"${version}"`;
}

function normalizeEntityTag(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseWriteHeaders(headers: Headers): StatusDataWriteHeaders {
  const ifMatch = headers.get("if-match");
  const ifNoneMatch = headers.get("if-none-match");
  if (ifMatch !== null && ifNoneMatch !== null) {
    throw new ApiError(
      400,
      "invalid_request",
      "Use either If-Match or If-None-Match, not both",
    );
  }

  let precondition: HostFileRelativePrecondition = { type: "none" };
  if (ifMatch !== null) {
    const tag = normalizeEntityTag(ifMatch);
    precondition = tag === "*" ? { type: "exists" } : { type: "hash", hash: tag };
  }
  if (ifNoneMatch !== null) {
    const tag = normalizeEntityTag(ifNoneMatch);
    if (tag !== "*") {
      throw new ApiError(
        400,
        "invalid_request",
        "If-None-Match only supports * for status-data writes",
      );
    }
    precondition = { type: "absent" };
  }

  return {
    precondition,
    writerClientId: headers.get(STATUS_STATE_CLIENT_HEADER),
    operationId: headers.get(STATUS_STATE_OPERATION_HEADER),
  };
}

// Daemon command waits are an external async boundary and may reject with
// ApiError envelopes or lower-level transport/runtime errors.
function remapStatusDataDaemonError(error: unknown): never {
  if (!(error instanceof ApiError)) {
    throw error;
  }
  if (error.body.code === "ENOENT") {
    throw new ApiError(404, error.body.code, error.body.message);
  }
  if (error.body.code === "invalid_path") {
    throw new ApiError(400, error.body.code, error.body.message);
  }
  if (error.body.code === "file_too_large") {
    throw new ApiError(413, error.body.code, error.body.message);
  }
  if (error.body.code === "precondition_failed") {
    throw new ApiError(412, error.body.code, error.body.message);
  }
  throw error;
}

async function readStatusDataEntryOrNull(
  deps: LoggedWorkSessionDeps,
  args: StatusDataEntryTarget,
): Promise<StatusDataEntry | null> {
  const relativePath = statusDataRelativePath(args.key);
  let result: DaemonFileReadResult;
  try {
    const command: HostReadRelativeCommand = {
      type: "host.read_file_relative",
      rootPath: args.rootPath,
      path: relativePath,
      dotfiles: "deny",
    };
    result = await queueCommandAndWait(deps, {
      hostId: args.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command,
    });
  } catch (error) {
    if (error instanceof ApiError && error.body.code === "ENOENT") {
      return null;
    }
    remapStatusDataDaemonError(error);
  }

  const bytes = decodeStatusDataBytes(result);
  const metadataCommand: HostFileMetadataCommand = {
    type: "host.file_metadata",
    rootPath: args.rootPath,
    path: path.join(args.rootPath, relativePath),
  };
  const metadata = await queueCommandAndWait(deps, {
    hostId: args.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: metadataCommand,
  }).catch((error) => remapStatusDataDaemonError(error));

  return {
    key: args.key,
    value: parseStatusDataJson({ key: args.key, bytes }),
    version: sha256(bytes),
    sizeBytes: metadata.sizeBytes,
    modifiedAtMs: metadata.modifiedAtMs,
  };
}

async function requireStatusDataEntry(
  deps: LoggedWorkSessionDeps,
  args: StatusDataEntryTarget,
): Promise<StatusDataEntry> {
  const entry = await readStatusDataEntryOrNull(deps, args);
  if (!entry) {
    throw new ApiError(
      404,
      "ENOENT",
      `Path does not exist: ${statusDataRelativePath(args.key)}`,
    );
  }
  return entry;
}

async function listStatusData(
  deps: LoggedWorkSessionDeps,
  threadId: string,
): Promise<ThreadStatusDataListResponse> {
  const target = await requireThreadStorageTarget(deps, { threadId });
  const rootPath = statusDataRootPath(target.storagePath);
  const listResult = await queueCommandAndWait(deps, {
    hostId: target.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "host.list_files",
      path: rootPath,
      limit: 10_000,
    },
  }).catch((error) => {
    if (error instanceof ApiError && error.body.code === "ENOENT") {
      return { files: [], truncated: false };
    }
    remapStatusDataDaemonError(error);
  });

  const values: Record<StatusDataKey, JsonValue> = {};
  const versions: Record<StatusDataKey, string> = {};
  for (const file of listResult.files) {
    if (!file.path.endsWith(STATUS_DATA_FILE_EXTENSION)) {
      continue;
    }
    const rawKey = file.path.slice(0, -STATUS_DATA_FILE_EXTENSION.length);
    if (rawKey.includes("/")) {
      continue;
    }
    const parsedKey = statusDataKeySchema.safeParse(rawKey);
    if (!parsedKey.success) {
      continue;
    }
    const entry = await requireStatusDataEntry(deps, {
      hostId: target.hostId,
      rootPath,
      key: parsedKey.data,
    });
    values[entry.key] = entry.value;
    versions[entry.key] = entry.version;
  }

  const aggregateHash = createHash("sha256");
  for (const key of Object.keys(versions).sort()) {
    aggregateHash.update(`${key}\0${versions[key]}\n`);
  }
  return {
    values,
    versions,
    hash: aggregateHash.digest("hex"),
  };
}

async function putStatusData(
  deps: LoggedWorkSessionDeps,
  args: PutStatusDataArgs,
): Promise<ThreadStatusDataPutResponse> {
  const target = await requireThreadStorageTarget(deps, {
    threadId: args.threadId,
  });
  const rootPath = statusDataRootPath(target.storagePath);
  const previous = await readStatusDataEntryOrNull(deps, {
    hostId: target.hostId,
    rootPath,
    key: args.key,
  });
  const writeHeaders = parseWriteHeaders(args.headers);
  const content = canonicalizeStatusJson(args.value);
  const writeResult = await queueCommandAndWait(deps, {
    hostId: target.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "host.write_file_relative",
      rootPath,
      path: statusDataRelativePath(args.key),
      dotfiles: "deny",
      content,
      contentEncoding: "utf8",
      precondition: writeHeaders.precondition,
    },
  }).catch((error) => remapStatusDataDaemonError(error));

  const response: ThreadStatusDataPutResponse = {
    key: args.key,
    value: args.value,
    version: writeResult.hash,
    sizeBytes: writeResult.sizeBytes,
    modifiedAtMs: writeResult.modifiedAtMs,
  };
  const message: StatusStateBroadcastMessage = {
    type: "status-data.changed",
    threadId: args.threadId,
    key: args.key,
    value: args.value,
    deleted: false,
    previousValue: previous?.value ?? null,
    previousValuePresent: previous !== null,
    version: writeResult.hash,
    writerClientId: writeHeaders.writerClientId,
    operationId: writeHeaders.operationId,
  };
  deps.hub.notifyThreadStatusData(message);
  return response;
}

async function deleteStatusData(
  deps: LoggedWorkSessionDeps,
  args: DeleteStatusDataArgs,
): Promise<{ ok: true }> {
  const target = await requireThreadStorageTarget(deps, {
    threadId: args.threadId,
  });
  const rootPath = statusDataRootPath(target.storagePath);
  const previous = await readStatusDataEntryOrNull(deps, {
    hostId: target.hostId,
    rootPath,
    key: args.key,
  });
  const writeHeaders = parseWriteHeaders(args.headers);
  const deleteResult = await queueCommandAndWait(deps, {
    hostId: target.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "host.delete_file_relative",
      rootPath,
      path: statusDataRelativePath(args.key),
      dotfiles: "deny",
      precondition: writeHeaders.precondition,
    },
  }).catch((error) => remapStatusDataDaemonError(error));

  if (deleteResult.deleted) {
    const message: StatusStateBroadcastMessage = {
      type: "status-data.changed",
      threadId: args.threadId,
      key: args.key,
      value: null,
      deleted: true,
      previousValue: previous?.value ?? null,
      previousValuePresent: previous !== null,
      version: null,
      writerClientId: writeHeaders.writerClientId,
      operationId: writeHeaders.operationId,
    };
    deps.hub.notifyThreadStatusData(message);
  }
  return { ok: true };
}

export function registerThreadStatusDataRoutes(app: Hono, deps: AppDeps): void {
  const { get, put, del } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  get("/threads/:id/status-data", async (context) => {
    context.header("cache-control", STATUS_DATA_NO_STORE_CACHE_CONTROL);
    return context.json(await listStatusData(deps, context.req.param("id")));
  });

  get("/threads/:id/status-data/:key", async (context) => {
    const target = await requireThreadStorageTarget(deps, {
      threadId: context.req.param("id"),
    });
    const key = parseStatusDataKey(context.req.param("key"));
    const entry = await requireStatusDataEntry(deps, {
      hostId: target.hostId,
      rootPath: statusDataRootPath(target.storagePath),
      key,
    });
    context.header("cache-control", STATUS_DATA_NO_STORE_CACHE_CONTROL);
    context.header("etag", createStatusDataEtag(entry.version));
    return context.json(createStatusDataGetResponse(entry));
  });

  put(
    "/threads/:id/status-data/:key",
    threadStatusDataPutRequestSchema,
    async (context, payload) => {
      context.header("cache-control", STATUS_DATA_NO_STORE_CACHE_CONTROL);
      const response = await putStatusData(deps, {
        threadId: context.req.param("id"),
        key: parseStatusDataKey(context.req.param("key")),
        value: payload.value,
        headers: context.req.raw.headers,
      });
      context.header("etag", createStatusDataEtag(response.version));
      return context.json(response);
    },
  );

  del("/threads/:id/status-data/:key", async (context) => {
    context.header("cache-control", STATUS_DATA_NO_STORE_CACHE_CONTROL);
    return context.json(
      await deleteStatusData(deps, {
        threadId: context.req.param("id"),
        key: parseStatusDataKey(context.req.param("key")),
        headers: context.req.raw.headers,
      }),
    );
  });
}
