import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
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
const skillReferencePaths = [
  "marketplace-entry.md",
  "plugin-release.md",
  "pull-request.md",
].map((name) => path.join(skillRoot, "references", name));
const marketplaceEntryReferencePath = path.join(
  skillRoot,
  "references",
  "marketplace-entry.md",
);
const publishedMarketplaceSchemaPath = fileURLToPath(
  new URL(
    "../../../web/public/schemas/marketplace-v2.schema.json",
    import.meta.url,
  ),
);
const publishedSchemaSchema = z.record(z.string(), z.unknown());
const tempDirs: string[] = [];

async function readSkillTree(): Promise<string> {
  return (
    await Promise.all(
      [skillPath, ...skillReferencePaths].map((file) => readFile(file, "utf8")),
    )
  ).join("\n");
}

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
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
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
    const skill = await readSkillTree();

    expect(skill).toContain("A submission request does not approve a release.");
    expect(skill).toContain("npm ci --ignore-scripts");
    expect(skill).toContain("npm pack --dry-run --ignore-scripts");
    expect(skill).toContain("npm publish --ignore-scripts");
    expect(skill).not.toContain("PLUGIN_DISPLAY_NAME");
  });

  it("keeps the worked entry valid under the published marketplace schema", async () => {
    const markdown = await readFile(marketplaceEntryReferencePath, "utf8");
    const entries = [...markdown.matchAll(/```json\n([\s\S]*?)```/gu)]
      .map((match) => match[1])
      .filter((block) => block.includes('"id":'))
      .map((block): unknown => JSON.parse(block));
    expect(entries).toHaveLength(1);

    const validate = new Ajv2020({
      allErrors: true,
      strict: false,
      validateFormats: false,
    }).compile(
      publishedSchemaSchema.parse(
        JSON.parse(await readFile(publishedMarketplaceSchemaPath, "utf8")),
      ),
    );
    validate({
      schemaVersion: 2,
      name: "bb-community",
      displayName: "BB Community",
      plugins: entries,
    });

    expect(validate.errors ?? []).toEqual([]);
  });

  it("provides a local submission path without gh", async () => {
    const skill = await readSkillTree();

    expect(skill).toContain("If gh is unavailable or authentication fails");
    expect(skill).toContain(
      "git clone https://github.com/get-bb/marketplace.git /SAFE/NEW/PATH/marketplace",
    );
    expect(skill).toMatch(
      /Return their paths, the clone path,\s+branch name, and results\./,
    );
  });
});
