import { mkdir, open, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { PluginHttpHandler } from "@bb/plugin-sdk";
import type Database from "better-sqlite3";
import { toStorageProjectVersionId } from "../../../lib/store/index.js";
import { getBuildRun } from "./runs-store.js";

export interface LogTailDependencies {
  db: Database.Database;
}

interface ByteRange {
  start: number;
  end: number;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/u;
const DEFAULT_TAIL_BYTES = 64 * 1024;
const MAX_RANGE_BYTES = 256 * 1024;

export function authoringDataDir(db: Database.Database): string {
  if (!isAbsolute(db.name)) {
    throw new Error("Authoring requires an on-disk plugin database");
  }
  return dirname(db.name);
}

export async function buildLogRoot(db: Database.Database): Promise<string> {
  const root = resolve(authoringDataDir(db), "build-logs");
  await mkdir(root, { recursive: true });
  return await realpath(root);
}

export async function buildLogPath(
  db: Database.Database,
  runId: string,
): Promise<string> {
  if (!ID.test(runId)) throw new Error("Invalid build log run id");
  return resolve(await buildLogRoot(db), `${runId}.log`);
}

function errorResponse(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function parseRange(value: string | undefined, size: number): ByteRange | null {
  if (size === 0) return { start: 0, end: -1 };
  if (value === undefined) {
    return { start: Math.max(0, size - DEFAULT_TAIL_BYTES), end: size - 1 };
  }
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value);
  if (!match || (match[1] === "" && match[2] === "")) return null;
  let start: number;
  let end: number;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) return null;
    start = Math.max(0, size - Math.min(suffix, MAX_RANGE_BYTES));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? Math.min(size - 1, start + MAX_RANGE_BYTES - 1) : Number(match[2]);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      start >= size
    ) {
      return null;
    }
    end = Math.min(end, size - 1, start + MAX_RANGE_BYTES - 1);
  }
  return { start, end };
}

async function safeLogFile(db: Database.Database, storedPath: string): Promise<string | null> {
  if (!isAbsolute(storedPath)) return null;
  try {
    const logRoot = await buildLogRoot(db);
    const path = await realpath(storedPath);
    const inside = relative(logRoot, path);
    if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
      return null;
    }
    return path;
  } catch {
    return null;
  }
}

export function createBuildLogTailHandler(deps: LogTailDependencies): PluginHttpHandler {
  return async (http) => {
    const projectId = http.req.query("projectId");
    const projectVersionId = http.req.query("projectVersionId") ?? null;
    const runId = http.req.query("runId");
    if (
      projectId === undefined ||
      runId === undefined ||
      !ID.test(projectId) ||
      !ID.test(runId) ||
      (projectVersionId !== null && !ID.test(projectVersionId))
    ) {
      return errorResponse(
        "INVALID_LOG_SCOPE",
        "Valid projectId, optional projectVersionId, and runId query parameters are required.",
        400,
      );
    }
    const run = getBuildRun(
      deps.db,
      { projectId, projectVersionId: toStorageProjectVersionId(projectVersionId) },
      runId,
    );
    if (run === null) {
      return errorResponse("RUN_NOT_FOUND", "The scoped build run does not exist.", 404);
    }
    const logPath = await safeLogFile(deps.db, run.logPath);
    if (logPath === null) {
      return errorResponse(
        "LOG_NOT_AVAILABLE",
        "The run log is missing or no longer resolves inside plugin storage.",
        404,
      );
    }
    const size = (await stat(logPath)).size;
    const range = parseRange(http.req.header("Range"), size);
    if (range === null) {
      return new Response(null, {
        status: 416,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes */${size}`,
        },
      });
    }
    if (range.end < range.start) {
      return new Response(new Uint8Array(), {
        status: 200,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": "0",
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }
    const length = range.end - range.start + 1;
    const bytes = Buffer.alloc(length);
    const handle = await open(logPath, "r");
    try {
      const read = await handle.read(bytes, 0, length, range.start);
      const body = bytes.subarray(0, read.bytesRead);
      return new Response(body, {
        status: 206,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": String(body.byteLength),
          "Content-Range": `bytes ${range.start}-${range.start + body.byteLength - 1}/${size}`,
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    } finally {
      await handle.close();
    }
  };
}
