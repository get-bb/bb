import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPluginManifest } from "../../../src/services/plugins/manifest.js";
import { resolveInjectedSkillSources } from "../../../src/services/skills/injected-skills.js";
import { testLogger } from "../../helpers/test-app.js";

describe("secrets plugin skill injection", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "bb-secrets-skill-test-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("surfaces the real bundled secrets skill from the plugin manifest", async () => {
    const pluginRoot = fileURLToPath(
      new URL("../../../../../plugins/secrets", import.meta.url),
    );
    const manifest = await readPluginManifest(pluginRoot);
    const sources = resolveInjectedSkillSources(testLogger, {
      builtinSkillsRootPath: join(workDir, "builtins"),
      dataDir: join(workDir, "data"),
      pluginSkillsRootPaths: manifest.skillsRootPaths,
    });

    expect(sources).toContainEqual(
      expect.objectContaining({
        name: "secrets",
        sourceType: "data-dir",
        sourceRootPath: join(pluginRoot, "skills", "secrets"),
        skillFilePath: join(pluginRoot, "skills", "secrets", "SKILL.md"),
      }),
    );
  });
});
