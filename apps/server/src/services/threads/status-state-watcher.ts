import fs from "node:fs/promises";
import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import { jsonValueSchema, type JsonValue } from "@bb/domain";
import {
  statusDataKeySchema,
  type StatusDataKey,
  type StatusStateBroadcastMessage,
} from "@bb/server-contract";
import type { ServerLogger } from "../../types.js";
import type { NotificationHub } from "../../ws/hub.js";
import {
  STATUS_DATA_DIRECTORY_NAME,
  STATUS_DATA_FILE_EXTENSION,
  StatusDataFileEventState,
  sha256,
} from "./status-data-files.js";

interface StatusDataFilePathParts {
  filePath: string;
  key: StatusDataKey;
  threadId: string;
}

interface ParseStatusDataFilePathArgs {
  filePath: string;
  logger: ServerLogger;
  rootPath: string;
  warnInvalidKey: boolean;
}

interface ParseStatusDataJsonForWatcherArgs {
  bytes: Buffer;
  filePath: string;
  key: StatusDataKey;
  logger: ServerLogger;
  threadId: string;
}

interface ParsedStatusDataJsonForWatcher {
  ok: true;
  value: JsonValue;
}

interface RejectedStatusDataJsonForWatcher {
  ok: false;
}

type ParseStatusDataJsonForWatcherResult =
  | ParsedStatusDataJsonForWatcher
  | RejectedStatusDataJsonForWatcher;

interface HandleStatusDataFileSetArgs {
  events: StatusDataFileEventState;
  filePath: string;
  hub: NotificationHub;
  logger: ServerLogger;
  rootPath: string;
}

interface HandleStatusDataFileUnlinkArgs {
  events: StatusDataFileEventState;
  filePath: string;
  hub: NotificationHub;
  logger: ServerLogger;
  rootPath: string;
}

interface HandleStatusDataDirectoryAddArgs {
  dirPath: string;
  events: StatusDataFileEventState;
  hub: NotificationHub;
  logger: ServerLogger;
  rootPath: string;
}

interface PrimeStatusDataCacheArgs {
  events: StatusDataFileEventState;
  logger: ServerLogger;
  rootPath: string;
}

interface StartStatusStateFileWatcherArgs {
  events: StatusDataFileEventState;
  hub: NotificationHub;
  logger: ServerLogger;
  rootPath: string;
}

export interface StatusStateFileWatcher {
  close(): Promise<void>;
}

const STATUS_DATA_AWAIT_WRITE_FINISH_MS = 25;
const STATUS_DATA_AWAIT_WRITE_POLL_MS = 10;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Unknown error";
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

function isHiddenStatusDataFile(filePath: string): boolean {
  return path.basename(filePath).startsWith(".");
}

function parseStatusDataFilePath(
  args: ParseStatusDataFilePathArgs,
): StatusDataFilePathParts | null {
  if (isHiddenStatusDataFile(args.filePath)) {
    return null;
  }
  if (!args.filePath.endsWith(STATUS_DATA_FILE_EXTENSION)) {
    return null;
  }

  const relativePath = path.relative(args.rootPath, args.filePath);
  if (
    relativePath.length === 0 ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    return null;
  }

  const parts = relativePath.split(path.sep);
  if (parts[1] !== STATUS_DATA_DIRECTORY_NAME) {
    return null;
  }

  const fileName = parts[parts.length - 1];
  if (
    parts.length !== 3 ||
    !fileName ||
    fileName.length <= STATUS_DATA_FILE_EXTENSION.length
  ) {
    if (args.warnInvalidKey) {
      args.logger.warn(
        {
          filePath: args.filePath,
          key: parts.slice(2).join("/"),
          threadId: parts[0],
        },
        "Ignoring STATUS-data file with invalid key",
      );
    }
    return null;
  }

  const rawKey = fileName.slice(0, -STATUS_DATA_FILE_EXTENSION.length);
  const parsedKey = statusDataKeySchema.safeParse(rawKey);
  if (!parsedKey.success) {
    if (args.warnInvalidKey) {
      args.logger.warn(
        {
          filePath: args.filePath,
          key: rawKey,
          threadId: parts[0],
        },
        "Ignoring STATUS-data file with invalid key",
      );
    }
    return null;
  }

  return {
    filePath: args.filePath,
    key: parsedKey.data,
    threadId: parts[0],
  };
}

function parseStatusDataJsonForWatcher(
  args: ParseStatusDataJsonForWatcherArgs,
): ParseStatusDataJsonForWatcherResult {
  try {
    return {
      ok: true,
      value: jsonValueSchema.parse(JSON.parse(args.bytes.toString("utf8"))),
    };
  } catch (error) {
    args.logger.warn(
      {
        byteLength: args.bytes.byteLength,
        error: getErrorMessage(error),
        filePath: args.filePath,
        key: args.key,
        threadId: args.threadId,
      },
      "Ignoring malformed STATUS-data JSON",
    );
    return { ok: false };
  }
}

async function handleStatusDataFileSet(
  args: HandleStatusDataFileSetArgs,
): Promise<void> {
  const parts = parseStatusDataFilePath({
    filePath: args.filePath,
    logger: args.logger,
    rootPath: args.rootPath,
    warnInvalidKey: true,
  });
  if (!parts) {
    return;
  }

  let bytes: Buffer;
  try {
    bytes = await fs.readFile(parts.filePath);
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return;
    }
    throw error;
  }

  const version = sha256(bytes);
  if (
    args.events.consumeSuppressedFileEvent({
      filePath: parts.filePath,
      version,
    })
  ) {
    return;
  }

  const parsedValue = parseStatusDataJsonForWatcher({
    bytes,
    filePath: parts.filePath,
    key: parts.key,
    logger: args.logger,
    threadId: parts.threadId,
  });
  if (!parsedValue.ok) {
    return;
  }
  const value = parsedValue.value;

  const previous = args.events.getCachedEntry({
    key: parts.key,
    threadId: parts.threadId,
  });
  if (previous?.version === version) {
    return;
  }

  args.events.rememberEntry({
    key: parts.key,
    threadId: parts.threadId,
    value,
    version,
  });

  const message: StatusStateBroadcastMessage = {
    type: "status-data.changed",
    threadId: parts.threadId,
    key: parts.key,
    value,
    deleted: false,
    previousValue: previous?.value ?? null,
    previousValuePresent: previous !== null,
    version,
    writerClientId: null,
    operationId: null,
  };
  args.hub.notifyThreadStatusData(message);
}

async function handleStatusDataFileUnlink(
  args: HandleStatusDataFileUnlinkArgs,
): Promise<void> {
  const parts = parseStatusDataFilePath({
    filePath: args.filePath,
    logger: args.logger,
    rootPath: args.rootPath,
    warnInvalidKey: true,
  });
  if (!parts) {
    return;
  }

  if (
    args.events.consumeSuppressedFileEvent({
      filePath: parts.filePath,
      version: null,
    })
  ) {
    return;
  }

  const previous = args.events.forgetEntry({
    key: parts.key,
    threadId: parts.threadId,
  });
  const message: StatusStateBroadcastMessage = {
    type: "status-data.changed",
    threadId: parts.threadId,
    key: parts.key,
    value: null,
    deleted: true,
    previousValue: previous?.value ?? null,
    previousValuePresent: previous !== null,
    version: null,
    writerClientId: null,
    operationId: null,
  };
  args.hub.notifyThreadStatusData(message);
}

async function handleStatusDataDirectoryAdd(
  args: HandleStatusDataDirectoryAddArgs,
): Promise<void> {
  const relativePath = path.relative(args.rootPath, args.dirPath);
  if (
    relativePath.length === 0 ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    return;
  }

  const parts = relativePath.split(path.sep);
  if (parts.length !== 2 || parts[1] !== STATUS_DATA_DIRECTORY_NAME) {
    return;
  }

  let entries;
  try {
    entries = await fs.readdir(args.dirPath, { withFileTypes: true });
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    await handleStatusDataFileSet({
      events: args.events,
      filePath: path.join(args.dirPath, entry.name),
      hub: args.hub,
      logger: args.logger,
      rootPath: args.rootPath,
    });
  }
}

async function primeStatusDataCache(
  args: PrimeStatusDataCacheArgs,
): Promise<void> {
  let threadEntries;
  try {
    threadEntries = await fs.readdir(args.rootPath, { withFileTypes: true });
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const threadEntry of threadEntries) {
    if (!threadEntry.isDirectory()) {
      continue;
    }
    const statusDataRootPath = path.join(
      args.rootPath,
      threadEntry.name,
      STATUS_DATA_DIRECTORY_NAME,
    );
    let statusDataEntries;
    try {
      statusDataEntries = await fs.readdir(statusDataRootPath, {
        withFileTypes: true,
      });
    } catch (error) {
      if (getErrorCode(error) === "ENOENT") {
        continue;
      }
      throw error;
    }

    for (const statusDataEntry of statusDataEntries) {
      if (!statusDataEntry.isFile()) {
        continue;
      }
      const filePath = path.join(statusDataRootPath, statusDataEntry.name);
      const parts = parseStatusDataFilePath({
        filePath,
        logger: args.logger,
        rootPath: args.rootPath,
        warnInvalidKey: true,
      });
      if (!parts) {
        continue;
      }
      const bytes = await fs.readFile(filePath);
      const parsedValue = parseStatusDataJsonForWatcher({
        bytes,
        filePath,
        key: parts.key,
        logger: args.logger,
        threadId: parts.threadId,
      });
      if (!parsedValue.ok) {
        continue;
      }
      args.events.rememberEntry({
        key: parts.key,
        threadId: parts.threadId,
        value: parsedValue.value,
        version: sha256(bytes),
      });
    }
  }
}

function waitForWatcherReady(watcher: FSWatcher): Promise<void> {
  return new Promise<void>((resolvePromise, reject) => {
    watcher.once("ready", resolvePromise);
    watcher.once("error", reject);
  });
}

export async function startStatusStateFileWatcher(
  args: StartStatusStateFileWatcherArgs,
): Promise<StatusStateFileWatcher> {
  await fs.mkdir(args.rootPath, { recursive: true });
  await primeStatusDataCache({
    events: args.events,
    logger: args.logger,
    rootPath: args.rootPath,
  });

  const watcher = watch(args.rootPath, {
    awaitWriteFinish: {
      stabilityThreshold: STATUS_DATA_AWAIT_WRITE_FINISH_MS,
      pollInterval: STATUS_DATA_AWAIT_WRITE_POLL_MS,
    },
    ignoreInitial: true,
    ignored: isHiddenStatusDataFile,
  });

  watcher.on("addDir", (dirPath) => {
    void handleStatusDataDirectoryAdd({
      dirPath,
      events: args.events,
      hub: args.hub,
      logger: args.logger,
      rootPath: args.rootPath,
    }).catch((error) => {
      args.logger.warn(
        {
          err: error,
          dirPath,
        },
        "Failed to scan added STATUS-data directory",
      );
    });
  });
  watcher.on("add", (filePath) => {
    void handleStatusDataFileSet({
      events: args.events,
      filePath,
      hub: args.hub,
      logger: args.logger,
      rootPath: args.rootPath,
    }).catch((error) => {
      args.logger.warn(
        {
          err: error,
          filePath,
        },
        "Failed to process STATUS-data file add",
      );
    });
  });
  watcher.on("change", (filePath) => {
    void handleStatusDataFileSet({
      events: args.events,
      filePath,
      hub: args.hub,
      logger: args.logger,
      rootPath: args.rootPath,
    }).catch((error) => {
      args.logger.warn(
        {
          err: error,
          filePath,
        },
        "Failed to process STATUS-data file change",
      );
    });
  });
  watcher.on("unlink", (filePath) => {
    void handleStatusDataFileUnlink({
      events: args.events,
      filePath,
      hub: args.hub,
      logger: args.logger,
      rootPath: args.rootPath,
    }).catch((error) => {
      args.logger.warn(
        {
          err: error,
          filePath,
        },
        "Failed to process STATUS-data file unlink",
      );
    });
  });
  watcher.on("error", (error) => {
    args.logger.warn(
      {
        err: error,
        rootPath: args.rootPath,
      },
      "STATUS-data watcher error",
    );
  });

  await waitForWatcherReady(watcher);

  return {
    close: () => watcher.close(),
  };
}
