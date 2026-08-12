import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createPluginContext } from "../../../lib/context.js";
import { FirmwareCacheError } from "../cache/layout.js";
import type { FirmwareManifestMeta, FirmwareNode } from "../cache/manifest.js";
import { createFirmwareCacheService } from "../register.js";
import { ingestSnapshotGeneration, type UnpackCache } from "./ingest.js";
import type { Snapshot } from "./snapshot-schema.js";

const roots: string[] = [];
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "fs-unpack-ingest-test-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet", root]);
  await writeFile(join(root, ".gitignore"), ".fs-firmware/\n", "utf8");
  const canonicalRoot = await realpath(root);
  const host = createFakePluginHost({ pluginId: "finite-state" });
  const ctx = createPluginContext(host.bb);
  const scope = {
    worktreeRoot: canonicalRoot,
    projectId: "project-1",
    projectVersionId: "pv-1",
    generationId: "gen-1",
  };
  ctx
    .db()
    .prepare(
      `INSERT INTO pull_generation (
    project_id, project_version_id, generation_id, status, requested_kinds_json, started_at
  ) VALUES (?, ?, ?, 'accepted', '[]', ?)`,
    )
    .run(
      scope.projectId,
      scope.projectVersionId,
      scope.generationId,
      new Date(0).toISOString(),
    );
  return {
    root: canonicalRoot,
    host,
    scope,
    cache: createFirmwareCacheService(ctx),
  };
}

async function createStage(
  root: string,
  files: Readonly<Record<string, string>>,
) {
  const stage = join(root, ".fs-firmware", "pv-1", "staging", "test-stage");
  const rootfs = join(stage, "rootfs");
  await mkdir(rootfs, { recursive: true });
  for (const [path, bytes] of Object.entries(files)) {
    const destination = join(rootfs, path);
    await mkdir(join(destination, ".."), { recursive: true });
    await writeFile(destination, bytes);
  }
  const snapshotPath = join(stage, "snapshot.json");
  await writeFile(snapshotPath, "{}", "utf8");
  return { rootfs, snapshotPath };
}

function snapshot(files: Readonly<Record<string, string>>): Snapshot {
  return {
    inputFile: "firmware.bin",
    inputSha256: digest("firmware"),
    fileTree: Object.entries(files).map(([path, bytes]) => ({
      filePath: `/${path}`,
      fileHash: digest(bytes),
      fileName: path.split("/").at(-1)!,
      mimeType: "application/octet-stream",
      fullType: null,
      fileSize: Buffer.byteLength(bytes),
    })),
    unpackMetadata: {},
    errors: [],
  };
}

async function createCoherentPreviousMount(
  fixture: Awaited<ReturnType<typeof createFixture>>,
): Promise<void> {
  const bytes = "old-coherent-bytes";
  const hash = digest(bytes);
  const rootfs = join(fixture.root, ".fs-firmware", "pv-1", "rootfs");
  await mkdir(rootfs, { recursive: true });
  const manifest = fixture.cache.open(fixture.scope);
  const node: FirmwareNode = {
    path: "/old.txt",
    kind: "file",
    fileHash: hash,
    size: Buffer.byteLength(bytes),
    mimeType: "text/plain",
    fullType: null,
    unixMode: 0o644,
    symlinkTarget: null,
    materialized: true,
    errors: [],
  };
  const meta: FirmwareManifestMeta = {
    pvId: "pv-1",
    scanId: null,
    inputSha256: digest("old-input"),
    source: "standalone_unpack",
    artifactHash: null,
    fullyMaterialized: true,
    materializedAt: new Date(0).toISOString(),
    nodeCount: 1,
    hydratedCount: 1,
    adminBytesOk: true,
    unpackErrors: [],
    stale: false,
  };
  manifest.replaceNodes([node], meta);
  const blob = await fixture.cache.putBlob(
    fixture.scope,
    Readable.from([bytes]),
    hash,
  );
  await fixture.cache.linkNode(
    fixture.scope,
    {
      pvId: "pv-1",
      source: "standalone_unpack",
      rootfsPath: rootfs,
      manifestPath: manifest.path,
      inputSha256: meta.inputSha256,
      artifactHash: null,
      readiness: "fully_materialized",
      nodeCount: 1,
      hydratedCount: 1,
      errors: [],
    },
    node,
    blob.path,
  );
  fixture.cache.verifyIntegrity(manifest);
  manifest.close();
  await writeFile(
    join(fixture.root, ".fs-firmware", "pv-1", "snapshot.json"),
    "old snapshot",
  );
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("standalone snapshot ingestion", () => {
  it("preserves global and per-file extractor provenance and publishes a partial mount", async () => {
    const fixture = await createFixture();
    const files = { "bin/tool": "payload" };
    const stage = await createStage(fixture.root, files);
    const input = snapshot(files);
    const hash = input.fileTree[0]!.fileHash!;
    input.unpackMetadata[hash] = {
      tried: ["fake"],
      errorType: "UnpackError",
      errorMsg: "nested archive truncated",
    };
    input.errors = [{ message: "one global gap" }];

    const result = await ingestSnapshotGeneration({
      scope: fixture.scope,
      cache: fixture.cache,
      snapshot: input,
      extractedRootfs: stage.rootfs,
      stagedSnapshotPath: stage.snapshotPath,
      scanId: "scan-1",
      now: () => new Date("2026-08-12T00:00:00.000Z"),
      promotionId: "partial",
    });

    expect(result.mount.readiness).toBe("partial");
    const manifest = fixture.cache.open(fixture.scope);
    expect(manifest.readMeta()).toMatchObject({
      fullyMaterialized: false,
      unpackErrors: [JSON.stringify({ message: "one global gap" })],
    });
    expect(manifest.getNode("/bin/tool")?.errors).toEqual([
      "UnpackError: nested archive truncated",
    ]);
    expect(
      JSON.parse(
        (
          manifest.database
            .prepare("SELECT value FROM fs_meta WHERE key='unpack_metadata'")
            .get() as { value: string }
        ).value,
      ),
    ).toEqual(input.unpackMetadata);
    manifest.close();
    await fixture.host.harness.lifecycle.dispose();
  });

  it("retains the previous coherent generation on a promotion-time link failure", async () => {
    const fixture = await createFixture();
    await createCoherentPreviousMount(fixture);
    const files = { "new.txt": "new bytes" };
    const stage = await createStage(fixture.root, files);
    const failingCache: UnpackCache = {
      ...fixture.cache,
      linkNode: async () => {
        throw new FirmwareCacheError(
          "INJECTED_LINK_FAILURE",
          "injected promotion failure",
        );
      },
    };

    await expect(
      ingestSnapshotGeneration({
        scope: fixture.scope,
        cache: failingCache,
        snapshot: snapshot(files),
        extractedRootfs: stage.rootfs,
        stagedSnapshotPath: stage.snapshotPath,
        scanId: null,
        now: () => new Date(0),
        promotionId: "rollback",
      }),
    ).rejects.toMatchObject({ code: "INJECTED_LINK_FAILURE" });
    expect(
      await readFile(
        join(fixture.root, ".fs-firmware", "pv-1", "rootfs", "old.txt"),
        "utf8",
      ),
    ).toBe("old-coherent-bytes");
    expect(
      await readFile(
        join(fixture.root, ".fs-firmware", "pv-1", "snapshot.json"),
        "utf8",
      ),
    ).toBe("old snapshot");
    const restored = fixture.cache.open(fixture.scope);
    expect(restored.readMeta()).toMatchObject({
      inputSha256: digest("old-input"),
      nodeCount: 1,
    });
    restored.close();
    await fixture.host.harness.lifecycle.dispose();
  });

  it("does not disturb the previous generation when the 500th file fails digest verification", async () => {
    const fixture = await createFixture();
    await createCoherentPreviousMount(fixture);
    const files = Object.fromEntries(
      Array.from({ length: 500 }, (_, index) => [
        `files/${index}.bin`,
        `bytes-${index}`,
      ]),
    );
    const stage = await createStage(fixture.root, files);
    let calls = 0;
    const failingCache: UnpackCache = {
      ...fixture.cache,
      async putBlob() {
        calls += 1;
        if (calls === 500) {
          throw new FirmwareCacheError(
            "BLOB_HASH_MISMATCH",
            "injected 500th-file digest mismatch",
          );
        }
        return { path: "unused-before-promotion", reused: true };
      },
    };

    await expect(
      ingestSnapshotGeneration({
        scope: fixture.scope,
        cache: failingCache,
        snapshot: snapshot(files),
        extractedRootfs: stage.rootfs,
        stagedSnapshotPath: stage.snapshotPath,
        scanId: null,
        now: () => new Date(0),
        promotionId: "file-500",
      }),
    ).rejects.toMatchObject({ code: "BLOB_HASH_MISMATCH" });
    expect(calls).toBe(500);
    expect(
      await readFile(
        join(fixture.root, ".fs-firmware", "pv-1", "rootfs", "old.txt"),
        "utf8",
      ),
    ).toBe("old-coherent-bytes");
    const retained = fixture.cache.open(fixture.scope);
    expect(retained.readMeta()?.inputSha256).toBe(digest("old-input"));
    retained.close();
    await fixture.host.harness.lifecycle.dispose();
  });
});
