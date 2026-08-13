import { execFileSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginContext } from "../../../lib/context.js";
import {
  artifactIsFresh,
  artifactRelativePath,
  assertHardwareCacheIgnored,
  projectCacheKey,
  runExtractCached,
  validateHardwareSourceRoot,
} from "./cache.js";
import { detectKicadCli, type DriverCommand } from "./driver.js";
import { listArtifactStatus } from "./provenance.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose())));

async function fixture(ignored = true) {
  const root = await mkdtemp(join(tmpdir(), "fs-hw-cache-"));
  execFileSync("git", ["init", "--quiet", root]);
  if (ignored) await writeFile(join(root, ".gitignore"), ".fs-hw/\n");
  await writeFile(join(root, "board.kicad_pro"), "{}\n");
  await writeFile(join(root, "board.kicad_sch"), `(kicad_sch (version 20231120) (generator_version \"8.0.4\"))\n`);
  await writeFile(join(root, "board.kicad_pcb"), `(kicad_pcb (version 20231120))\n`);
  const host = createFakePluginHost({ pluginId: `hw-cache-${Math.random()}` });
  hosts.push(host);
  const db = createPluginContext(host.bb).db();
  db.prepare(
    `INSERT INTO hw_project (project_id, project_version_id, project_key, name, sch_path, pcb_path, sch_hash, pcb_hash, discovered_at)
     VALUES ('project', '@project', 'board.kicad_pro', 'board', 'board.kicad_sch', 'board.kicad_pcb', 'old-sch', 'old-pcb', '2026-01-01T00:00:00.000Z')`,
  ).run();
  return { root, db, scope: { projectId: "project", projectVersionId: "@project", projectKey: "board.kicad_pro" } };
}

const capability = { installed: true, cliPath: "/bin/kicad-cli", version: "8.0.4", supported: true } as const;
const liveCapability = await detectKicadCli();

async function materialize(command: DriverCommand) {
  const output = command.args[command.args.indexOf("--output") + 1]!;
  if (command.args.includes("gerbers") || command.args.includes("drill")) {
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "artifact.out"), "artifact");
  } else if (command.args[0] === "sch" && command.args.includes("svg")) {
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "root.svg"), "<svg/>");
  } else {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, "artifact");
  }
  return { exitCode: 0, stderr: "" };
}

describe("hardware artifact cache", () => {
  it("uses a stable project-key hash and implements the freshness truth table", () => {
    expect(projectCacheKey("board.kicad_pro")).toMatch(/^[a-f0-9]{64}$/u);
    expect(artifactRelativePath("board.kicad_pro", "sheet_svg")).toContain("/sheets");
    expect(artifactIsFresh("same", "same")).toBe(true);
    expect(artifactIsFresh("old", "new")).toBe(false);
    expect(artifactIsFresh("same", "same", true)).toBe(false);
  });

  it("skips fresh artifacts, reruns changed/forced artifacts, and preserves prior rows on partial failure", async () => {
    const { root, db, scope } = await fixture();
    const execute = vi.fn(materialize);
    const first = await runExtractCached(root, scope.projectKey, ["bom"], { db, scope, capability, execute });
    expect(first.failures).toEqual([]);
    expect(execute).toHaveBeenCalledOnce();
    await runExtractCached(root, scope.projectKey, ["bom"], { db, scope, capability, execute });
    expect(execute).toHaveBeenCalledOnce();
    await runExtractCached(root, scope.projectKey, ["bom"], { db, scope, capability, execute }, { force: true });
    expect(execute).toHaveBeenCalledTimes(2);

    const failBom = vi.fn(async (command: DriverCommand) => command.args.includes("bom")
      ? { exitCode: 9, stderr: "BOM failed verbatim\n" }
      : materialize(command));
    const partial = await runExtractCached(root, scope.projectKey, ["bom", "netlist"], { db, scope, capability, execute: failBom }, { force: true });
    expect(partial.failures).toEqual([{ kind: "bom", exitCode: 9, stderr: "BOM failed verbatim\n" }]);
    expect(partial.produced.map((item) => item.kind)).toEqual(["netlist"]);
    expect(db.prepare("SELECT source_hash FROM hw_artifact WHERE kind = 'bom'").get()).toBeTruthy();
  });

  it("aborts an unignored cache before creating any path or invoking KiCad", async () => {
    const { root, db, scope } = await fixture(false);
    const execute = vi.fn(materialize);
    await expect(runExtractCached(root, scope.projectKey, ["bom"], { db, scope, capability, execute })).rejects.toMatchObject({ code: "HW_CACHE_NOT_IGNORED" });
    expect(execute).not.toHaveBeenCalled();
    await expect(access(join(root, ".fs-hw"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns typed failures when kicad-cli is absent", async () => {
    const { root, db, scope } = await fixture();
    const result = await runExtractCached(root, scope.projectKey, ["bom", "board_svg"], {
      db, scope, capability: { installed: false, cliPath: null, version: null, supported: false },
    });
    expect(result.failures).toEqual([
      { kind: "bom", exitCode: -1, stderr: "KICAD_NOT_INSTALLED: kicad-cli was not found" },
      { kind: "board_svg", exitCode: -1, stderr: "KICAD_NOT_INSTALLED: kicad-cli was not found" },
    ]);
  });

  it("skips board artifacts when the project has no board and still exports schematic kinds", async () => {
    const { root, db, scope } = await fixture();
    await unlink(join(root, "board.kicad_pcb"));
    const execute = vi.fn(materialize);
    const result = await runExtractCached(root, scope.projectKey, ["board_svg", "bom"], {
      db, scope, capability, execute,
    });
    expect(result.failures).toEqual([]);
    expect(result.produced.map((artifact) => artifact.kind)).toEqual(["bom"]);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("regenerates deleted artifacts and refuses exit-zero provenance without output", async () => {
    const { root, db, scope } = await fixture();
    const execute = vi.fn(materialize);
    await runExtractCached(root, scope.projectKey, ["bom"], { db, scope, capability, execute });
    await rm(join(root, ".fs-hw"), { recursive: true, force: true });
    const recordedHash = db.prepare("SELECT source_hash FROM hw_artifact WHERE kind = 'bom'").pluck().get() as string;
    await expect(listArtifactStatus(db, scope, { schematic: recordedHash, board: null }, root)).resolves.toMatchObject([
      { kind: "bom", fresh: false },
    ]);
    await runExtractCached(root, scope.projectKey, ["bom"], { db, scope, capability, execute });
    expect(execute).toHaveBeenCalledTimes(2);

    const missingOutput = await runExtractCached(root, scope.projectKey, ["netlist"], {
      db, scope, capability, execute: async () => ({ exitCode: 0, stderr: "" }),
    });
    expect(missingOutput.failures[0]?.stderr).toContain("KICAD_OUTPUT_MISSING");
    expect(db.prepare("SELECT COUNT(*) FROM hw_artifact WHERE kind = 'netlist'").pluck().get()).toBe(0);
  });

  it("records one sheet SVG row per emitted file", async () => {
    const { root, db, scope } = await fixture();
    const execute = async (command: DriverCommand) => {
      const output = command.args[command.args.indexOf("--output") + 1]!;
      await mkdir(join(output, "power"), { recursive: true });
      await writeFile(join(output, "root.svg"), "<svg/>");
      await writeFile(join(output, "power", "regulator.svg"), "<svg/>");
      return { exitCode: 0, stderr: "" };
    };
    const result = await runExtractCached(root, scope.projectKey, ["sheet_svg"], { db, scope, capability, execute });
    expect(result.produced.map((artifact) => artifact.sheetPath)).toEqual(["power/regulator.svg", "root.svg"]);
    expect(db.prepare("SELECT sheet_path FROM hw_artifact WHERE kind = 'sheet_svg' ORDER BY sheet_path").pluck().all()).toEqual([
      "power/regulator.svg", "root.svg",
    ]);
  });

  it("isolates a provenance write failure to its artifact kind", async () => {
    const { root, db, scope } = await fixture();
    const result = await runExtractCached(root, scope.projectKey, ["bom"], {
      db,
      scope: { ...scope, projectKey: "missing.kicad_pro" },
      capability,
      execute: materialize,
    });
    expect(result.produced).toEqual([]);
    expect(result.failures).toMatchObject([{ kind: "bom", stderr: expect.stringContaining("HW_PROVENANCE_WRITE_FAILED") }]);
  });

  it("accepts a nested project source and types the non-Git degradation", async () => {
    const repo = await mkdtemp(join(tmpdir(), "fs-hw-monorepo-"));
    execFileSync("git", ["init", "--quiet", repo]);
    await writeFile(join(repo, ".gitignore"), "hardware/.fs-hw/\n");
    const source = join(repo, "hardware");
    await mkdir(source);
    await writeFile(join(source, "board.kicad_pro"), "{}\n");
    await writeFile(join(source, "board.kicad_sch"), `(kicad_sch (version 20231120) (generator_version "8.0.4"))\n`);
    await expect(validateHardwareSourceRoot(source)).resolves.toMatchObject({
      sourceRoot: await realpath(source), gitRoot: await realpath(repo),
    });
    await expect(assertHardwareCacheIgnored(source)).resolves.toBe(await realpath(source));

    const plain = await mkdtemp(join(tmpdir(), "fs-hw-nongit-"));
    await expect(validateHardwareSourceRoot(plain)).rejects.toMatchObject({ code: "HW_SOURCE_NOT_GIT_REPOSITORY" });
  });

  it.skipIf(!liveCapability.supported)("live-exports the unchanged fixture when kicad-cli is available", async () => {
    const root = await mkdtemp(join(tmpdir(), "fs-hw-live-"));
    execFileSync("git", ["init", "--quiet", root]);
    await writeFile(join(root, ".gitignore"), ".fs-hw/\n");
    const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../test/fixtures/kicad/custom-fields");
    for (const extension of ["pro", "sch", "pcb"]) {
      await cp(join(fixtureRoot, `custom_fields.kicad_${extension}`), join(root, `custom_fields.kicad_${extension}`));
    }
    const host = createFakePluginHost({ pluginId: `hw-live-${Math.random()}` });
    hosts.push(host);
    const db = createPluginContext(host.bb).db();
    db.prepare(
      `INSERT INTO hw_project (project_id, project_version_id, project_key, name, sch_path, pcb_path, sch_hash, pcb_hash, discovered_at)
       VALUES ('project', '@project', 'custom_fields.kicad_pro', 'custom_fields', 'custom_fields.kicad_sch', 'custom_fields.kicad_pcb', 'pending', 'pending', '2026-01-01T00:00:00.000Z')`,
    ).run();
    const result = await runExtractCached(root, "custom_fields.kicad_pro", ["sheet_svg", "board_svg", "bom", "netlist"], {
      db,
      scope: { projectId: "project", projectVersionId: "@project", projectKey: "custom_fields.kicad_pro" },
      capability: liveCapability,
    });
    expect(result.failures).toEqual([]);
    expect(result.produced.length).toBeGreaterThanOrEqual(4);
    expect(result.produced.every((artifact) => artifact.cliVersion === liveCapability.version)).toBe(true);
  });
});
