import { createHash } from "node:crypto";
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { z } from "zod";
import {
  THREAD_FILE_FORMAT_VERSION,
  THREAD_FILE_TABLES,
  type ThreadFileTableRow,
  type ThreadHistoryEventRow,
  type ThreadHistoryRetainedOutputRow,
} from "@bb/db";

const zstdCompress = promisify(zlib.zstdCompress);
const zstdDecompress = promisify(zlib.zstdDecompress);

const ZSTD_LEVEL = 9;
const SKIPPABLE_FRAME_MAGIC = 0x184d2a5e;
const SEEK_TRAILER_MAGIC = "BBHSEEK1";
const SEEK_TRAILER_BYTES = 4 + SEEK_TRAILER_MAGIC.length;
const ARCHIVE_EXTENSION = ".jsonl.zst";
const TEMP_SUFFIX = ".tmp";

const THREAD_FILE_FORMAT = "bb.thread";

export const THREAD_FILE_FRAME_RAW_BYTES = 1024 * 1024;

export interface ThreadFileHeader {
  archivedAt: number | null;
  createdAt: number;
  exportedAt: number;
  projectId: string;
  projectName: string | null;
  providerId: string;
  threadId: string;
  title: string | null;
}

export interface ThreadFileFrameEntry {
  compressedBytes: number;
  firstSequence: number;
  lastSequence: number;
  offset: number;
  rawBytes: number;
  rows: number;
  sha256: string;
}

export interface ThreadFileSeekTable {
  formatVersion: number;
  frames: ThreadFileFrameEntry[];
  headerBytes: number;
  lastSequence: number | null;
  rawBytes: number;
  rows: number;
  threadId: string;
}

export interface ThreadFileAttachmentHeader {
  mimeType: string | null;
  originalName: string;
  parts: number;
  sizeBytes: number;
  storedPath: string;
}

export interface ThreadFileAttachmentPart {
  data: Buffer;
  index: number;
  storedPath: string;
}

export interface ThreadFileFrameContents {
  attachmentParts: ThreadFileAttachmentPart[];
  attachments: ThreadFileAttachmentHeader[];
  retained: ThreadHistoryRetainedOutputRow[];
  rows: ThreadHistoryEventRow[];
  tables: ThreadFileTableRow[];
}

const frameEntrySchema = z.object({
  compressedBytes: z.number().int().nonnegative(),
  firstSequence: z.number().int(),
  lastSequence: z.number().int(),
  offset: z.number().int().nonnegative(),
  rawBytes: z.number().int().nonnegative(),
  rows: z.number().int().nonnegative(),
  sha256: z.string().length(64),
});

const seekTableSchema = z.object({
  formatVersion: z.number().int(),
  frames: z.array(frameEntrySchema),
  headerBytes: z.number().int().positive(),
  lastSequence: z.number().int().nullable(),
  rawBytes: z.number().int().nonnegative(),
  rows: z.number().int().nonnegative(),
  threadId: z.string().min(1),
});

const headerLineSchema = z.object({
  kind: z.literal("header"),
  format: z.literal(THREAD_FILE_FORMAT),
  formatVersion: z.number().int(),
  archivedAt: z.number().int().nullable(),
  createdAt: z.number().int(),
  exportedAt: z.number().int(),
  projectId: z.string().min(1),
  projectName: z.string().nullable(),
  providerId: z.string().min(1),
  threadId: z.string().min(1),
  title: z.string().nullable(),
});

export class ThreadFileError extends Error {}

function assertSupportedVersion(formatVersion: number): void {
  if (formatVersion !== THREAD_FILE_FORMAT_VERSION) {
    throw new ThreadFileError(
      `Thread file uses format version ${formatVersion}; this version of bb reads version ${THREAD_FILE_FORMAT_VERSION}`,
    );
  }
}

const eventLineBaseSchema = z.object({
  kind: z.literal("event"),
  createdAt: z.number().int(),
  environmentId: z.string().nullable(),
  id: z.string().min(1),
  itemId: z.string().nullable(),
  itemKind: z.string().nullable(),
  parentToolCallId: z.string().nullable(),
  providerThreadId: z.string().nullable(),
  scopeKind: z.string().min(1),
  sequence: z.number().int(),
  threadId: z.string().min(1),
  turnId: z.string().nullable(),
  type: z.string().min(1),
});

const eventLineSchema = z.union([
  eventLineBaseSchema.extend({ data: z.record(z.string(), z.unknown()) }),
  eventLineBaseSchema.extend({ dataText: z.string() }),
]);

const retainedLineSchema = z.object({
  kind: z.literal("retained"),
  eventId: z.string().min(1),
  expiresAt: z.number().int(),
  outputPath: z.string().min(1),
  value: z.string(),
});

const tableLineSchema = z.object({
  kind: z.literal("row"),
  table: z.enum(THREAD_FILE_TABLES),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
});

const attachmentLineSchema = z.object({
  kind: z.literal("attachment"),
  storedPath: z.string().min(1),
  originalName: z.string(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative(),
  parts: z.number().int().nonnegative(),
});

const attachmentPartLineSchema = z.object({
  kind: z.literal("attachmentPart"),
  storedPath: z.string().min(1),
  index: z.number().int().nonnegative(),
  data: z.string(),
});

export function savedThreadsDir(dataDir: string): string {
  return join(dataDir, "archive", "threads");
}

export function savedThreadFilePath(dataDir: string, threadId: string): string {
  return join(savedThreadsDir(dataDir), `${threadId}${ARCHIVE_EXTENSION}`);
}

function eventColumns(row: ThreadHistoryEventRow) {
  return {
    kind: "event",
    id: row.id,
    threadId: row.threadId,
    environmentId: row.environmentId,
    scopeKind: row.scopeKind,
    turnId: row.turnId,
    providerThreadId: row.providerThreadId,
    sequence: row.sequence,
    type: row.type,
    itemId: row.itemId,
    itemKind: row.itemKind,
    parentToolCallId: row.parentToolCallId,
    createdAt: row.createdAt,
  };
}

function eventLine(row: ThreadHistoryEventRow): string {
  const { data } = row;
  const columns = eventColumns(row);
  let nested: unknown;
  try {
    nested = JSON.parse(data);
  } catch {
    nested = undefined;
  }
  const isObject =
    typeof nested === "object" && nested !== null && !Array.isArray(nested);
  if (isObject && JSON.stringify(nested) === data) {
    return JSON.stringify({ ...columns, data: nested });
  }
  return JSON.stringify({ ...columns, dataText: data });
}

function tableLine(row: ThreadFileTableRow): string {
  return JSON.stringify({ kind: "row", table: row.table, values: row.values });
}

function attachmentLine(attachment: ThreadFileAttachmentHeader): string {
  return JSON.stringify({
    kind: "attachment",
    storedPath: attachment.storedPath,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    parts: attachment.parts,
  });
}

function attachmentPartLine(part: ThreadFileAttachmentPart): string {
  return JSON.stringify({
    kind: "attachmentPart",
    storedPath: part.storedPath,
    index: part.index,
    data: part.data.toString("base64"),
  });
}

function retainedLine(row: ThreadHistoryRetainedOutputRow): string {
  return JSON.stringify({
    kind: "retained",
    eventId: row.eventId,
    outputPath: row.outputPath,
    value: row.value,
    expiresAt: row.expiresAt,
  });
}

export class ThreadFileWriter {
  private frames: ThreadFileFrameEntry[] = [];
  private pendingLines: string[] = [];
  private pendingBytes = 0;
  private pendingRows = 0;
  private pendingFirst: number | null = null;
  private pendingLast: number | null = null;
  private offset = 0;
  private totalRows = 0;
  private totalRawBytes = 0;
  private lastSequence: number | null = null;
  private headerBytes = 0;
  private flushing: Promise<void> = Promise.resolve();

  private constructor(
    private readonly handle: FileHandle,
    private readonly tempPath: string,
    private readonly finalPath: string,
    private readonly threadId: string,
  ) {}

  static async create(args: {
    header: ThreadFileHeader;
    path: string;
  }): Promise<ThreadFileWriter> {
    await mkdir(dirname(args.path), { recursive: true });
    const tempPath = `${args.path}${TEMP_SUFFIX}`;
    const handle = await open(tempPath, "w");
    const writer = new ThreadFileWriter(
      handle,
      tempPath,
      args.path,
      args.header.threadId,
    );
    const headerFrame = await zstdCompress(
      Buffer.from(
        `${JSON.stringify({
          kind: "header",
          format: THREAD_FILE_FORMAT,
          formatVersion: THREAD_FILE_FORMAT_VERSION,
          ...args.header,
        })}\n`,
      ),
      { params: { [zlib.constants.ZSTD_c_compressionLevel]: ZSTD_LEVEL } },
    );
    await writer.write(headerFrame);
    writer.headerBytes = headerFrame.length;
    return writer;
  }

  get pendingRawBytes(): number {
    return this.pendingBytes;
  }

  get rowCount(): number {
    return this.totalRows + this.pendingRows;
  }

  addTableRows(rows: readonly ThreadFileTableRow[]): void {
    for (const row of rows) this.addLine(tableLine(row));
  }

  addAttachment(attachment: ThreadFileAttachmentHeader): void {
    this.addLine(attachmentLine(attachment));
  }

  addAttachmentPart(part: ThreadFileAttachmentPart): void {
    this.addLine(attachmentPartLine(part));
  }

  private addLine(line: string): void {
    this.pendingLines.push(line);
    this.pendingBytes += Buffer.byteLength(line) + 1;
  }

  addWindow(
    rows: readonly ThreadHistoryEventRow[],
    retained: readonly ThreadHistoryRetainedOutputRow[],
  ): void {
    for (const row of rows) {
      const line = eventLine(row);
      this.pendingLines.push(line);
      this.pendingBytes += Buffer.byteLength(line) + 1;
      this.pendingRows += 1;
      this.pendingFirst ??= row.sequence;
      this.pendingLast = row.sequence;
      this.lastSequence = row.sequence;
    }
    for (const output of retained) {
      const line = retainedLine(output);
      this.pendingLines.push(line);
      this.pendingBytes += Buffer.byteLength(line) + 1;
    }
  }

  async flushFrame(): Promise<void> {
    await this.flushing;
    this.startFlush();
    await this.flushing;
  }

  async flushFrameInBackground(): Promise<void> {
    await this.flushing;
    this.startFlush();
  }

  private startFlush(): void {
    if (this.pendingLines.length === 0) return;
    const raw = Buffer.from(`${this.pendingLines.join("\n")}\n`);
    const firstSequence = this.pendingFirst ?? 0;
    const lastSequence = this.pendingLast ?? firstSequence;
    const rows = this.pendingRows;
    this.pendingLines = [];
    this.pendingBytes = 0;
    this.pendingRows = 0;
    this.pendingFirst = null;
    this.pendingLast = null;
    const flushing = this.writeFrame({
      firstSequence,
      lastSequence,
      raw,
      rows,
    });
    flushing.catch(() => undefined);
    this.flushing = flushing;
  }

  private async writeFrame(args: {
    firstSequence: number;
    lastSequence: number;
    raw: Buffer;
    rows: number;
  }): Promise<void> {
    const frame = await zstdCompress(args.raw, {
      params: { [zlib.constants.ZSTD_c_compressionLevel]: ZSTD_LEVEL },
    });
    const offset = this.offset;
    await this.write(frame);
    this.frames.push({
      compressedBytes: frame.length,
      firstSequence: args.firstSequence,
      lastSequence: args.lastSequence,
      offset,
      rawBytes: args.raw.length,
      rows: args.rows,
      sha256: createHash("sha256").update(frame).digest("hex"),
    });
    this.totalRows += args.rows;
    this.totalRawBytes += args.raw.length;
  }

  async seal(): Promise<{
    packedBytes: number;
    rawBytes: number;
    rows: number;
  }> {
    await this.flushFrame();
    const table: ThreadFileSeekTable = {
      formatVersion: THREAD_FILE_FORMAT_VERSION,
      frames: this.frames,
      headerBytes: this.headerBytes,
      lastSequence: this.lastSequence,
      rawBytes: this.totalRawBytes,
      rows: this.totalRows,
      threadId: this.threadId,
    };
    const tableBytes = Buffer.from(JSON.stringify(table));
    const trailer = Buffer.alloc(SEEK_TRAILER_BYTES);
    trailer.writeUInt32LE(tableBytes.length, 0);
    trailer.write(SEEK_TRAILER_MAGIC, 4, "ascii");
    const payload = Buffer.concat([tableBytes, trailer]);
    const frameHeader = Buffer.alloc(8);
    frameHeader.writeUInt32LE(SKIPPABLE_FRAME_MAGIC, 0);
    frameHeader.writeUInt32LE(payload.length, 4);
    await this.write(Buffer.concat([frameHeader, payload]));
    await this.handle.sync();
    await this.handle.close();
    await rename(this.tempPath, this.finalPath);
    return {
      packedBytes: this.offset,
      rawBytes: this.totalRawBytes,
      rows: this.totalRows,
    };
  }

  async abort(): Promise<void> {
    await this.flushing.catch(() => undefined);
    await this.handle.close().catch(() => undefined);
    await rm(this.tempPath, { force: true });
  }

  private async write(buffer: Buffer): Promise<void> {
    await this.handle.write(buffer, 0, buffer.length, this.offset);
    this.offset += buffer.length;
  }
}

function parseThreadFileJson<T>(
  what: string,
  text: string,
  schema: z.ZodType<T>,
): T {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ThreadFileError(`Thread file has an unreadable ${what}`);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ThreadFileError(`Thread file has an invalid ${what}`);
  }
  return parsed.data;
}

async function readSeekTable(handle: FileHandle): Promise<ThreadFileSeekTable> {
  const { size } = await handle.stat();
  if (size < SEEK_TRAILER_BYTES) {
    throw new ThreadFileError(`Thread file is truncated`);
  }
  const trailer = Buffer.alloc(SEEK_TRAILER_BYTES);
  await handle.read(trailer, 0, SEEK_TRAILER_BYTES, size - SEEK_TRAILER_BYTES);
  if (trailer.toString("ascii", 4) !== SEEK_TRAILER_MAGIC) {
    throw new ThreadFileError(
      `Thread file is not a bb thread file or is incomplete`,
    );
  }
  const tableLength = trailer.readUInt32LE(0);
  if (tableLength > size - SEEK_TRAILER_BYTES) {
    throw new ThreadFileError(`Thread file is truncated`);
  }
  const tableBytes = Buffer.alloc(tableLength);
  await handle.read(
    tableBytes,
    0,
    tableLength,
    size - SEEK_TRAILER_BYTES - tableLength,
  );
  const formatVersion = parseThreadFileJson(
    "seek table",
    tableBytes.toString("utf8"),
    z.object({ formatVersion: z.number().int() }),
  ).formatVersion;
  assertSupportedVersion(formatVersion);
  return parseThreadFileJson(
    "seek table",
    tableBytes.toString("utf8"),
    seekTableSchema,
  );
}

async function readHeader(
  handle: FileHandle,
  table: ThreadFileSeekTable,
): Promise<ThreadFileHeader> {
  const compressed = Buffer.alloc(table.headerBytes);
  await handle.read(compressed, 0, table.headerBytes, 0);
  let raw: Buffer;
  try {
    raw = await zstdDecompress(compressed);
  } catch {
    throw new ThreadFileError(`Thread file has an unreadable header`);
  }
  const line = raw.toString("utf8").split("\n", 1)[0] ?? "";
  const {
    kind: _kind,
    format: _format,
    formatVersion,
    ...header
  } = parseThreadFileJson("header", line, headerLineSchema);
  assertSupportedVersion(formatVersion);
  if (header.threadId !== table.threadId) {
    throw new ThreadFileError(
      `Thread file names two different threads in its header and seek table`,
    );
  }
  return header;
}

export interface OpenThreadFile {
  close(): Promise<void>;
  handle: FileHandle;
  header: ThreadFileHeader;
  path: string;
  table: ThreadFileSeekTable;
}

export async function openThreadFile(path: string): Promise<OpenThreadFile> {
  const handle = await open(path, "r");
  try {
    const table = await readSeekTable(handle);
    const header = await readHeader(handle, table);
    return { close: () => handle.close(), handle, header, path, table };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

const PARSE_LINES_PER_YIELD = 256;

function lineKind(value: unknown): unknown {
  return typeof value === "object" && value !== null && "kind" in value
    ? value.kind
    : undefined;
}

async function parseFrameLines(raw: Buffer): Promise<ThreadFileFrameContents> {
  const rows: ThreadHistoryEventRow[] = [];
  const retained: ThreadHistoryRetainedOutputRow[] = [];
  const tables: ThreadFileTableRow[] = [];
  const attachments: ThreadFileAttachmentHeader[] = [];
  const attachmentParts: ThreadFileAttachmentPart[] = [];
  const lines = raw.toString("utf8").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (index > 0 && index % PARSE_LINES_PER_YIELD === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const line = lines[index];
    if (line === undefined || line.length === 0) continue;
    const value: unknown = JSON.parse(line);
    switch (lineKind(value)) {
      case "event": {
        const { kind: _kind, ...columns } = eventLineSchema.parse(value);
        if ("dataText" in columns) {
          const { dataText, ...rest } = columns;
          rows.push({ ...rest, data: dataText });
        } else {
          const { data, ...rest } = columns;
          rows.push({ ...rest, data: JSON.stringify(data) });
        }
        break;
      }
      case "retained": {
        const { kind: _kind, ...output } = retainedLineSchema.parse(value);
        retained.push(output);
        break;
      }
      case "row": {
        const row = tableLineSchema.parse(value);
        tables.push({ table: row.table, values: row.values });
        break;
      }
      case "attachment": {
        const { kind: _kind, ...header } = attachmentLineSchema.parse(value);
        attachments.push(header);
        break;
      }
      case "attachmentPart": {
        const {
          data,
          index: partIndex,
          storedPath,
        } = attachmentPartLineSchema.parse(value);
        attachmentParts.push({
          data: Buffer.from(data, "base64"),
          index: partIndex,
          storedPath,
        });
        break;
      }
      default:
        throw new Error("unknown line kind");
    }
  }
  return { attachmentParts, attachments, retained, rows, tables };
}

async function readCheckedFrame(
  handle: FileHandle,
  entry: ThreadFileFrameEntry,
): Promise<Buffer> {
  const compressed = Buffer.alloc(entry.compressedBytes);
  await handle.read(compressed, 0, entry.compressedBytes, entry.offset);
  if (createHash("sha256").update(compressed).digest("hex") !== entry.sha256) {
    throw new ThreadFileError(
      `Thread file frame at ${entry.offset} failed its checksum`,
    );
  }
  const raw = await zstdDecompress(compressed);
  if (raw.length !== entry.rawBytes) {
    throw new ThreadFileError(
      `Thread file frame at ${entry.offset} decoded to ${raw.length} bytes, expected ${entry.rawBytes}`,
    );
  }
  return raw;
}

export async function readThreadFileFrame(
  file: OpenThreadFile,
  entry: ThreadFileFrameEntry,
): Promise<ThreadFileFrameContents> {
  const raw = await readCheckedFrame(file.handle, entry);
  let contents: ThreadFileFrameContents;
  try {
    contents = await parseFrameLines(raw);
  } catch {
    throw new ThreadFileError(
      `Thread file has an invalid line in the frame at ${entry.offset}`,
    );
  }
  const threadId = file.table.threadId;
  if (
    contents.rows.some((row) => row.threadId !== threadId) ||
    contents.tables.some(
      (row) =>
        (row.table === "threads" ? row.values.id : row.values.thread_id) !==
        threadId,
    )
  ) {
    throw new ThreadFileError(`Thread file has events from another thread`);
  }
  if (contents.rows.length !== entry.rows) {
    throw new ThreadFileError(
      `Thread file frame at ${entry.offset} has ${contents.rows.length} events, expected ${entry.rows}`,
    );
  }
  return contents;
}

const EVENT_LINE_MARKER = Buffer.from('{"kind":"event"');

function countEventLines(raw: Buffer): number {
  let count = 0;
  let index = raw.indexOf(EVENT_LINE_MARKER);
  while (index !== -1) {
    if (index === 0 || raw[index - 1] === 0x0a) count += 1;
    index = raw.indexOf(EVENT_LINE_MARKER, index + EVENT_LINE_MARKER.length);
  }
  return count;
}

export async function verifyThreadFileFrame(
  file: OpenThreadFile,
  entry: ThreadFileFrameEntry,
): Promise<number> {
  return countEventLines(await readCheckedFrame(file.handle, entry));
}

export async function removeSavedThreadFile(
  dataDir: string,
  threadId: string,
): Promise<void> {
  const path = savedThreadFilePath(dataDir, threadId);
  await rm(path, { force: true });
  await rm(`${path}${TEMP_SUFFIX}`, { force: true });
}

export async function listSavedThreadFiles(
  dataDir: string,
): Promise<Array<{ path: string; temporary: boolean; threadId: string }>> {
  let names: string[];
  try {
    names = await readdir(savedThreadsDir(dataDir));
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
  return names.flatMap((name) => {
    const temporary = name.endsWith(`${ARCHIVE_EXTENSION}${TEMP_SUFFIX}`);
    if (!temporary && !name.endsWith(ARCHIVE_EXTENSION)) return [];
    const threadId = name.slice(
      0,
      name.length -
        ARCHIVE_EXTENSION.length -
        (temporary ? TEMP_SUFFIX.length : 0),
    );
    return [
      {
        path: join(savedThreadsDir(dataDir), name),
        temporary,
        threadId,
      },
    ];
  });
}

export async function savedThreadFileExists(
  dataDir: string,
  threadId: string,
): Promise<boolean> {
  try {
    await stat(savedThreadFilePath(dataDir, threadId));
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
