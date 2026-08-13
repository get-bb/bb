import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createPluginContext } from "../../../lib/context.js";
import { PlatformClient } from "../../../lib/remote/platform/client.js";
import { RemoteLimiter, type Scheduler } from "../../../lib/remote/rate-limit.js";
import { registerMockPlatformFirmware } from "../../../test/mock-remote/platform/firmware.js";
import { createMockRemote, type MockRemoteHarness } from "../../../test/mock-remote/server.js";
import { openManifest, type FirmwareNode } from "../cache/manifest.js";
import { createFirmwareCacheService } from "../register.js";
import { materializeFromApi, type ApiFirmwareDeps } from "./fallback.js";

const roots: string[] = [];
const harnesses: MockRemoteHarness[] = [];
const mockFixtureRoot = fileURLToPath(new URL("../../../test/mock-remote/fixtures", import.meta.url));

async function fixture(
  fetch: typeof globalThis.fetch,
  limiter?: RemoteLimiter,
  projectVersionId = "pv-1",
) {
  const root = await mkdtemp(join(tmpdir(), "fs-api-enumerate-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet", root]);
  await writeFile(join(root, ".gitignore"), ".fs-firmware/\n", "utf8");
  const host = createFakePluginHost({ pluginId: "finite-state" });
  const ctx = createPluginContext(host.bb);
  const scope = {
    worktreeRoot: await realpath(root),
    projectId: "project-1",
    projectVersionId,
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
  const client = new PlatformClient({
    baseUrl: "https://platform.invalid",
    token: "token",
    fetch,
    ...(limiter === undefined ? {} : { limiter }),
  });
  const deps: ApiFirmwareDeps = {
    platform: client,
    scope,
    cache: createFirmwareCacheService(ctx),
    now: () => new Date(0),
  };
  return { root: scope.worktreeRoot, host, client, deps };
}

function page(entries: unknown[], total = entries.length) {
  return Response.json({
    entries,
    total,
    scanId: "scan-1",
    artifactHash: "a".repeat(64),
  });
}

function directory(path: string) {
  return { path, kind: "directory", hash: null, size: null, linkTarget: null, errors: [], scanId: "scan-1" };
}

function manifestDirectory(path: string): FirmwareNode {
  return {
    path,
    kind: "directory",
    fileHash: null,
    size: null,
    mimeType: null,
    fullType: null,
    unixMode: null,
    symlinkTarget: null,
    materialized: false,
    errors: [],
  };
}

function file(path: string) {
  return { path, kind: "file", hash: "b".repeat(64), size: 7, linkTarget: null, errors: [], scanId: "scan-1" };
}

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("API firmware enumeration", () => {
  it("recurses through the limiter with bounded depth-eight calls and clamps at eight levels", async () => {
    const calls: Array<{ path: string; depth: string | null }> = [];
    const test = await fixture(async (input) => {
      const url = new URL(String(input));
      const path = url.searchParams.get("path") ?? "rootfs";
      calls.push({ path, depth: url.searchParams.get("depth") });
      const level = path.split("/").length - 1;
      return page([directory(`${path}/d${level + 1}`)]);
    });
    try {
      const mount = await materializeFromApi(test.deps, { pvId: "pv-1", mode: "metadata" }, new AbortController().signal);
      expect(calls).toHaveLength(8);
      expect(calls.every((call) => call.depth === "8")).toBe(true);
      expect(mount.readiness).toBe("metadata_only");
      const manifest = openManifest(test.root, "pv-1");
      expect(manifest.getNode("/d1/d2/d3/d4/d5/d6/d7/d8")?.errors).toContain(
        "Firmware crawl depth limit reached at rootfs/d1/d2/d3/d4/d5/d6/d7/d8.",
      );
      expect(manifest.readMeta()?.unpackErrors).toContain(
        "Firmware crawl depth limit reached at rootfs/d1/d2/d3/d4/d5/d6/d7/d8.",
      );
      manifest.close();
    } finally {
      test.client.close();
    }
  });

  it("discovers every reviewed leaf in the real directoryless WP-12 fixture", async () => {
    const harness = createMockRemote({
      platformToken: "token",
      assuranceStudioKey: "as-key",
      fixtureRoot: mockFixtureRoot,
      register(service, registry) {
        if (service === "platform") registerMockPlatformFirmware(registry, mockFixtureRoot);
      },
    });
    harnesses.push(harness);
    const test = await fixture(
      (input, init) => harness.platform.fetch(input, init),
      undefined,
      "pv-a481df87dadf",
    );
    try {
      await materializeFromApi(test.deps, {
        pvId: "pv-a481df87dadf",
        mode: "metadata",
      }, new AbortController().signal);
      const manifest = openManifest(test.root, "pv-a481df87dadf");
      const nodes = manifest.listNodes();
      expect(nodes.filter((node) => node.kind === "file")).toHaveLength(99);
      expect(nodes.filter((node) => node.kind === "symlink")).toHaveLength(1);
      expect(manifest.getNode("/usr/bin/eagled")?.fileHash).toBe(
        "b16e06bd84484d737304616ed406cec442a7cd87af088f72f8580755e7585b5d",
      );
      expect(manifest.readMeta()?.unpackErrors.join("\n")).toContain("truncated");
      manifest.close();
    } finally {
      test.client.close();
    }
  });

  it("refuses to replace a coherent standalone-unpack mount", async () => {
    let browseCalls = 0;
    const test = await fixture(async () => {
      browseCalls += 1;
      return page([]);
    });
    const manifest = openManifest(test.root, "pv-1");
    manifest.replaceNodes([manifestDirectory("/local")], {
      pvId: "pv-1",
      scanId: "local-scan",
      inputSha256: "c".repeat(64),
      source: "standalone_unpack",
      artifactHash: null,
      fullyMaterialized: true,
      materializedAt: new Date(0).toISOString(),
      nodeCount: 1,
      hydratedCount: 0,
      adminBytesOk: true,
      unpackErrors: [],
      stale: false,
    });
    manifest.close();
    try {
      await expect(materializeFromApi(test.deps, {
        pvId: "pv-1",
        mode: "metadata",
      }, new AbortController().signal)).rejects.toMatchObject({
        code: "API_FALLBACK_PRIMARY_MOUNT_AVAILABLE",
      });
      expect(browseCalls).toBe(0);
      const preserved = openManifest(test.root, "pv-1");
      expect(preserved.readMeta()).toMatchObject({ source: "standalone_unpack", fullyMaterialized: true });
      expect(preserved.listNodes().map((node) => node.path)).toEqual(["/local"]);
      preserved.close();
    } finally {
      test.client.close();
    }
  });

  it("detects truncation and repeated directories without creating file placeholders", async () => {
    const test = await fixture(async (input) => {
      const path = new URL(String(input)).searchParams.get("path") ?? "rootfs";
      return path === "rootfs"
        ? page([directory("rootfs/loop"), file("rootfs/metadata-only.bin")], 4)
        : page([directory("rootfs/loop")]);
    });
    try {
      const mount = await materializeFromApi(test.deps, { pvId: "pv-1", mode: "metadata" }, new AbortController().signal);
      expect(mount.errors.join("\n")).toContain("truncated");
      expect(mount.errors.join("\n")).toContain("not crawled twice");
      await expect(readFile(join(mount.rootfsPath, "metadata-only.bin"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await realpath(join(mount.rootfsPath, "loop"))).toBe(join(mount.rootfsPath, "loop"));
    } finally {
      test.client.close();
    }
  });

  it("checkpoints accepted metadata on cancellation and resumes without losing it", async () => {
    const controller = new AbortController();
    let firstCalls = 0;
    const test = await fixture(async (input) => {
      firstCalls += 1;
      const path = new URL(String(input)).searchParams.get("path") ?? "rootfs";
      if (path === "rootfs") return page([directory("rootfs/a")]);
      controller.abort();
      throw new DOMException("cancelled", "AbortError");
    });
    await expect(materializeFromApi(test.deps, { pvId: "pv-1", mode: "metadata" }, controller.signal)).rejects.toBeDefined();
    expect(firstCalls).toBe(2);
    let manifest = openManifest(test.root, "pv-1");
    expect(manifest.getNode("/a")?.kind).toBe("directory");
    manifest.close();
    test.client.close();

    const resumed = new PlatformClient({
      baseUrl: "https://platform.invalid",
      token: "token",
      fetch: async (input) => {
        const path = new URL(String(input)).searchParams.get("path") ?? "rootfs";
        return path === "rootfs" ? page([directory("rootfs/a")]) : page([file("rootfs/a/recovered.bin")]);
      },
    });
    test.deps.platform = resumed;
    try {
      await materializeFromApi(test.deps, { pvId: "pv-1", mode: "metadata" }, new AbortController().signal);
      manifest = openManifest(test.root, "pv-1");
      expect(manifest.getNode("/a/recovered.bin")?.materialized).toBe(false);
      manifest.close();
    } finally {
      resumed.close();
    }
  });

  it("rejects a malformed tree node while retaining a resumable sidecar", async () => {
    const test = await fixture(async () => page([{ path: "rootfs/bad", kind: "device" }]));
    try {
      await expect(materializeFromApi(test.deps, { pvId: "pv-1", mode: "metadata" }, new AbortController().signal))
        .rejects.toMatchObject({ code: "API_FIRMWARE_TREE_MALFORMED" });
      const manifest = openManifest(test.root, "pv-1");
      expect(manifest.readMeta()?.source).toBe("api");
      manifest.close();
    } finally {
      test.client.close();
    }
  });

  it("honors Retry-After through the Platform limiter and leaves an exhaustion checkpoint", async () => {
    const delays: number[] = [];
    const scheduler: Scheduler = {
      now: () => 0,
      async sleep(ms) { delays.push(ms); },
    };
    const limiter = new RemoteLimiter({
      concurrency: 1,
      maxAttempts: 3,
      maxBackoffMs: 10_000,
      scheduler,
      random: () => 0,
    });
    let attempts = 0;
    const test = await fixture(async () => {
      attempts += 1;
      return Response.json({ error: { code: "MOCK_RATE_LIMITED" } }, {
        status: 429,
        headers: { "Retry-After": "2" },
      });
    }, limiter);
    try {
      await expect(materializeFromApi(test.deps, { pvId: "pv-1", mode: "metadata" }, new AbortController().signal))
        .rejects.toMatchObject({ code: "REMOTE_RATE_LIMITED", status: 429 });
      expect(attempts).toBe(3);
      expect(delays).toEqual([2_000, 2_000]);
      const manifest = openManifest(test.root, "pv-1");
      expect(manifest.readMeta()).toMatchObject({ source: "api", nodeCount: 0, hydratedCount: 0 });
      manifest.close();
    } finally {
      test.client.close();
    }
  });
});
