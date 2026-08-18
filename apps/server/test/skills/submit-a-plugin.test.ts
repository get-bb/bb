import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { derivePluginId } from "@bb/domain";

const skillRoot = fileURLToPath(
  new URL(
    "../../src/services/skills/builtin-skills/submit-a-plugin/",
    import.meta.url,
  ),
);
const skillPath = path.join(skillRoot, "SKILL.md");
const deriveIdScriptPath = path.join(
  skillRoot,
  "scripts",
  "derive-plugin-id.mjs",
);
const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "bb-submit-plugin-"));
  tempDirs.push(directory);
  return directory;
}

async function deriveWithSkill(packageName: string): Promise<string> {
  const directory = await makeTempDir();
  const manifestPath = path.join(directory, "package.json");
  await writeFile(manifestPath, JSON.stringify({ name: packageName }), "utf8");
  return execFileSync(process.execPath, [deriveIdScriptPath, manifestPath], {
    encoding: "utf8",
  }).trim();
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("submit-a-plugin skill", () => {
  it("derives dotted and underscored package ids with the product algorithm", async () => {
    for (const packageName of [
      "@acme/bb-plugin-release.notes",
      "@acme/bb-plugin-release_notes",
      "bb_plugin_notes",
    ]) {
      await expect(deriveWithSkill(packageName)).resolves.toBe(
        derivePluginId(packageName),
      );
    }
  });

  it("does not execute package metadata while it derives an id", async () => {
    const directory = await makeTempDir();
    const markerPath = path.join(directory, "metadata-executed");
    const manifestPath = path.join(directory, "package.json");
    await writeFile(
      manifestPath,
      JSON.stringify({ name: "bb-plugin-notes$(touch metadata-executed)" }),
      "utf8",
    );

    expect(
      execFileSync(process.execPath, [deriveIdScriptPath, manifestPath], {
        cwd: directory,
        encoding: "utf8",
      }).trim(),
    ).toBe(derivePluginId("bb-plugin-notes$(touch metadata-executed)"));
    expect(existsSync(markerPath)).toBe(false);
  });

  it("keeps release commands behind approval and disables npm lifecycle scripts", async () => {
    const skill = await readFile(skillPath, "utf8");

    expect(skill).toContain(
      "A request to submit a plugin does not approve an npm publication or a Git push.",
    );
    expect(skill).toContain("npm ci --ignore-scripts");
    expect(skill).toContain("npm pack --dry-run --ignore-scripts");
    expect(skill).toContain("npm publish --ignore-scripts");
    expect(skill).not.toContain("PLUGIN_DISPLAY_NAME");
  });

  it("provides a local submission path without gh", async () => {
    const skill = await readFile(skillPath, "utf8");

    expect(skill).toContain("## Continue without gh");
    expect(skill).toContain(
      "git clone https://github.com/get-bb/marketplace.git /SAFE/NEW/PATH/marketplace",
    );
    expect(skill).toContain(
      "Return the local clone path, entry path, icon path, branch name, and validation results.",
    );
  });
});
