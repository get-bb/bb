import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { mkdir, open, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { FileHandle } from "node:fs/promises";
import type { SerialDirection } from "./ring-buffer.js";

export const DEFAULT_TRANSCRIPT_MAX_BYTES = 50 * 1024 * 1024;
export const DEFAULT_TRANSCRIPT_SESSION_RETENTION = 10;

export interface TranscriptLine {
  at: string;
  dir: SerialDirection;
  text: string;
}

export interface SerialTranscriptOptions {
  artifactRoot: string;
  deviceId: string;
  sessionId: string;
  openedAt: string;
  maxBytes?: number;
  maxSessions?: number;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
  return value;
}

function deviceDirectoryName(deviceId: string): string {
  const readable = deviceId.replace(/[^a-zA-Z0-9._-]+/gu, "-").slice(0, 40) || "serial";
  const digest = createHash("sha256").update(deviceId).digest("hex").slice(0, 16);
  return `${readable}-${digest}`;
}

function sessionDirectoryName(openedAt: string, sessionId: string): string {
  const timestamp = openedAt.replace(/[^0-9]/gu, "").slice(0, 17).padEnd(17, "0");
  const safeSession = sessionId.replace(/[^a-zA-Z0-9._-]+/gu, "-").slice(0, 80);
  return `${timestamp}-${safeSession}`;
}

async function enforceRetention(deviceRoot: string, keep: number): Promise<void> {
  const entries = (await readdir(deviceRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of entries.slice(0, Math.max(0, entries.length - keep))) {
    await rm(join(deviceRoot, name), { recursive: true, force: true });
  }
}

export class SerialTranscript {
  readonly directory: string;
  private readonly maxBytes: number;
  private handle: FileHandle | null = null;
  private segment = 0;
  private segmentBytes = 0;
  private totalBytes = 0;
  private readonly segments: Array<{ path: string; bytes: number }> = [];
  private closed = false;

  private constructor(directory: string, maxBytes: number) {
    this.directory = directory;
    this.maxBytes = maxBytes;
  }

  static async open(options: SerialTranscriptOptions): Promise<SerialTranscript> {
    const maxBytes = positiveInteger(
      options.maxBytes ?? DEFAULT_TRANSCRIPT_MAX_BYTES,
      "maxBytes",
    );
    const maxSessions = positiveInteger(
      options.maxSessions ?? DEFAULT_TRANSCRIPT_SESSION_RETENTION,
      "maxSessions",
    );
    const deviceRoot = join(
      options.artifactRoot,
      "transcripts",
      deviceDirectoryName(options.deviceId),
    );
    await mkdir(deviceRoot, { recursive: true, mode: 0o700 });
    const directory = join(
      deviceRoot,
      sessionDirectoryName(options.openedAt, options.sessionId),
    );
    await mkdir(directory, { recursive: false, mode: 0o700 });
    await enforceRetention(deviceRoot, maxSessions);
    return new SerialTranscript(directory, maxBytes);
  }

  private async openSegment(): Promise<FileHandle> {
    if (this.handle) return this.handle;
    const path = join(this.directory, `${String(this.segment).padStart(4, "0")}.ndjson`);
    this.handle = await open(path, "a", 0o600);
    this.segments.push({ path, bytes: 0 });
    return this.handle;
  }

  private async rotate(): Promise<void> {
    await this.handle?.close();
    this.handle = null;
    this.segment += 1;
    this.segmentBytes = 0;
  }

  private async evictFor(frameBytes: number): Promise<void> {
    while (this.totalBytes + frameBytes > this.maxBytes) {
      const currentPath = this.handle ? this.segments.at(-1)?.path : undefined;
      const oldest = this.segments.find((entry) => entry.path !== currentPath);
      if (!oldest) return;
      await rm(oldest.path, { force: true });
      this.totalBytes -= oldest.bytes;
      this.segments.splice(this.segments.indexOf(oldest), 1);
    }
  }

  async append(line: TranscriptLine): Promise<void> {
    if (this.closed) throw new Error("SERIAL_TRANSCRIPT_CLOSED");
    const frame = `${JSON.stringify(line)}\n`;
    const frameBytes = Buffer.byteLength(frame, "utf8");
    if (frameBytes > this.maxBytes) {
      throw new RangeError("Transcript line exceeds the configured per-session byte cap.");
    }
    const segmentTarget = Math.max(1, Math.floor(this.maxBytes / 2));
    if (
      this.segmentBytes > 0 &&
      (this.segmentBytes + frameBytes > segmentTarget || this.totalBytes + frameBytes > this.maxBytes)
    ) {
      await this.rotate();
    }
    await this.evictFor(frameBytes);
    const handle = await this.openSegment();
    await handle.write(frame, undefined, "utf8");
    this.segmentBytes += frameBytes;
    this.totalBytes += frameBytes;
    const current = this.segments.at(-1);
    if (current) current.bytes += frameBytes;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.handle?.close();
    this.handle = null;
  }
}

export function openSerialTranscript(
  options: SerialTranscriptOptions,
): Promise<SerialTranscript> {
  return SerialTranscript.open(options);
}
