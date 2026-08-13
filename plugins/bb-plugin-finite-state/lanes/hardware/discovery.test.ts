import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverProjects, readKicadVersion, resolveInsideRoot } from "./discovery.js";

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
});
