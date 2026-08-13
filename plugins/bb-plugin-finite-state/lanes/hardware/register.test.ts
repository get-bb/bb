import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, chmod, cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginContext } from "../../lib/context.js";
import { registerHardware, safeHardwareDetail } from "./register.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
const semanticRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../test/fixtures/kicad/semantic");
afterEach(async () => Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose())));

async function sourceFixture() {
  const root = await mkdtemp(join(tmpdir(), "fs-hw-register-"));
  execFileSync("git", ["init", "--quiet", root]);
  await writeFile(join(root, ".gitignore"), ".fs-hw/\n");
  for (const [directory, version, pcb] of [["a", "5.1.12", false], ["b", "8.0.4", true]] as const) {
    await mkdir(join(root, directory));
    await writeFile(join(root, directory, `${directory}.kicad_pro`), "{}\n");
    await writeFile(join(root, directory, `${directory}.kicad_sch`),
      `(kicad_sch (version 20231120) (generator_version "${version}"))\n`);
    if (pcb) await writeFile(join(root, directory, `${directory}.kicad_pcb`), `(kicad_pcb (version 20231120))\n`);
  }
  return root;
}

async function sdkFile(path: string) {
  const content = await readFile(path);
  return {
    content: content.toString("utf8"),
    contentEncoding: "utf8" as const,
    sha256: createHash("sha256").update(content).digest("hex"),
    sizeBytes: content.length,
  };
}

function project(root: string, sources = true) {
  return {
    id: "project", kind: "standard" as const, name: "Project", gitRemoteUrl: null,
    createdAt: 1, updatedAt: 1,
    sources: sources ? [
      { id: "other", projectId: "project", type: "local_path" as const, hostId: "host", path: "/workspace/other", isDefault: false, createdAt: 1, updatedAt: 1 },
      { id: "default", projectId: "project", type: "local_path" as const, hostId: "host", path: root, isDefault: true, createdAt: 1, updatedAt: 1 },
    ] : [],
  };
}

describe("hardware registration", () => {
  it("serves semantics and refreshes child-sheet edits through production discovery", async () => {
    const fixtureParent = await mkdtemp(join(tmpdir(), "fs-hw-semantic-"));
    const root = join(fixtureParent, "semantic");
    await cp(semanticRoot, root, { recursive: true });
    let listPathsCalls = 0;
    const host = createFakePluginHost({
      pluginId: `finite-state-hardware-semantics-${Math.random()}`,
      sdk: {
        projects: { get: async () => project(root) },
        files: {
          listPaths: async () => {
            listPathsCalls += 1;
            return {
              paths: [{
                kind: "file" as const,
                path: "semantic.kicad_pro",
                name: "semantic.kicad_pro",
                score: 1,
                positions: [],
              }],
              truncated: false,
            };
          },
          read: async (input) => sdkFile(input.path),
        },
      },
    });
    hosts.push(host);
    const ctx = createPluginContext(host.bb);
    ctx.service("hardware.kicad-capability", async () => ({
      installed: false, cliPath: null, version: null, supported: false,
    }));
    registerHardware(host.bb, ctx);
    await host.harness.behavior.callRpc("hardwareDiscoveryRefresh", {
      projectId: "project", projectVersionId: null,
    });
    const service = host.harness.runService("hardware-discovery");
    await vi.waitFor(async () => expect(await host.harness.behavior.callRpc(
      "hardwareDiscoveryStatus",
      { projectId: "project", projectVersionId: null },
    )).toMatchObject({ state: "ready", message: null }));

    const scope = {
      projectId: "project", projectVersionId: null, projectKey: "semantic.kicad_pro",
    };
    await expect(host.harness.behavior.callRpc("hardwareSymbolsList", {
      ...scope, pageSize: 20, cursor: null,
    })).resolves.toMatchObject({
      total: 4,
      items: [{ reference: "R2" }, { reference: "R4" }, { reference: "R10" }, { reference: "U3" }],
    });
    const nets = await host.harness.behavior.callRpc("hardwareNetsList", {
      ...scope, pageSize: 20, cursor: null,
    });
    expect(nets).toMatchObject({ total: 5 });
    expect(Reflect.get(Object(nets), "items")).toEqual(expect.arrayContaining([
      expect.objectContaining({ netName: "OP_OUT" }),
    ]));
    const sheets = await host.harness.behavior.callRpc("hardwareSheetsList", {
      ...scope, pageSize: 20, cursor: null,
    });
    expect(sheets).toMatchObject({ total: 2 });
    expect(Reflect.get(Object(sheets), "items")).toEqual(expect.arrayContaining([
      expect.objectContaining({ sheetPath: "semantic.kicad_sch", symbolCount: 3 }),
    ]));
    await expect(host.harness.behavior.callRpc("hardwarePartGet", {
      ...scope, reference: "U3",
    })).resolves.toMatchObject({ reference: "U3", units: [{ unit: 1 }, { unit: 2 }] });
    const gaps = await host.harness.behavior.callRpc("hardwareConnectivityGapsList", scope);
    expect(gaps).toMatchObject({ sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/u) });
    expect(Reflect.get(Object(gaps), "gaps")).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "unresolved_label" }),
    ]));

    const rootHashBefore = ctx.db().prepare<[], { sch_hash: string }>(
      "SELECT sch_hash FROM hw_project WHERE project_key = 'semantic.kicad_pro'",
    ).get()?.sch_hash;
    const ingestHashBefore = ctx.db().prepare<[], { source_hash: string }>(
      "SELECT source_hash FROM hw_ingest ORDER BY ingested_at DESC, rowid DESC LIMIT 1",
    ).get()?.source_hash;
    const childPath = join(root, "sensor.kicad_sch");
    const childSource = await readFile(childPath, "utf8");
    await writeFile(childPath, childSource.replaceAll("R4", "R42"));

    const callsBeforeRefresh = listPathsCalls;
    await host.harness.behavior.callRpc("hardwareDiscoveryRefresh", {
      projectId: "project", projectVersionId: null,
    });
    await vi.waitFor(() => expect(listPathsCalls).toBeGreaterThan(callsBeforeRefresh));
    await vi.waitFor(async () => expect(await host.harness.behavior.callRpc(
      "hardwareDiscoveryStatus",
      { projectId: "project", projectVersionId: null },
    )).toMatchObject({ state: "ready", message: null }));

    await expect(host.harness.behavior.callRpc("hardwareSymbolsList", {
      ...scope, pageSize: 20, cursor: null,
    })).resolves.toMatchObject({
      total: 4,
      items: [{ reference: "R2" }, { reference: "R10" }, { reference: "R42" }, { reference: "U3" }],
    });
    expect(ctx.db().prepare<[], { sch_hash: string }>(
      "SELECT sch_hash FROM hw_project WHERE project_key = 'semantic.kicad_pro'",
    ).get()?.sch_hash).toBe(rootHashBefore);
    expect(ctx.db().prepare<[], { source_hash: string }>(
      "SELECT source_hash FROM hw_ingest ORDER BY ingested_at DESC, rowid DESC LIMIT 1",
    ).get()?.source_hash).not.toBe(ingestHashBefore);
    expect(ctx.db().prepare<[], { count: number }>(
      "SELECT COUNT(*) AS count FROM hw_ingest",
    ).get()?.count).toBe(2);
    service.controller.abort();
    await service.done;
  }, 30_000);

  it("refreshes explicitly, keeps read RPCs write-free, and reports the completed absent-CLI job", async () => {
    const root = await sourceFixture();
    const host = createFakePluginHost({
      pluginId: `finite-state-hardware-${Math.random()}`,
      sdk: {
        projects: { get: async () => project(root) },
        files: {
          listPaths: async (input) => {
            expect(input.path).toBe(root);
            return { paths: [
              { kind: "file" as const, path: "a/a.kicad_pro", name: "a.kicad_pro", score: 1, positions: [] },
              { kind: "file" as const, path: "b/b.kicad_pro", name: "b.kicad_pro", score: 1, positions: [] },
            ], truncated: false };
          },
          read: async (input) => {
            expect(input.rootPath).toBe(root);
            return sdkFile(input.path);
          },
        },
      },
    });
    hosts.push(host);
    const ctx = createPluginContext(host.bb);
    ctx.service("hardware.kicad-capability", async () => ({ installed: false, cliPath: null, version: null, supported: false }));
    registerHardware(host.bb, ctx);
    await vi.waitFor(() => expect(host.harness.logEntries).toContainEqual({
      level: "warn",
      message: expect.stringContaining("Hardware extraction advisory: KiCad 7+ is unavailable"),
    }));
    expect(host.harness.needsConfigurationMessages).toEqual([]);

    await expect(host.harness.behavior.callRpc("hardwareProjectsList", {
      projectId: "project", projectVersionId: null, pageSize: 1, cursor: null,
    })).resolves.toMatchObject({ items: [], total: 0, cursor: null });
    expect(host.harness.inspection.sdk.callsTo("files.listPaths")).toHaveLength(0);

    await host.harness.behavior.callRpc("hardwareDiscoveryRefresh", { projectId: "project", projectVersionId: null });
    const discoveryService = host.harness.runService("hardware-discovery");
    await vi.waitFor(async () => expect(await host.harness.behavior.callRpc("hardwareDiscoveryStatus", {
      projectId: "project", projectVersionId: null,
    })).toMatchObject({ state: "ready", worktreeincludeHint: expect.stringContaining(".worktreeinclude") }));
    const oldHash = ctx.db().prepare("SELECT sch_hash FROM hw_project WHERE project_key = 'b/b.kicad_pro'").pluck().get();
    await writeFile(join(root, "b", "b.kicad_sch"), `(kicad_sch (version 20231120) (generator_version "9.0.1"))\n`);
    await vi.waitFor(() => expect(
      ctx.db().prepare("SELECT sch_hash FROM hw_project WHERE project_key = 'b/b.kicad_pro'").pluck().get(),
    ).not.toBe(oldHash));
    await expect(access(join(root, ".fs-hw"))).rejects.toMatchObject({ code: "ENOENT" });
    discoveryService.controller.abort();
    await discoveryService.done;

    const first = await host.harness.behavior.callRpc("hardwareProjectsList", {
      projectId: "project", projectVersionId: null, pageSize: 1, cursor: null,
    });
    expect(first).toMatchObject({
      total: 2,
      items: [{ projectKey: "a/a.kicad_pro", supported: false }],
    });
    const firstCursor = Reflect.get(Object(first), "cursor");
    const second = await host.harness.behavior.callRpc("hardwareProjectsList", {
      projectId: "project", projectVersionId: null, pageSize: 1, cursor: firstCursor,
    });
    expect(second).toMatchObject({
      total: 2,
      cursor: null,
      items: [{ projectKey: "b/b.kicad_pro", supported: true }],
    });
    expect(host.harness.inspection.sdk.callsTo("files.listPaths")).toHaveLength(2);

    const before = ctx.db().prepare("SELECT discovered_at FROM hw_project WHERE project_key = 'b/b.kicad_pro'").pluck().get();
    const status = await host.harness.behavior.callRpc("hardwareArtifactsStatus", {
      projectId: "project", projectVersionId: null, projectKey: "b/b.kicad_pro",
    });
    expect(status).toMatchObject({ projectKey: "b/b.kicad_pro", capability: { installed: false }, artifacts: [] });
    expect(ctx.db().prepare("SELECT discovered_at FROM hw_project WHERE project_key = 'b/b.kicad_pro'").pluck().get()).toBe(before);
    expect(host.harness.inspection.sdk.callsTo("files.listPaths")).toHaveLength(2);

    const job = await host.harness.behavior.callRpc("hardwareExtractStart", {
      projectId: "project", projectVersionId: null, projectKey: "b/b.kicad_pro",
      kinds: ["bom", "board_svg"], force: false,
    });
    const jobId = Reflect.get(Object(job), "jobId");
    const extractionService = host.harness.runService("hardware-extraction");
    await vi.waitFor(async () => expect(await host.harness.behavior.callRpc("hardwareExtractStatus", {
      projectId: "project", projectVersionId: null, jobId,
    })).toMatchObject({
      state: "completed",
      produced: [],
      failures: [
        { kind: "bom", message: expect.stringContaining("KICAD_NOT_INSTALLED") },
        { kind: "board_svg", message: expect.stringContaining("KICAD_NOT_INSTALLED") },
      ],
    }));
    extractionService.controller.abort();
    await extractionService.done;
    await expect(host.harness.behavior.callRpc("hardwareExtractStatus", {
      projectId: "another-project", projectVersionId: null, jobId,
    })).rejects.toThrow(/HW_EXTRACT_JOB_NOT_FOUND/u);
    expect(host.harness.registrations.agentTools).toHaveLength(0);
    expect(host.harness.registrations.cli).toBeNull();
  });

  it("reports a truthful degraded discovery status when no project source exists", async () => {
    const host = createFakePluginHost({
      pluginId: `finite-state-hardware-empty-${Math.random()}`,
      sdk: { projects: { get: async () => project("/unused", false) } },
    });
    hosts.push(host);
    const ctx = createPluginContext(host.bb);
    ctx.service("hardware.kicad-capability", async () => ({ installed: false, cliPath: null, version: null, supported: false }));
    registerHardware(host.bb, ctx);
    await host.harness.behavior.callRpc("hardwareDiscoveryRefresh", { projectId: "project", projectVersionId: null });
    const service = host.harness.runService("hardware-discovery");
    await vi.waitFor(async () => expect(await host.harness.behavior.callRpc("hardwareDiscoveryStatus", {
      projectId: "project", projectVersionId: null,
    })).toMatchObject({ state: "degraded", message: expect.stringContaining("HW_PROJECT_SOURCE_UNAVAILABLE") }));
    service.controller.abort();
    await service.done;
    expect(host.harness.needsConfigurationMessages).toEqual([]);
    expect(host.harness.logEntries).toContainEqual({
      level: "warn",
      message: expect.stringContaining("Hardware discovery advisory: this project has no workspace source"),
    });
  });

  it("keeps partial-success jobs readable when KiCad emits oversized credential-shaped stderr", async () => {
    const root = await sourceFixture();
    const fakeCli = join(root, "fake-kicad-cli");
    await writeFile(fakeCli, `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const output = args[args.indexOf("--output") + 1];
if (args.includes("bom")) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, "bom");
  process.exit(0);
}
process.stderr.write("?token=super-secret\\n" + "diagnostic\\n".repeat(100) + "FINAL_KICAD_ERROR");
process.exit(9);
`);
    await chmod(fakeCli, 0o755);
    const host = createFakePluginHost({
      pluginId: `finite-state-hardware-long-error-${Math.random()}`,
      sdk: {
        projects: { get: async () => project(root) },
        files: {
          listPaths: async () => ({
            paths: [{ kind: "file" as const, path: "b/b.kicad_pro", name: "b.kicad_pro", score: 1, positions: [] }],
            truncated: false,
          }),
          read: async (input) => sdkFile(input.path),
        },
      },
    });
    hosts.push(host);
    const ctx = createPluginContext(host.bb);
    ctx.service("hardware.kicad-capability", async () => ({ installed: true, cliPath: fakeCli, version: "9.0.1", supported: true }));
    registerHardware(host.bb, ctx);
    const queued = await host.harness.behavior.callRpc("hardwareExtractStart", {
      projectId: "project", projectVersionId: null, projectKey: "b/b.kicad_pro",
      kinds: ["bom", "netlist"], force: false,
    });
    const jobId = Reflect.get(Object(queued), "jobId");
    const service = host.harness.runService("hardware-extraction");
    let completed: unknown;
    await vi.waitFor(async () => {
      completed = await host.harness.behavior.callRpc("hardwareExtractStatus", {
        projectId: "project", projectVersionId: null, jobId,
      });
      expect(completed).toMatchObject({ state: "completed", produced: [{ kind: "bom" }] });
    });
    service.controller.abort();
    await service.done;
    const failure = Reflect.get(Object(completed), "failures")[0] as { message: string };
    expect(failure.message).toHaveLength(500);
    expect(failure.message).toContain("FINAL_KICAD_ERROR");
    expect(failure.message).not.toMatch(/super-secret|token=/u);
  });

  it("clips the diagnostic tail and scrubs credentials before frozen output validation", () => {
    const tail = "final KiCad error";
    const detail = safeHardwareDetail(
      `${"prefix\n".repeat(100)}https://user:secret@example.test/path?token=secret\n` +
      "Authorization: Bearer super-secret-header\n" + tail,
    );
    expect(detail).toHaveLength(500);
    expect(detail).toContain(tail);
    expect(detail).toContain("diagnostic truncated; tail shown");
    expect(detail).toContain("[credential redacted]");
    expect(detail).not.toMatch(/secret|token=|authorization|bearer/iu);
  });
});
