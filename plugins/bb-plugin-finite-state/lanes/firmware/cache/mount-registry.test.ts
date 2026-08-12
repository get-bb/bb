import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createPluginContext } from "../../../lib/context.js";
import { commitFirmwareMount, getRegisteredFirmwareMount } from "./mount-registry.js";
import {
  getMountReadiness,
  openManifest,
  type FirmwareManifestMeta,
  type FirmwareMount,
  type FirmwareNode,
} from "./manifest.js";

async function createIgnoredWorktree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fs-firmware-registry-test-"));
  execFileSync("git", ["init", "--quiet", root]);
  await writeFile(join(root, ".gitignore"), ".fs-firmware/\n", "utf8");
  return root;
}

function fileNode(path: string, materialized = false): FirmwareNode {
  return {
    path,
    kind: "file",
    fileHash: "a".repeat(64),
    size: 4,
    mimeType: "application/octet-stream",
    fullType: null,
    unixMode: 0o644,
    symlinkTarget: null,
    materialized,
    errors: [],
  };
}

function manifestMeta(overrides: Partial<FirmwareManifestMeta> = {}): FirmwareManifestMeta {
  return {
    pvId: "pv-1",
    scanId: null,
    inputSha256: null,
    source: "api",
    artifactHash: null,
    fullyMaterialized: false,
    materializedAt: null,
    nodeCount: 0,
    hydratedCount: 0,
    adminBytesOk: null,
    unpackErrors: [],
    stale: false,
    ...overrides,
  };
}

describe("firmware mount registry", () => {
  it("advances the shared row only after a coherent sidecar/rootfs commit", async () => {
    const root = await createIgnoredWorktree();
    const host = createFakePluginHost({ pluginId: "finite-state" });
    const ctx = createPluginContext(host.bb);
    const db = ctx.db();
    const scope = { projectId: "project-1", projectVersionId: "pv-1", generationId: "gen-1" };
    db.prepare(`INSERT INTO pull_generation (
      project_id, project_version_id, generation_id, status, requested_kinds_json, started_at
    ) VALUES (?, ?, ?, 'accepted', '[]', ?)`).run(
      scope.projectId,
      scope.projectVersionId,
      scope.generationId,
      new Date(0).toISOString(),
    );

    const manifest = openManifest(root, "pv-1");
    const bytes = "firmware";
    const hydrated = {
      ...fileNode("/bin/tool", true),
      fileHash: createHash("sha256").update(bytes).digest("hex"),
      size: Buffer.byteLength(bytes),
      errors: ["mode unavailable"],
    };
    manifest.replaceNodes(
      [hydrated],
      manifestMeta({
        nodeCount: 1,
        hydratedCount: 1,
        scanId: "scan-1",
        unpackErrors: ["one extractor warning"],
      }),
    );
    const rootfsPath = `${root}/.fs-firmware/pv-1/rootfs`;
    await mkdir(`${rootfsPath}/bin`, { recursive: true });
    await writeFile(`${rootfsPath}/bin/tool`, bytes);
    const mount: FirmwareMount = {
      pvId: "pv-1",
      source: "api",
      rootfsPath,
      manifestPath: manifest.path,
      inputSha256: null,
      artifactHash: null,
      readiness: getMountReadiness(manifest),
      nodeCount: 1,
      hydratedCount: 1,
      errors: [],
    };

    commitFirmwareMount(db, {
      scope,
      manifest,
      mount,
      scanId: "scan-1",
      adminBytesOk: true,
      pulledAt: new Date(1).toISOString(),
    });
    expect(getRegisteredFirmwareMount(db, scope)).toMatchObject({
      state: "ready_with_gaps",
      fileCount: 1,
      materializedFiles: 1,
      errorCount: 2,
    });

    manifest.writeMeta(manifestMeta({ pvId: "pv-2", nodeCount: 1, hydratedCount: 1 }));
    expect(() =>
      commitFirmwareMount(db, {
        scope,
        manifest,
        mount,
        scanId: "scan-2",
        adminBytesOk: false,
        pulledAt: new Date(2).toISOString(),
      }),
    ).toThrow(/does not match/iu);
    expect(getRegisteredFirmwareMount(db, scope)).toMatchObject({
      state: "ready_with_gaps",
      errorCount: 2,
      pulledAt: new Date(1).toISOString(),
    });

    manifest.close();
    await host.harness.lifecycle.dispose();
    await rm(root, { recursive: true, force: true });
  });
});
