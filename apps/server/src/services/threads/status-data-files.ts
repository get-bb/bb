import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { jsonValueSchema, type JsonValue } from "@bb/domain";
import {
  statusDataKeySchema,
  type StatusDataKey,
  type ThreadStatusDataGetResponse,
  type ThreadStatusDataListResponse,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";

export const STATUS_DATA_DIRECTORY_NAME = "STATUS-data";
export const STATUS_DATA_FILE_EXTENSION = ".json";
export const STATUS_DATA_NO_STORE_CACHE_CONTROL = "no-store";
export const STATUS_STATE_CLIENT_HEADER = "x-bb-status-state-client";
export const STATUS_STATE_OPERATION_HEADER = "x-bb-status-state-operation";

interface StatusDataEntry {
  key: StatusDataKey;
  value: JsonValue;
  version: string;
  sizeBytes: number;
  modifiedAtMs: number;
}

interface ParseStatusDataJsonArgs {
  bytes: Buffer;
  key: StatusDataKey;
}

interface ReadStatusDataEntryArgs {
  key: StatusDataKey;
  statusDataRootPath: string;
}

interface RequireStatusDataEntryArgs extends ReadStatusDataEntryArgs {}

interface ListStatusDataArgs {
  statusDataRootPath: string;
}

interface WriteStatusDataEntryArgs {
  key: StatusDataKey;
  statusDataRootPath: string;
  value: JsonValue;
}

interface DeleteStatusDataEntryArgs {
  key: StatusDataKey;
  statusDataRootPath: string;
}

interface DeleteStatusDataEntryResult {
  deleted: boolean;
}

interface StatusDataCacheEntry {
  value: JsonValue;
  version: string;
}

interface StatusDataCacheKeyArgs {
  key: StatusDataKey;
  threadId: string;
}

interface RememberStatusDataEntryArgs extends StatusDataCacheKeyArgs {
  value: JsonValue;
  version: string;
}

interface SuppressedFileEvent {
  timeout: ReturnType<typeof setTimeout>;
}

interface SuppressedFileEventArgs {
  filePath: string;
  version: string | null;
}

export interface StatusDataFileWriteResult extends StatusDataEntry {
  bytes: Buffer;
  filePath: string;
}

export interface StatusDataFileDeleteResult extends DeleteStatusDataEntryResult {
  filePath: string;
}

// Unlink events do not carry bytes to hash. Delete suppression is therefore
// path-only for the short TTL; racing deletes still converge to file absence.
const SUPPRESSED_DELETE_VERSION = "<deleted>";
const STATUS_DATA_FILE_EVENT_SUPPRESSION_MS = 250;

function statusDataCacheKey(args: StatusDataCacheKeyArgs): string {
  return `${args.threadId}\0${args.key}`;
}

function suppressedFileEventKey(args: SuppressedFileEventArgs): string {
  return `${path.resolve(args.filePath)}\0${
    args.version ?? SUPPRESSED_DELETE_VERSION
  }`;
}

function getErrorCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

export function parseStatusDataKey(rawKey: string): StatusDataKey {
  const parsed = statusDataKeySchema.safeParse(rawKey);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_request", "Invalid status-data key");
  }
  return parsed.data;
}

export function statusDataRelativePath(key: StatusDataKey): string {
  return `${key}${STATUS_DATA_FILE_EXTENSION}`;
}

export function statusDataFilePath(
  statusDataRootPath: string,
  key: StatusDataKey,
): string {
  return path.join(statusDataRootPath, statusDataRelativePath(key));
}

export function statusDataRootPath(threadStoragePath: string): string {
  return path.join(threadStoragePath, STATUS_DATA_DIRECTORY_NAME);
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalizeStatusJson(value: JsonValue): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function parseStatusDataJson(args: ParseStatusDataJsonArgs): JsonValue {
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

export function createStatusDataGetResponse(
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

export function createStatusDataEtag(version: string): string {
  return `"${version}"`;
}

export async function readStatusDataEntryOrNull(
  args: ReadStatusDataEntryArgs,
): Promise<StatusDataEntry | null> {
  const filePath = statusDataFilePath(args.statusDataRootPath, args.key);
  let bytes: Buffer;
  let stat;
  try {
    bytes = await fs.readFile(filePath);
    stat = await fs.stat(filePath);
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return null;
    }
    throw error;
  }

  return {
    key: args.key,
    value: parseStatusDataJson({ key: args.key, bytes }),
    version: sha256(bytes),
    sizeBytes: stat.size,
    modifiedAtMs: stat.mtimeMs,
  };
}

export async function requireStatusDataEntry(
  args: RequireStatusDataEntryArgs,
): Promise<StatusDataEntry> {
  const entry = await readStatusDataEntryOrNull(args);
  if (!entry) {
    throw new ApiError(
      404,
      "ENOENT",
      `Path does not exist: ${statusDataRelativePath(args.key)}`,
    );
  }
  return entry;
}

export async function listStatusData(
  args: ListStatusDataArgs,
): Promise<ThreadStatusDataListResponse> {
  let entries;
  try {
    entries = await fs.readdir(args.statusDataRootPath, {
      withFileTypes: true,
    });
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return {
        values: {},
        versions: {},
        hash: sha256(Buffer.from("")),
      };
    }
    throw error;
  }

  const values: Record<StatusDataKey, JsonValue> = {};
  const versions: Record<StatusDataKey, string> = {};
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(STATUS_DATA_FILE_EXTENSION)) {
      continue;
    }
    const rawKey = entry.name.slice(0, -STATUS_DATA_FILE_EXTENSION.length);
    const parsedKey = statusDataKeySchema.safeParse(rawKey);
    if (!parsedKey.success) {
      continue;
    }
    const statusEntry = await requireStatusDataEntry({
      statusDataRootPath: args.statusDataRootPath,
      key: parsedKey.data,
    });
    values[statusEntry.key] = statusEntry.value;
    versions[statusEntry.key] = statusEntry.version;
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

export async function writeStatusDataEntry(
  args: WriteStatusDataEntryArgs,
): Promise<StatusDataFileWriteResult> {
  await fs.mkdir(args.statusDataRootPath, { recursive: true });
  const filePath = statusDataFilePath(args.statusDataRootPath, args.key);
  const content = canonicalizeStatusJson(args.value);
  const bytes = Buffer.from(content, "utf8");
  const tempPath = path.join(
    args.statusDataRootPath,
    `.${args.key}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );

  await fs.writeFile(tempPath, bytes, { flag: "wx" });
  try {
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }

  const stat = await fs.stat(filePath);
  return {
    bytes,
    filePath,
    key: args.key,
    value: args.value,
    version: sha256(bytes),
    sizeBytes: stat.size,
    modifiedAtMs: stat.mtimeMs,
  };
}

export async function deleteStatusDataEntry(
  args: DeleteStatusDataEntryArgs,
): Promise<StatusDataFileDeleteResult> {
  const filePath = statusDataFilePath(args.statusDataRootPath, args.key);
  try {
    await fs.rm(filePath);
    return {
      deleted: true,
      filePath,
    };
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return {
        deleted: false,
        filePath,
      };
    }
    throw error;
  }
}

export class StatusDataFileEventState {
  private readonly cache = new Map<string, StatusDataCacheEntry>();
  private readonly suppressedFileEvents = new Map<
    string,
    SuppressedFileEvent
  >();

  getCachedEntry(args: StatusDataCacheKeyArgs): StatusDataCacheEntry | null {
    return this.cache.get(statusDataCacheKey(args)) ?? null;
  }

  rememberEntry(args: RememberStatusDataEntryArgs): void {
    this.cache.set(statusDataCacheKey(args), {
      value: args.value,
      version: args.version,
    });
  }

  forgetEntry(args: StatusDataCacheKeyArgs): StatusDataCacheEntry | null {
    const key = statusDataCacheKey(args);
    const existing = this.cache.get(key) ?? null;
    this.cache.delete(key);
    return existing;
  }

  recordSuppressedFileEvent(args: SuppressedFileEventArgs): void {
    const key = suppressedFileEventKey(args);
    const existing = this.suppressedFileEvents.get(key);
    if (existing) {
      clearTimeout(existing.timeout);
    }
    const timeout = setTimeout(() => {
      this.suppressedFileEvents.delete(key);
    }, STATUS_DATA_FILE_EVENT_SUPPRESSION_MS);
    timeout.unref();
    this.suppressedFileEvents.set(key, { timeout });
  }

  consumeSuppressedFileEvent(args: SuppressedFileEventArgs): boolean {
    const key = suppressedFileEventKey(args);
    const existing = this.suppressedFileEvents.get(key);
    if (!existing) {
      return false;
    }
    clearTimeout(existing.timeout);
    this.suppressedFileEvents.delete(key);
    return true;
  }

  dispose(): void {
    for (const event of this.suppressedFileEvents.values()) {
      clearTimeout(event.timeout);
    }
    this.suppressedFileEvents.clear();
    this.cache.clear();
  }
}
