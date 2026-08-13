import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createPluginContext } from "../../../lib/context.js";
import { PlatformClient } from "../../../lib/remote/platform/client.js";
import { openManifest } from "../cache/manifest.js";
import { createFirmwareCacheService } from "../register.js";
import { materializeFromApi, type ApiFirmwareDeps } from "./fallback.js";
import { API_RANGE_MAX_BYTES, previewFirmwareFile } from "./hydrate.js";

const roots: string[] = [];
const sha256 = (bytes: string) => createHash("sha256").update(bytes).digest("hex");

async function fixture(fetch: typeof globalThis.fetch) {
  const root = await mkdtemp(join(tmpdir(), "fs-api-hydrate-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet", root]);
  await writeFile(join(root, ".gitignore"), ".fs-firmware/\n", "utf8");
  const host = createFakePluginHost({ pluginId: "finite-state" });
  const ctx = createPluginContext(host.bb);
  const scope = {
    worktreeRoot: await realpath(root),
    projectId: "project-1",
    projectVersionId: "pv-1",
    generationId: "generation-1",
  };
  ctx.db().prepare(`INSERT INTO pull_generation (
    project_id, project_version_id, generation_id, status, requested_kinds_json, started_at
  ) VALUES (?, ?, ?, 'accepted', '[]', ?)`).run(
    scope.projectId,
    scope.projectVersionId,
    scope.generationId,
    new Date(0).toISOString(),
  );
  const client = new PlatformClient({ baseUrl: "https://platform.invalid", token: "token", fetch });
  const deps: ApiFirmwareDeps = {
    platform: client,
    scope,
    cache: createFirmwareCacheService(ctx),
    now: () => new Date(0),
  };
  return { root: scope.worktreeRoot, client, deps };
}

function entry(path: string, bytes: string) {
  return {
    path: `rootfs/${path}`,
    kind: "file",
    hash: sha256(bytes),
    size: Buffer.byteLength(bytes),
    linkTarget: null,
    errors: [],
    scanId: "scan-1",
  };
}

function tree(entries: unknown[]) {
  return Response.json({ entries, total: entries.length, scanId: "scan-1", artifactHash: null });
}

function binary(bytes: string, contentSha256?: string): Response {
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/octet-stream",
      ...(contentSha256 === undefined ? {} : { "X-Content-Sha256": contentSha256 }),
    },
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("API firmware hydration", () => {
  it("enforces the 128 KiB preview boundary and never marks preview bytes materialized", async () => {
    const bytes = "diagnostic-preview";
    let byteCalls = 0;
    const test = await fixture(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/tree")) return tree([entry("preview.bin", bytes)]);
      byteCalls += 1;
      return binary(bytes.slice(Number(url.searchParams.get("offset")), Number(url.searchParams.get("maxBytes"))));
    });
    try {
      await materializeFromApi(test.deps, { pvId: "pv-1", mode: "metadata" }, new AbortController().signal);
      await expect(previewFirmwareFile(test.deps, {
        pvId: "pv-1",
        path: "/preview.bin",
        maxBytes: API_RANGE_MAX_BYTES + 1,
      }, new AbortController().signal)).rejects.toMatchObject({ code: "API_FIRMWARE_RANGE_INVALID" });
      expect(byteCalls).toBe(0);
      const preview = await previewFirmwareFile(test.deps, {
        pvId: "pv-1",
        path: "/preview.bin",
        maxBytes: API_RANGE_MAX_BYTES,
      }, new AbortController().signal);
      expect(preview.hex).toBe(Buffer.from(bytes).toString("hex"));
      expect(preview.bytesReturned).toBe(Buffer.byteLength(bytes));
      const manifest = openManifest(test.root, "pv-1");
      expect(manifest.getNode("/preview.bin")?.materialized).toBe(false);
      expect(manifest.counts().hydrated).toBe(0);
      manifest.close();
    } finally {
      test.client.close();
    }
  });

  it("streams full bytes through request staging, verifies the manifest hash, and promotes the file", async () => {
    const bytes = "verified-full-firmware-bytes";
    const test = await fixture(async (input) => {
      const url = new URL(String(input));
      return url.pathname.endsWith("/tree")
        ? tree([entry("bin/tool", bytes)])
        : binary(bytes, sha256(bytes));
    });
    try {
      const mount = await materializeFromApi(test.deps, {
        pvId: "pv-1",
        mode: "files",
        paths: ["/bin/tool"],
      }, new AbortController().signal);
      expect(await readFile(join(mount.rootfsPath, "bin/tool"), "utf8")).toBe(bytes);
      expect(mount.hydratedCount).toBe(1);
      const manifest = openManifest(test.root, "pv-1");
      expect(manifest.getNode("/bin/tool")?.materialized).toBe(true);
      manifest.close();
    } finally {
      test.client.close();
    }
  });

  it("rejects hash mismatches and missing requested paths without promoting bytes", async () => {
    const expected = "expected";
    let fullCalls = 0;
    const test = await fixture(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/tree")) return tree([entry("bad.bin", expected)]);
      fullCalls += 1;
      return binary("different");
    });
    try {
      await expect(materializeFromApi(test.deps, {
        pvId: "pv-1", mode: "files", paths: ["/missing.bin"],
      }, new AbortController().signal)).rejects.toMatchObject({ code: "FIRMWARE_PATH_NOT_FOUND" });
      expect(fullCalls).toBe(0);
      await expect(materializeFromApi(test.deps, {
        pvId: "pv-1", mode: "files", paths: ["/bad.bin"],
      }, new AbortController().signal)).rejects.toMatchObject({ code: "BLOB_HASH_MISMATCH" });
      const manifest = openManifest(test.root, "pv-1");
      expect(manifest.getNode("/bad.bin")?.materialized).toBe(false);
      manifest.close();
    } finally {
      test.client.close();
    }
  });

  it("preserves the first verified blob across a stream reset and skips it on resume", async () => {
    const bytes = { "one.bin": "first", "two.bin": "second" };
    const calls = new Map<string, number>();
    let failSecond = true;
    const test = await fixture(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/tree")) return tree(Object.entries(bytes).map(([path, value]) => entry(path, value)));
      const hash = url.searchParams.get("hash")!;
      calls.set(hash, (calls.get(hash) ?? 0) + 1);
      if (hash === sha256(bytes["two.bin"]) && failSecond) {
        failSecond = false;
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(Buffer.from("sec"));
            controller.error(new Error("connection reset"));
          },
        }), { headers: { "Content-Type": "application/octet-stream" } });
      }
      const value = hash === sha256(bytes["one.bin"]) ? bytes["one.bin"] : bytes["two.bin"];
      return binary(value);
    });
    try {
      const request = { pvId: "pv-1", mode: "files" as const, paths: ["/one.bin", "/two.bin"] };
      await expect(materializeFromApi(test.deps, request, new AbortController().signal)).rejects.toBeDefined();
      let manifest = openManifest(test.root, "pv-1");
      expect(manifest.getNode("/one.bin")?.materialized).toBe(true);
      expect(manifest.getNode("/two.bin")?.materialized).toBe(false);
      manifest.close();
      await materializeFromApi(test.deps, request, new AbortController().signal);
      expect(calls.get(sha256(bytes["one.bin"]))).toBe(1);
      expect(calls.get(sha256(bytes["two.bin"]))).toBe(2);
      manifest = openManifest(test.root, "pv-1");
      expect(manifest.counts().hydrated).toBe(2);
      manifest.close();
    } finally {
      test.client.close();
    }
  });

  it("rejects an unbounded per-file rootfs request before any Platform call", async () => {
    let calls = 0;
    const test = await fixture(async () => {
      calls += 1;
      return tree([]);
    });
    try {
      expect(() => materializeFromApi(test.deps, {
        pvId: "pv-1", mode: "files",
      }, new AbortController().signal)).toThrow(expect.objectContaining({ code: "API_FULL_MATERIALIZATION_UNSUPPORTED" }));
      expect(calls).toBe(0);
    } finally {
      test.client.close();
    }
  });
});
