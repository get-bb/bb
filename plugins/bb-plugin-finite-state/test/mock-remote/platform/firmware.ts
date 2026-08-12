import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Json } from "../../../lib/remote/types.js";
import type { MockHandlerContext, MockHandlerRegistry } from "../types.js";

export const MOCK_PLATFORM_ADMIN_PERMISSION = "VIEW_ANY_PROJECT_FILE";
export const MOCK_FIRMWARE_RANGE_MAX_BYTES = 131_072;

interface FirmwareEntry {
  byteSample: string | null;
  errors: string[];
  hash: string | null;
  kind: "file" | "directory" | "symlink";
  linkTarget: string | null;
  path: string;
  scanId: string;
  size: number | null;
}

interface FirmwareFixture {
  artifactHash: string;
  entries: FirmwareEntry[];
  path: string;
  projectVersionId: string;
  scanId: string;
  total: number;
}

export interface MockPlatformFirmwareState {
  readonly projectVersionId: string;
  readonly scanId: string;
  readonly artifactHash: string;
  tree(input: { path: string; depth: number; hash?: string }): Record<string, Json>;
  metadata(hash: string): Record<string, Json>;
  bytes(hash: string): Uint8Array;
  reset(): void;
}

function readFixture(fixtureRoot: string): FirmwareFixture {
  return JSON.parse(readFileSync(resolve(fixtureRoot, "firmware/filesystem-response.json"), "utf8")) as FirmwareFixture;
}

function byteFree(entry: FirmwareEntry): Record<string, Json> {
  return {
    errors: entry.errors,
    hash: entry.hash,
    kind: entry.kind,
    linkTarget: entry.linkTarget,
    path: entry.path,
    scanId: entry.scanId,
    size: entry.size,
  };
}

export class PlatformFirmwareState implements MockPlatformFirmwareState {
  readonly #fixtureRoot: string;
  #fixture: FirmwareFixture;

  constructor(fixtureRoot: string) {
    this.#fixtureRoot = fixtureRoot;
    this.#fixture = readFixture(fixtureRoot);
    this.#verifySamples();
  }

  get projectVersionId(): string { return this.#fixture.projectVersionId; }
  get scanId(): string { return this.#fixture.scanId; }
  get artifactHash(): string { return this.#fixture.artifactHash; }

  reset(): void {
    this.#fixture = readFixture(this.#fixtureRoot);
    this.#verifySamples();
  }

  tree(input: { path: string; depth: number; hash?: string }): Record<string, Json> {
    if (!Number.isSafeInteger(input.depth) || input.depth < 0 || input.depth > 20) {
      throw new RangeError("FIRMWARE_DEPTH_INVALID");
    }
    const prefix = input.path.replace(/\/+$/u, "");
    const prefixDepth = prefix.split("/").filter(Boolean).length;
    const entries = this.#fixture.entries.filter((entry) => {
      if (input.hash !== undefined && entry.hash !== input.hash) return false;
      if (entry.path !== prefix && !entry.path.startsWith(`${prefix}/`)) return false;
      return entry.path.split("/").filter(Boolean).length - prefixDepth <= input.depth;
    });
    return {
      artifactHash: this.#fixture.artifactHash,
      entries: entries.map(byteFree),
      path: input.path,
      projectVersionId: this.#fixture.projectVersionId,
      scanId: this.#fixture.scanId,
      total: input.path === this.#fixture.path && input.hash === undefined
        ? this.#fixture.total
        : entries.length,
    };
  }

  metadata(hash: string): Record<string, Json> {
    const entry = this.#entry(hash);
    return {
      ...byteFree(entry),
      artifactHash: this.#fixture.artifactHash,
      projectVersionId: this.#fixture.projectVersionId,
    };
  }

  bytes(hash: string): Uint8Array {
    const entry = this.#entry(hash);
    if (entry.byteSample === null) throw new Error("FIRMWARE_BYTES_UNAVAILABLE");
    return readFileSync(resolve(this.#fixtureRoot, entry.byteSample));
  }

  #entry(hash: string): FirmwareEntry {
    const entry = this.#fixture.entries.find((candidate) => candidate.hash === hash);
    if (entry === undefined) throw new Error("FIRMWARE_FILE_NOT_FOUND");
    return entry;
  }

  #verifySamples(): void {
    for (const entry of this.#fixture.entries) {
      if (entry.byteSample === null || entry.hash === null || entry.size === null) continue;
      const bytes = readFileSync(resolve(this.#fixtureRoot, entry.byteSample));
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (hash !== entry.hash || bytes.byteLength !== entry.size) {
        throw new Error(`FIRMWARE_SAMPLE_INTEGRITY:${entry.path}`);
      }
    }
  }
}

function error(status: number, code: string): Response {
  return Response.json({ error: { code } }, { status });
}

function scanMatches(context: MockHandlerContext, state: MockPlatformFirmwareState): boolean {
  const scanId = new URL(context.request.url).searchParams.get("scanId");
  return scanId === null || scanId === state.scanId;
}

function isAdmin(context: MockHandlerContext): boolean {
  return (context.request.headers.get("X-Mock-Permissions") ?? "")
    .split(",")
    .map((permission) => permission.trim())
    .includes(MOCK_PLATFORM_ADMIN_PERMISSION);
}

function findHash(context: MockHandlerContext): string | null {
  return new URL(context.request.url).searchParams.get("hash");
}

export function registerMockPlatformFirmware(
  registry: MockHandlerRegistry,
  fixtureRoot: string,
): MockPlatformFirmwareState {
  const state = new PlatformFirmwareState(fixtureRoot);
  registry.register(
    "platform:GET:/public/v0/projects/versions/{projectVersionId}/filesystem/tree",
    (context) => {
      if (context.params.projectVersionId !== state.projectVersionId || !scanMatches(context, state)) {
        return error(404, "FIRMWARE_SCAN_NOT_FOUND");
      }
      const query = new URL(context.request.url).searchParams;
      try {
        return Response.json(state.tree({
          path: query.get("path") ?? "rootfs",
          depth: Number(query.get("depth") ?? "1"),
          ...(query.get("hash") === null ? {} : { hash: query.get("hash")! }),
        }));
      } catch (caught: unknown) {
        return error(caught instanceof RangeError ? 400 : 404, caught instanceof Error ? caught.message : "FIRMWARE_ERROR");
      }
    },
  );
  registry.register(
    "platform:GET:/public/v0/projects/versions/{projectVersionId}/filesystem/overview",
    (context) => {
      const hash = findHash(context);
      if (context.params.projectVersionId !== state.projectVersionId || !scanMatches(context, state) || hash === null) {
        return error(404, "FIRMWARE_FILE_NOT_FOUND");
      }
      try { return Response.json(state.metadata(hash)); }
      catch { return error(404, "FIRMWARE_FILE_NOT_FOUND"); }
    },
  );
  registry.register(
    "platform:GET:/public/v0/projects/versions/{projectVersionId}/filesystem/content",
    (context) => byteResponse(context, state, true),
  );
  registry.register(
    "platform:GET:/public/v0/projects/versions/{projectVersionId}/filesystem/file",
    (context) => byteResponse(context, state, false),
  );
  registry.onReset(() => state.reset());
  return state;
}

function byteResponse(
  context: MockHandlerContext,
  state: MockPlatformFirmwareState,
  range: boolean,
): Response {
  if (!isAdmin(context)) return error(403, "FIRMWARE_BYTES_FORBIDDEN");
  const hash = findHash(context);
  if (context.params.projectVersionId !== state.projectVersionId || !scanMatches(context, state) || hash === null) {
    return error(404, "FIRMWARE_FILE_NOT_FOUND");
  }
  try {
    let bytes = state.bytes(hash);
    if (range) {
      const query = new URL(context.request.url).searchParams;
      const offset = Number(query.get("offset") ?? "0");
      const maxBytes = Number(query.get("maxBytes") ?? "0");
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(maxBytes) ||
        maxBytes < 1 || maxBytes > MOCK_FIRMWARE_RANGE_MAX_BYTES) {
        return error(400, "FIRMWARE_RANGE_INVALID");
      }
      bytes = bytes.slice(offset, offset + maxBytes);
    }
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Artifact-Sha256": hash,
        "X-Artifact-Size": String(bytes.byteLength),
      },
    });
  } catch {
    return error(404, "FIRMWARE_BYTES_UNAVAILABLE");
  }
}
