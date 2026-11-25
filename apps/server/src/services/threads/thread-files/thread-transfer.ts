import {
  acquireProjectAttachmentOwnership,
  cancelThreadPurge,
  getProject,
  getThread,
  getThreadPurge,
  insertHiddenThreadRow,
  insertThreadHistoryRows,
  insertThreadTableRow,
  listThreadAttachments,
  readThreadEventWindow,
  readThreadTableRowsPage,
  requestThreadPurge,
  restartThreadArchiveClock,
  THREAD_FILE_TABLES,
  unhideImportedThread,
  type DbConnection,
  type ThreadFileAttachment,
  type ThreadFileTableRow,
  type ThreadHistoryEventRow,
} from "@bb/db";
import { ApiError } from "../../../errors.js";
import type { AppDeps } from "../../../types.js";
import {
  readAttachment,
  restoreProjectAttachment,
} from "../../projects/attachments.js";
import { holdThreadPurge } from "../thread-purge.js";
import {
  THREAD_FILE_FRAME_RAW_BYTES,
  ThreadFileError,
  ThreadFileWriter,
  openThreadFile,
  readThreadFileFrame,
  type OpenThreadFile,
  type ThreadFileHeader,
} from "./thread-file.js";

type ThreadFileDeps = Pick<AppDeps, "config" | "db" | "hub" | "logger">;

const THREAD_FILE_WINDOW_ROWS = 128;
const THREAD_FILE_WINDOW_BYTES = 128 * 1024;
const ATTACHMENT_PART_BYTES = 512 * 1024;
const TABLE_ROWS_PER_STEP = 256;

interface ThreadFileAttachmentContent {
  content: Buffer;
  mimeType: string | null;
  originalName: string;
  storedPath: string;
}

interface AttachmentInProgress {
  content: Buffer;
  nextIndex: number;
  parts: number;
  storedPath: string;
}

interface ThreadFileSummary {
  packedBytes: number;
  rawBytes: number;
  rows: number;
}

interface ThreadFileImportResult {
  rows: number;
  threadId: string;
}

function threadFileHeader(
  db: DbConnection,
  threadId: string,
  exportedAt: number,
): ThreadFileHeader | null {
  const thread = getThread(db, threadId);
  if (thread === null) return null;
  return {
    archivedAt: thread.archivedAt,
    createdAt: thread.createdAt,
    exportedAt,
    projectId: thread.projectId,
    projectName: getProject(db, thread.projectId)?.name ?? null,
    providerId: thread.providerId,
    threadId,
    title: thread.title ?? thread.titleFallback,
  };
}

type ExportPhase = "tables" | "events" | "attachments" | "done";

class ThreadFileExport {
  private phase: ExportPhase = "tables";
  private tableIndex = 0;
  private tableAfterRowid = 0;
  private afterSequence = 0;
  private attachments: ThreadFileAttachment[] = [];
  private attachment: AttachmentInProgress | null = null;

  private constructor(
    private readonly deps: Pick<ThreadFileDeps, "config" | "db">,
    private readonly writer: ThreadFileWriter,
    readonly threadId: string,
    private readonly projectId: string,
  ) {}

  static async start(
    deps: Pick<ThreadFileDeps, "config" | "db">,
    args: { path: string; threadId: string },
  ): Promise<ThreadFileExport | null> {
    const header = threadFileHeader(deps.db, args.threadId, Date.now());
    if (header === null) return null;
    const writer = await ThreadFileWriter.create({ header, path: args.path });
    return new ThreadFileExport(deps, writer, args.threadId, header.projectId);
  }

  private async flushIfFull(): Promise<void> {
    if (this.writer.pendingRawBytes >= THREAD_FILE_FRAME_RAW_BYTES) {
      await this.writer.flushFrameInBackground();
    }
  }

  async step(): Promise<boolean> {
    switch (this.phase) {
      case "tables": {
        const table = THREAD_FILE_TABLES[this.tableIndex];
        if (table === undefined) {
          this.attachments = listThreadAttachments(this.deps.db, this.threadId);
          this.phase = "events";
          return true;
        }
        const page = readThreadTableRowsPage(this.deps.db, {
          afterRowid: this.tableAfterRowid,
          limit: TABLE_ROWS_PER_STEP,
          table,
          threadId: this.threadId,
        });
        this.writer.addTableRows(page.rows);
        if (page.lastRowid === null || page.rows.length < TABLE_ROWS_PER_STEP) {
          this.tableIndex += 1;
          this.tableAfterRowid = 0;
        } else {
          this.tableAfterRowid = page.lastRowid;
        }
        await this.flushIfFull();
        return true;
      }
      case "events": {
        const window = readThreadEventWindow(this.deps.db, {
          afterSequence: this.afterSequence,
          maxBytes: THREAD_FILE_WINDOW_BYTES,
          maxRows: THREAD_FILE_WINDOW_ROWS,
          threadId: this.threadId,
        });
        if (window.lastSequence === null) {
          this.phase = "attachments";
          return true;
        }
        this.afterSequence = window.lastSequence;
        this.writer.addWindow(window.rows, window.retained);
        await this.flushIfFull();
        return true;
      }
      case "attachments": {
        if (this.attachment !== null) {
          const current = this.attachment;
          const start = current.nextIndex * ATTACHMENT_PART_BYTES;
          this.writer.addAttachmentPart({
            data: current.content.subarray(
              start,
              start + ATTACHMENT_PART_BYTES,
            ),
            index: current.nextIndex,
            storedPath: current.storedPath,
          });
          current.nextIndex += 1;
          if (current.nextIndex >= current.parts) this.attachment = null;
          await this.flushIfFull();
          return true;
        }
        const attachment = this.attachments.shift();
        if (attachment === undefined) {
          this.phase = "done";
          return false;
        }
        const content = await readAttachment(
          this.deps.config.dataDir,
          this.projectId,
          attachment.storedPath,
        ).catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 404) return null;
          throw error;
        });
        if (content === null) return true;
        const parts = Math.ceil(content.content.length / ATTACHMENT_PART_BYTES);
        this.writer.addAttachment({
          mimeType: attachment.mimeType,
          originalName: attachment.originalName,
          parts,
          sizeBytes: content.content.length,
          storedPath: attachment.storedPath,
        });
        if (parts > 0) {
          this.attachment = {
            content: content.content,
            nextIndex: 0,
            parts,
            storedPath: attachment.storedPath,
          };
        }
        return true;
      }
      case "done":
        return false;
    }
  }

  seal(): Promise<ThreadFileSummary> {
    return this.writer.seal();
  }

  abort(): Promise<void> {
    return this.writer.abort();
  }
}

export async function exportThreadFile(
  deps: ThreadFileDeps,
  args: { path: string; threadId: string },
): Promise<ThreadFileSummary> {
  const release = holdThreadPurge(args.threadId, "shared");
  try {
    if (getThreadPurge(deps.db, args.threadId)?.startedAt != null) {
      throw new ApiError(
        409,
        "thread_being_purged",
        `Thread ${args.threadId} is being removed from the database and can no longer be exported`,
      );
    }
    const exporter = await ThreadFileExport.start(deps, {
      path: args.path,
      threadId: args.threadId,
    });
    if (exporter === null) {
      throw new ApiError(404, "thread_not_found", "Thread not found");
    }
    try {
      while (await exporter.step()) await yieldToEventLoop();
      return await exporter.seal();
    } catch (error) {
      await exporter.abort();
      throw error;
    }
  } finally {
    release();
  }
}

const INSERT_BATCH_ROWS = 16;
const INSERT_BATCH_BYTES = 64 * 1024;
const INSERT_SLICE_MS = 8;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function insertBatches(
  rows: readonly ThreadHistoryEventRow[],
): ThreadHistoryEventRow[][] {
  const batches: ThreadHistoryEventRow[][] = [];
  let batch: ThreadHistoryEventRow[] = [];
  let bytes = 0;
  for (const row of rows) {
    const rowBytes = Buffer.byteLength(row.data);
    if (
      batch.length > 0 &&
      (batch.length >= INSERT_BATCH_ROWS ||
        bytes + rowBytes > INSERT_BATCH_BYTES)
    ) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(row);
    bytes += rowBytes;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

async function insertInSlices<T>(
  deps: Pick<AppDeps, "db">,
  items: readonly T[],
  insert: (
    tx: Parameters<Parameters<AppDeps["db"]["transaction"]>[0]>[0],
    item: T,
  ) => void,
): Promise<void> {
  let index = 0;
  while (index < items.length) {
    const startedAt = performance.now();
    deps.db.transaction(
      (tx) => {
        do {
          const item = items[index];
          index += 1;
          if (item !== undefined) insert(tx, item);
        } while (
          index < items.length &&
          performance.now() - startedAt < INSERT_SLICE_MS
        );
      },
      { behavior: "immediate" },
    );
    await yieldToEventLoop();
  }
}

async function insertThreadFileEvents(
  deps: Pick<AppDeps, "db">,
  file: OpenThreadFile,
): Promise<void> {
  for (const entry of file.table.frames) {
    if (entry.rows === 0) continue;
    const frame = await readThreadFileFrame(file, entry);
    const now = Date.now();
    await insertInSlices(deps, insertBatches(frame.rows), (tx, rows) => {
      const eventIds = new Set(rows.map((row) => row.id));
      insertThreadHistoryRows(tx, {
        now,
        retained: frame.retained.filter((output) =>
          eventIds.has(output.eventId),
        ),
        rows,
      });
    });
  }
}

async function openForImport(path: string): Promise<OpenThreadFile> {
  try {
    const file = await openThreadFile(path);
    try {
      for (const entry of file.table.frames) {
        await readThreadFileFrame(file, entry);
        await yieldToEventLoop();
      }
    } catch (error) {
      await file.close();
      throw error;
    }
    return file;
  } catch (error) {
    if (error instanceof ThreadFileError) {
      throw new ApiError(400, "invalid_thread_file", error.message);
    }
    throw error;
  }
}

async function readTablesAndAttachments(file: OpenThreadFile): Promise<{
  attachments: ThreadFileAttachmentContent[];
  tables: ThreadFileTableRow[];
}> {
  const tables: ThreadFileTableRow[] = [];
  const headers: Array<
    Awaited<ReturnType<typeof readThreadFileFrame>>["attachments"][number]
  > = [];
  const parts = new Map<string, Buffer[]>();
  for (const entry of file.table.frames) {
    const frame = await readThreadFileFrame(file, entry);
    tables.push(...frame.tables);
    headers.push(...frame.attachments);
    for (const part of frame.attachmentParts) {
      const list = parts.get(part.storedPath) ?? [];
      list[part.index] = part.data;
      parts.set(part.storedPath, list);
    }
  }
  const attachments = headers.map((header) => {
    const list = parts.get(header.storedPath) ?? [];
    const ordered: Buffer[] = [];
    for (let index = 0; index < header.parts; index += 1) {
      const part = list[index];
      if (part === undefined) {
        throw new ThreadFileError(
          `Thread file is missing parts of ${header.storedPath}`,
        );
      }
      ordered.push(part);
    }
    if (list.length !== header.parts) {
      throw new ThreadFileError(
        `Thread file has extra parts of ${header.storedPath}`,
      );
    }
    const content = Buffer.concat(ordered);
    if (content.length !== header.sizeBytes) {
      throw new ThreadFileError(
        `Thread file has a damaged copy of ${header.storedPath}`,
      );
    }
    return {
      content,
      mimeType: header.mimeType,
      originalName: header.originalName,
      storedPath: header.storedPath,
    };
  });
  return { attachments, tables };
}

function requireImportProject(
  deps: ThreadFileDeps,
  header: ThreadFileHeader,
): void {
  const project = getProject(deps.db, header.projectId);
  if (project === null || project.deletedAt !== null) {
    throw new ApiError(
      404,
      "project_not_found",
      `Thread ${header.threadId} belongs to a project that isn't on this server. Importing a thread from another server isn't supported yet.`,
    );
  }
}

function asImportError(error: unknown): unknown {
  return error instanceof ThreadFileError
    ? new ApiError(400, "invalid_thread_file", error.message)
    : error;
}

async function recreateThreadFromFile(
  deps: ThreadFileDeps,
  file: OpenThreadFile,
): Promise<void> {
  const { threadId, projectId } = file.header;
  requireImportProject(deps, file.header);
  const { attachments, tables } = await readTablesAndAttachments(file);
  const threadRow = tables.find((row) => row.table === "threads");
  if (threadRow === undefined) {
    throw new ApiError(
      400,
      "invalid_thread_file",
      "Thread file has no thread row",
    );
  }
  deps.db.transaction(
    (tx) => {
      const now = Date.now();
      if (!insertHiddenThreadRow(tx, threadRow, now)) {
        throw new ThreadFileError(
          `Thread file has a thread row this version of bb can't insert`,
        );
      }
      requestThreadPurge(tx, { now, threadId });
    },
    { behavior: "immediate" },
  );
  await insertInSlices(
    deps,
    tables.filter((row) => row.table !== "threads"),
    (tx, row) => insertThreadTableRow(tx, row),
  );
  const attachmentPaths = attachments.map(
    (attachment) => attachment.storedPath,
  );
  acquireProjectAttachmentOwnership(
    deps.db,
    threadId,
    attachmentPaths,
    "best-effort",
  );
  for (const attachment of attachments) {
    await restoreProjectAttachment(
      deps.db,
      deps.config.dataDir,
      projectId,
      attachment,
    );
  }
  acquireProjectAttachmentOwnership(deps.db, threadId, attachmentPaths);
  await insertThreadFileEvents(deps, file);
  deps.db.transaction(
    (tx) => {
      unhideImportedThread(tx, threadId);
      cancelThreadPurge(tx, threadId);
      restartThreadArchiveClock(tx, { now: Date.now(), threadId });
    },
    { behavior: "immediate" },
  );
}

async function importDeletedThread(
  deps: ThreadFileDeps,
  file: OpenThreadFile,
): Promise<ThreadFileImportResult> {
  const { threadId } = file.header;
  const thread = getThread(deps.db, threadId);
  if (thread !== null && thread.deletedAt !== null) {
    throw new ApiError(
      409,
      "thread_being_deleted",
      `Thread ${threadId} is still being deleted. Import the file again once the deletion finishes.`,
    );
  }
  if (thread !== null) {
    throw new ApiError(
      409,
      "thread_exists",
      `Thread ${threadId} already exists. Only a deleted thread can be imported.`,
    );
  }
  try {
    await recreateThreadFromFile(deps, file);
  } catch (error) {
    throw asImportError(error);
  }
  deps.hub.notifyThread(threadId, ["thread-created"], {
    projectId: file.header.projectId,
  });
  deps.hub.notifyProject(file.header.projectId, ["threads-changed"]);
  deps.logger.info({ threadId, rows: file.table.rows }, "Thread file imported");
  return { rows: file.table.rows, threadId };
}

export async function importThreadFile(
  deps: ThreadFileDeps,
  path: string,
): Promise<ThreadFileImportResult> {
  const file = await openForImport(path);
  try {
    const release = holdThreadPurge(file.header.threadId, "exclusive");
    try {
      return await importDeletedThread(deps, file);
    } finally {
      release();
    }
  } finally {
    await file.close();
  }
}
