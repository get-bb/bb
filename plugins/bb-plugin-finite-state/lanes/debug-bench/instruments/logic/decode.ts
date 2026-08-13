import { Buffer } from "node:buffer";
import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { CaptureArtifact } from "../driver.js";

export type DecodedProtocol = "spi" | "i2c" | "uart" | "can";

export interface DecodedFrame {
  protocol: DecodedProtocol;
  index: number;
  startTimeSeconds: number;
  endTimeSeconds: number | null;
  type: string;
  data: string;
  fields: Readonly<Record<string, string | number | boolean | null>>;
}

export interface DecodeOptions {
  pageSize?: number;
  cursor?: string | null;
}

export interface Paged<T> {
  items: T[];
  cursor: string | null;
  total: number;
}

export type DecodeErrorCode =
  | "DECODE_CURSOR_INVALID"
  | "DECODE_EXPORT_MALFORMED"
  | "DECODE_PROTOCOL_UNAVAILABLE";

export class DecodeError extends Error {
  constructor(readonly code: DecodeErrorCode, message: string, options?: ErrorOptions) {
    super(message.startsWith(`${code}:`) ? message : `${code}: ${message}`, options);
    this.name = "DecodeError";
  }
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

interface CursorValue { protocol: DecodedProtocol; offset: number }

function isProtocol(value: unknown): value is DecodedProtocol {
  return value === "spi" || value === "i2c" || value === "uart" || value === "can";
}

function cursor(value: CursorValue): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function parseCursor(value: string | null | undefined, protocol: DecodedProtocol): number {
  if (!value) return 0;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof parsed === "object" && parsed !== null &&
        Reflect.get(parsed, "protocol") === protocol) {
      const offset: unknown = Reflect.get(parsed, "offset");
      if (Number.isInteger(offset) && Number(offset) >= 0) return Number(offset);
    }
  } catch {
    // Normalized to the public error below.
  }
  throw new DecodeError("DECODE_CURSOR_INVALID", "Decode cursor is malformed or belongs to another protocol.");
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DecodeError("DECODE_EXPORT_MALFORMED", `${label} must be an object.`);
  }
  return Object.fromEntries(Object.entries(value));
}

function numberField(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new DecodeError("DECODE_EXPORT_MALFORMED", `${label} must be a non-negative number.`);
  }
  return value;
}

function normalizeFields(value: unknown): Record<string, string | number | boolean | null> {
  const input = object(value, "Decoded frame fields");
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(input)) {
    if (typeof item === "string" || typeof item === "number" ||
        typeof item === "boolean" || item === null) output[key] = item;
    else throw new DecodeError("DECODE_EXPORT_MALFORMED", `Decoded field ${key} has an unsupported value.`);
  }
  return output;
}

function normalizeFrame(
  value: unknown,
  protocol: DecodedProtocol,
  index: number,
): DecodedFrame {
  const frame = object(value, `Decoded ${protocol} frame`);
  const frameProtocol = frame.protocol;
  if (frameProtocol !== undefined && frameProtocol !== protocol) {
    throw new DecodeError("DECODE_EXPORT_MALFORMED", "Decoded frame protocol does not match its collection.");
  }
  const startTimeSeconds = numberField(frame.startTimeSeconds, "Frame start time");
  const endTimeSeconds = frame.endTimeSeconds === null || frame.endTimeSeconds === undefined
    ? null
    : numberField(frame.endTimeSeconds, "Frame end time");
  if (endTimeSeconds !== null && endTimeSeconds < startTimeSeconds) {
    throw new DecodeError("DECODE_EXPORT_MALFORMED", "Frame end time precedes its start time.");
  }
  if (typeof frame.type !== "string" || typeof frame.data !== "string") {
    throw new DecodeError("DECODE_EXPORT_MALFORMED", "Decoded frame type and data must be strings.");
  }
  return {
    protocol,
    index,
    startTimeSeconds,
    endTimeSeconds,
    type: frame.type,
    data: frame.data,
    fields: normalizeFields(frame.fields ?? {}),
  };
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      fields.push(current);
      current = "";
    } else current += character;
  }
  if (quoted) throw new DecodeError("DECODE_EXPORT_MALFORMED", "Vendor CSV contains an unterminated quote.");
  fields.push(current);
  return fields;
}

function normalizedHeader(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/gu, "");
}

function csvFrames(csv: string, protocol: DecodedProtocol): DecodedFrame[] {
  const lines = csv.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]!).map(normalizedHeader);
  const startIndex = headers.findIndex((header) =>
    header === "start" || header === "starttime" || header === "time" || header === "times");
  const endIndex = headers.findIndex((header) => header === "end" || header === "endtime");
  const durationIndex = headers.findIndex((header) => header === "duration" || header === "durations");
  const typeIndex = headers.findIndex((header) => header === "type" || header === "name");
  const dataIndex = headers.findIndex((header) =>
    header === "data" || header === "result" || header === "value" || header === "description");
  if (startIndex < 0 || dataIndex < 0) {
    throw new DecodeError("DECODE_EXPORT_MALFORMED", "Vendor decoder CSV lacks time or data columns.");
  }
  return lines.slice(1).map((line, index) => {
    const values = parseCsvLine(line);
    const start = Number(values[startIndex]);
    const end = endIndex >= 0
      ? Number(values[endIndex])
      : durationIndex >= 0
        ? start + Number(values[durationIndex])
        : null;
    const fields: Record<string, string> = {};
    for (let fieldIndex = 0; fieldIndex < headers.length; fieldIndex += 1) {
      if (fieldIndex !== startIndex && fieldIndex !== endIndex &&
          fieldIndex !== durationIndex && fieldIndex !== typeIndex && fieldIndex !== dataIndex) {
        fields[headers[fieldIndex] ?? `field${fieldIndex}`] = values[fieldIndex] ?? "";
      }
    }
    return normalizeFrame({
      startTimeSeconds: start,
      endTimeSeconds: end,
      type: typeIndex >= 0 ? values[typeIndex] ?? protocol : protocol,
      data: values[dataIndex] ?? "",
      fields,
    }, protocol, index);
  });
}

async function confinedExportPath(manifestPath: string, value: unknown): Promise<string> {
  if (typeof value !== "string") {
    throw new DecodeError("DECODE_EXPORT_MALFORMED", "Vendor decoder export path must be a string.");
  }
  const root = await realpath(dirname(manifestPath));
  const unresolved = isAbsolute(value) ? resolve(value) : resolve(root, value);
  const candidate = await realpath(unresolved).catch((error) => {
    throw new DecodeError(
      "DECODE_EXPORT_MALFORMED",
      "Vendor decoder export is missing or unreadable.",
      { cause: error },
    );
  });
  const rel = relative(root, candidate);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new DecodeError("DECODE_EXPORT_MALFORMED", "Vendor decoder export escaped its capture directory.");
  }
  return candidate;
}

async function readFrames(
  artifact: CaptureArtifact,
  protocol: DecodedProtocol,
): Promise<DecodedFrame[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(artifact.path, "utf8"));
  } catch (error) {
    throw new DecodeError(
      "DECODE_EXPORT_MALFORMED",
      "Capture manifest is not valid JSON.",
      { cause: error },
    );
  }
  const manifest = object(parsed, "Capture manifest");
  if (manifest.schema !== "finite-state-logic-v1") {
    throw new DecodeError("DECODE_EXPORT_MALFORMED", "Capture manifest schema is unsupported.");
  }
  const frameCollections = object(manifest.frames ?? {}, "Capture frame collections");
  const embedded = frameCollections[protocol];
  if (embedded !== undefined) {
    if (!Array.isArray(embedded)) {
      throw new DecodeError("DECODE_EXPORT_MALFORMED", `Embedded ${protocol} frames must be an array.`);
    }
    return embedded.map((frame, index) => normalizeFrame(frame, protocol, index));
  }
  const exports = object(manifest.decoderExports ?? {}, "Vendor decoder exports");
  if (exports[protocol] !== undefined) {
    const path = await confinedExportPath(artifact.path, exports[protocol]);
    return csvFrames(await readFile(path, "utf8"), protocol);
  }
  throw new DecodeError(
    "DECODE_PROTOCOL_UNAVAILABLE",
    `${protocol.toUpperCase()} was not decoded by the vendor and no local replay frames are available.`,
  );
}

/**
 * Standard artifact format: a small finite-state-logic-v1 JSON manifest points
 * at the vendor-native raw capture (`.sal` + CSV for Saleae, DWF sample export
 * for Digilent) and vendor analyzer CSVs. Replay fixtures embed normalized
 * frames in the same manifest. Only one bounded page crosses this API.
 */
export async function decodeCapture(
  artifact: CaptureArtifact,
  protocol: DecodedProtocol,
  options: DecodeOptions = {},
): Promise<Paged<DecodedFrame>> {
  if (!isProtocol(protocol)) {
    throw new DecodeError("DECODE_EXPORT_MALFORMED", "Unsupported decoded protocol.");
  }
  const pageSize = Math.max(1, Math.min(
    MAX_PAGE_SIZE,
    Math.trunc(options.pageSize ?? DEFAULT_PAGE_SIZE),
  ));
  const offset = parseCursor(options.cursor, protocol);
  const frames = await readFrames(artifact, protocol);
  if (offset > frames.length) {
    throw new DecodeError("DECODE_CURSOR_INVALID", "Decode cursor is beyond the frame collection.");
  }
  const items = frames.slice(offset, offset + pageSize);
  const nextOffset = offset + items.length;
  return {
    items,
    total: frames.length,
    cursor: nextOffset < frames.length ? cursor({ protocol, offset: nextOffset }) : null,
  };
}

export const decodeLogicCapture = decodeCapture;
