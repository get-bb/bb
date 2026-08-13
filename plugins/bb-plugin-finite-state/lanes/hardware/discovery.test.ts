import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import {
  discoverProjects,
  discoverProjectsFromSource,
  readKicadVersion,
  resolveInsideRoot,
  scanProjectsFromSource,
} from "./discovery.js";

async function addProject(root: string, directory: string, name: string, version: string, pcb = true) {
  const projectRoot = join(root, directory);
  await mkdir(projectRoot, { recursive: true });
  await writeFile(join(projectRoot, `${name}.kicad_pro`), "{}\n");
  const schematic = `(kicad_sch (version 20231120) (generator eeschema) (generator_version \"${version}\"))\n`;
  await writeFile(join(projectRoot, `${name}.kicad_sch`), schematic);
  if (pcb) await writeFile(join(projectRoot, `${name}.kicad_pcb`), `(kicad_pcb (version 20231120))\n`);
  return schematic;
}

describe("KiCad project discovery", () => {
  it("discovers the originally-authored KiCad 9 custom-fields fixture", async () => {
    const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../test/fixtures/kicad/custom-fields");
    await expect(discoverProjects(fixtureRoot)).resolves.toMatchObject([
      {
        projectKey: "custom_fields.kicad_pro",
        schPath: "custom_fields.kicad_sch",
        pcbPath: "custom_fields.kicad_pcb",
        kicadVersion: "9.0",
        supported: true,
      },
    ]);
  });

  it("discovers zero, one, and two project roots with stable content hashes", async () => {
    const root = await mkdtemp(join(tmpdir(), "fs-hw-discovery-"));
    expect(await discoverProjects(root)).toEqual([]);
    const firstText = await addProject(root, "alpha", "alpha", "8.0.4");
    let projects = await discoverProjects(root);
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      projectKey: "alpha/alpha.kicad_pro",
      schPath: "alpha/alpha.kicad_sch",
      pcbPath: "alpha/alpha.kicad_pcb",
      schSha256: createHash("sha256").update(firstText).digest("hex"),
      kicadVersion: "8.0.4",
      supported: true,
    });
    const firstHash = projects[0]?.schSha256;
    await addProject(root, "beta", "beta", "5.1.12", false);
    projects = await discoverProjects(root);
    expect(projects.map((project) => project.projectKey)).toEqual([
      "alpha/alpha.kicad_pro", "beta/beta.kicad_pro",
    ]);
    expect(projects[0]?.schSha256).toBe(firstHash);
    expect(projects[1]).toMatchObject({ pcbPath: null, supported: false, kicadVersion: "5.1.12" });
  });

  it("gates legacy formats and rejects root escapes", () => {
    expect(readKicadVersion("(kicad_sch (version 20231120))")).toEqual({ version: "20231120", supported: true });
    expect(readKicadVersion("(legacy (version 20171130))")).toEqual({ version: "20171130", supported: false });
    expect(() => resolveInsideRoot("/workspace", "../outside.kicad_pro")).toThrow("HW_PROJECT_PATH_INVALID");
  });

  it("discovers through the production SDK boundary with rootPath confinement", async () => {
    const schematic = `(kicad_sch (version 20231120) (generator_version "8.0.4"))\n`;
    const host = createFakePluginHost({
      sdk: {
        files: {
          listPaths: async () => ({
            paths: [{ kind: "file" as const, path: "boards/main.kicad_pro", name: "main.kicad_pro", score: 1, positions: [] }],
            truncated: false,
          }),
          read: async (input) => {
            expect(input.rootPath).toBe("/verified/source");
            if (input.path.endsWith("main.kicad_sch")) {
              return { content: schematic, contentEncoding: "utf8" as const, sha256: createHash("sha256").update(schematic).digest("hex"), sizeBytes: schematic.length };
            }
            throw new Error("ENOENT");
          },
        },
      },
    });
    const source = { hostId: "host", path: "/verified/source" };
    await expect(discoverProjectsFromSource(host.bb, source)).resolves.toMatchObject([
      { projectKey: "boards/main.kicad_pro", pcbPath: null, supported: true },
    ]);
    expect(host.harness.inspection.sdk.callsTo("files.read")).toHaveLength(2);
    await host.harness.lifecycle.dispose();
  });

  it("returns a truthful partial scan when the SDK path cap is reached", async () => {
    const schematic = `(kicad_sch (version 20231120))\n`;
    const host = createFakePluginHost({
      sdk: { files: {
        listPaths: async () => ({
          paths: [{ kind: "file" as const, path: "main.kicad_pro", name: "main.kicad_pro", score: 1, positions: [] }],
          truncated: true,
        }),
        read: async (input) => input.path.endsWith(".kicad_sch")
          ? { content: schematic, contentEncoding: "utf8" as const, sha256: createHash("sha256").update(schematic).digest("hex"), sizeBytes: schematic.length }
          : Promise.reject(new Error("ENOENT")),
      } },
    });
    await expect(scanProjectsFromSource(host.bb, { hostId: "host", path: "/source" })).resolves.toMatchObject({
      truncated: true,
      projects: [{ projectKey: "main.kicad_pro" }],
    });
    await host.harness.lifecycle.dispose();
  });
});
