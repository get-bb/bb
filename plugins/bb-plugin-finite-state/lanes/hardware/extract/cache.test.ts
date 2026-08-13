import { execFileSync } from "node:child_process";
import { access, mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginContext } from "../../../lib/context.js";
import {
  artifactIsFresh,
  artifactRelativePath,
  projectCacheKey,
  runExtractCached,
} from "./cache.js";

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
    const execute = vi.fn(async () => ({ exitCode: 0, stderr: "" }));
    const first = await runExtractCached(root, scope.projectKey, ["bom"], { db, scope, capability, execute });
    expect(first.failures).toEqual([]);
    expect(execute).toHaveBeenCalledOnce();
    await runExtractCached(root, scope.projectKey, ["bom"], { db, scope, capability, execute });
    expect(execute).toHaveBeenCalledOnce();
    await runExtractCached(root, scope.projectKey, ["bom"], { db, scope, capability, execute }, { force: true });
    expect(execute).toHaveBeenCalledTimes(2);

    const failBom = vi.fn(async (command: { args: string[] }) => ({
      exitCode: command.args.includes("bom") ? 9 : 0,
      stderr: command.args.includes("bom") ? "BOM failed verbatim\n" : "",
    }));
    const partial = await runExtractCached(root, scope.projectKey, ["bom", "netlist"], { db, scope, capability, execute: failBom }, { force: true });
    expect(partial.failures).toEqual([{ kind: "bom", exitCode: 9, stderr: "BOM failed verbatim\n" }]);
    expect(partial.produced.map((item) => item.kind)).toEqual(["netlist"]);
    expect(db.prepare("SELECT source_hash FROM hw_artifact WHERE kind = 'bom'").get()).toBeTruthy();
  });

  it("aborts an unignored cache before creating any path or invoking KiCad", async () => {
    const { root, db, scope } = await fixture(false);
    const execute = vi.fn(async () => ({ exitCode: 0, stderr: "" }));
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
    const execute = vi.fn(async () => ({ exitCode: 0, stderr: "" }));
    const result = await runExtractCached(root, scope.projectKey, ["board_svg", "bom"], {
      db, scope, capability, execute,
    });
    expect(result.failures).toEqual([]);
    expect(result.produced.map((artifact) => artifact.kind)).toEqual(["bom"]);
    expect(execute).toHaveBeenCalledOnce();
  });
});
