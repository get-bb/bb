import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createPluginContext } from "../../lib/context.js";
import { openManifest, type FirmwareManifestMeta, type FirmwareNode } from "./cache/manifest.js";
import { diffFirmware } from "./diff.js";

const roots: string[] = [];

async function worktree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fs-firmware-diff-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet", root]);
  await writeFile(join(root, ".gitignore"), ".fs-firmware/\n", "utf8");
  return root;
}

function node(path: string, hash: string, size: number, errors: string[] = []): FirmwareNode {
  return {
    path,
    kind: "file",
    fileHash: hash.repeat(64),
    size,
    mimeType: "application/octet-stream",
    fullType: "ELF executable",
    unixMode: 0o755,
    symlinkTarget: null,
    materialized: false,
    errors,
  };
}

function meta(pvId: string, count: number): FirmwareManifestMeta {
  return {
    pvId,
    scanId: null,
    inputSha256: null,
    source: "api",
    artifactHash: `${pvId}-artifact`,
    fullyMaterialized: false,
    materializedAt: null,
    nodeCount: count,
    hydratedCount: 0,
    adminBytesOk: null,
    unpackErrors: [],
    stale: false,
  };
}

function register(
  db: ReturnType<ReturnType<typeof createPluginContext>["db"]>,
  root: string,
  pvId: string,
  generationId: string,
): void {
  const at = `2026-08-13T00:00:0${generationId.at(-1) ?? "0"}.000Z`;
  db.prepare(`INSERT INTO pull_generation (
    project_id, project_version_id, generation_id, status, requested_kinds_json, started_at
  ) VALUES ('project-1', ?, ?, 'accepted', '["firmware"]', ?)`).run(pvId, generationId, at);
  db.prepare(`INSERT INTO firmware_mounts (
    project_id, project_version_id, generation_id, source, state, root_path,
    file_count, materialized_files, error_count, pulled_at
  ) VALUES ('project-1', ?, ?, 'api', 'metadata_only', ?, 0, 0, 0, ?)`).run(
    pvId,
    generationId,
    join(root, ".fs-firmware", pvId, "rootfs"),
    at,
  );
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("firmware manifest diff", () => {
  it("reports added, removed, hash/size changes, unchanged, regressions, and stable paging", async () => {
    const root = await worktree();
    const { bb, harness } = createFakePluginHost({ pluginId: "finite-state" });
    const ctx = createPluginContext(bb);
    const before = openManifest(root, "pv-before");
    before.replaceNodes([
      node("/bin/removed", "a", 10),
      node("/bin/changed", "b", 20),
      node("/bin/unchanged", "c", 999),
    ], meta("pv-before", 3));
    before.database.exec("ALTER TABLE fs_node ADD COLUMN security_features_json TEXT");
    before.database.prepare("UPDATE fs_node SET security_features_json=? WHERE path='/bin/changed'")
      .run(JSON.stringify({ nx: true, pie: true }));
    before.close();

    const after = openManifest(root, "pv-after");
    after.replaceNodes([
      node("/bin/added", "d", 40),
      node("/bin/changed", "e", 25),
      node("/bin/unchanged", "c", 30),
    ], meta("pv-after", 3));
    after.database.exec("ALTER TABLE fs_node ADD COLUMN security_features_json TEXT");
    after.database.prepare("UPDATE fs_node SET security_features_json=? WHERE path='/bin/changed'")
      .run(JSON.stringify({ nx: false, pie: true }));
    after.close();

    register(ctx.db(), root, "pv-before", "generation-1");
    register(ctx.db(), root, "pv-after", "generation-2");
    const first = diffFirmware({ db: ctx.db(), projectId: "project-1", pageSize: 2 }, "pv-before", "pv-after");
    expect(first).toMatchObject({ total: 3, unchanged: 1, fromAvailable: true, toAvailable: true });
    expect(first.items).toHaveLength(2);
    expect(first.cursor).toBeTruthy();
    const second = diffFirmware({ db: ctx.db(), projectId: "project-1", pageSize: 2 }, "pv-before", "pv-after", first.cursor);
    const all = [...first.items, ...second.items];
    expect(all.map(({ operation, path }) => `${operation}:${path}`)).toEqual([
      "added:bin/added",
      "changed:bin/changed",
      "removed:bin/removed",
    ]);
    expect(all.find(({ path }) => path === "bin/changed")).toMatchObject({
      beforeSize: 20,
      afterSize: 25,
      securityRegressions: ["nx: enabled → disabled"],
    });
    expect(all.some(({ path }) => path === "bin/unchanged")).toBe(false);
    expect(diffFirmware({ db: ctx.db(), projectId: "project-1", pageSize: 2 }, "pv-before", "pv-after").items)
      .toEqual(first.items);
    await harness.lifecycle.dispose();
  });

  it("returns the available side when the other sidecar is corrupt", async () => {
    const root = await worktree();
    const { bb, harness } = createFakePluginHost({ pluginId: "finite-state" });
    const ctx = createPluginContext(bb);
    const after = openManifest(root, "pv-after");
    after.replaceNodes([node("/bin/tool", "a", 10)], meta("pv-after", 1));
    after.close();
    await mkdir(join(root, ".fs-firmware", "pv-before"), { recursive: true });
    await writeFile(join(root, ".fs-firmware", "pv-before", "manifest.sqlite"), "not sqlite");
    register(ctx.db(), root, "pv-before", "generation-1");
    register(ctx.db(), root, "pv-after", "generation-2");
    expect(diffFirmware({ db: ctx.db(), projectId: "project-1" }, "pv-before", "pv-after")).toMatchObject({
      fromAvailable: false,
      toAvailable: true,
      items: [{ operation: "added", path: "bin/tool" }],
    });
    await harness.lifecycle.dispose();
  });

  it("diffs 30,000-node sidecars within the five-second service budget", async () => {
    const root = await worktree();
    const { bb, harness } = createFakePluginHost({ pluginId: "finite-state" });
    const ctx = createPluginContext(bb);
    const values = Array.from({ length: 30_000 }, (_, index) => node(`/usr/bin/tool-${index.toString().padStart(5, "0")}`, "a", index));
    for (const pvId of ["pv-before", "pv-after"] as const) {
      const manifest = openManifest(root, pvId);
      manifest.replaceNodes(values, meta(pvId, values.length));
      manifest.close();
    }
    register(ctx.db(), root, "pv-before", "generation-1");
    register(ctx.db(), root, "pv-after", "generation-2");
    const started = process.cpuUsage();
    const result = diffFirmware({ db: ctx.db(), projectId: "project-1" }, "pv-before", "pv-after");
    const cpu = process.cpuUsage(started);
    expect((cpu.user + cpu.system) / 1_000).toBeLessThan(5_000);
    expect(result).toMatchObject({ total: 0, unchanged: 30_000 });
    await harness.lifecycle.dispose();
  });
});
