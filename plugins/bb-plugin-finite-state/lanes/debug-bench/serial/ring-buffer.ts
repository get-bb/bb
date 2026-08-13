import { Buffer } from "node:buffer";

export const DEFAULT_SERIAL_MAX_LINES = 10_000;
export const DEFAULT_SERIAL_MAX_BYTES = 2 * 1024 * 1024;

export type SerialDirection = "rx" | "tx";

export interface SerialLine {
  cursor: number;
  at: string;
  dir: SerialDirection;
  text: string;
}

export interface SerialGap {
  afterCursor: number;
  dropped: number;
}

export interface SerialRingRead {
  lines: SerialLine[];
  nextCursor: number;
  gaps: SerialGap[];
}

export interface SerialRingBufferOptions {
  maxLines?: number;
  maxBytes?: number;
}

interface BufferedLine {
  line: SerialLine;
  bytes: number;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
  return value;
}

export class SerialRingBuffer {
  private readonly maxLines: number;
  private readonly maxBytes: number;
  private readonly entries: BufferedLine[] = [];
  private cursor = 0;
  private bytes = 0;
  private dropped = 0;
  private droppedThroughCursor = 0;

  constructor(options: SerialRingBufferOptions = {}) {
    this.maxLines = positiveInteger(
      options.maxLines ?? DEFAULT_SERIAL_MAX_LINES,
      "maxLines",
    );
    this.maxBytes = positiveInteger(
      options.maxBytes ?? DEFAULT_SERIAL_MAX_BYTES,
      "maxBytes",
    );
  }

  get latestCursor(): number {
    return this.cursor;
  }

  get droppedLines(): number {
    return this.dropped;
  }

  get lineCount(): number {
    return this.entries.length;
  }

  get sizeBytes(): number {
    return this.bytes;
  }

  append(input: Omit<SerialLine, "cursor">): SerialLine {
    const line: SerialLine = { ...input, cursor: ++this.cursor };
    const entry = { line, bytes: Buffer.byteLength(input.text, "utf8") };
    this.entries.push(entry);
    this.bytes += entry.bytes;

    while (this.entries.length > this.maxLines || this.bytes > this.maxBytes) {
      const removed = this.entries.shift();
      if (!removed) break;
      this.bytes -= removed.bytes;
      this.dropped += 1;
      this.droppedThroughCursor = removed.line.cursor;
    }
    return line;
  }

  read(input: {
    cursor?: number;
    maxLines: number;
    include?: (line: SerialLine) => boolean;
  }): SerialRingRead {
    const requestedCursor = input.cursor ?? 0;
    if (!Number.isSafeInteger(requestedCursor) || requestedCursor < 0) {
      throw new RangeError("Serial cursor must be a non-negative safe integer.");
    }
    const maxLines = positiveInteger(input.maxLines, "maxLines");
    const gaps = requestedCursor < this.droppedThroughCursor
      ? [{
          afterCursor: requestedCursor,
          dropped: this.droppedThroughCursor - requestedCursor,
        }]
      : [];
    const effectiveCursor = Math.max(requestedCursor, this.droppedThroughCursor);
    const lines: SerialLine[] = [];
    let nextCursor = effectiveCursor;
    for (const entry of this.entries) {
      if (entry.line.cursor <= effectiveCursor) continue;
      nextCursor = entry.line.cursor;
      if ((input.include?.(entry.line) ?? true) === false) continue;
      lines.push(entry.line);
      if (lines.length >= maxLines) break;
    }
    return {
      lines,
      nextCursor: Math.min(Math.max(nextCursor, effectiveCursor), this.cursor),
      gaps,
    };
  }
}

export function createSerialRingBuffer(
  options: SerialRingBufferOptions = {},
): SerialRingBuffer {
  return new SerialRingBuffer(options);
}
