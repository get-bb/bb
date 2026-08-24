import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const PLUGIN_ROOT = join(
  import.meta.dirname,
  "../../../plugins/plugin-api-docs",
);

describe("Plugin Guide maintenance skill", () => {
  it("ships from the plugin manifest with the API-sync workflow", () => {
    const manifest = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, "package.json"), "utf8"),
    );
    const skill = readFileSync(
      join(PLUGIN_ROOT, "skills/plugin-guide-maintenance/SKILL.md"),
      "utf8",
    );

    expect(manifest.bb.skills).toContain("skills");
    expect(skill).toContain("name: plugin-guide-maintenance");
    expect(skill).toContain("packages/plugin-api-map/src/surfaces.ts");
    expect(skill).toContain("docs/api_to_audit.md");
    expect(skill).toContain("update:sdk-inventory");
    expect(skill).toContain("Copy for agent");
  });
});
