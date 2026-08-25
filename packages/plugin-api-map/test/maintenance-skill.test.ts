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
    expect(skill).toContain("scaffold:surface-entry");
    expect(skill).toContain("surface fixture");
    expect(skill).toContain("anatomy-manifest.json");
    expect(skill).toContain("`none`");
    expect(skill).toContain("`anchor`");
    expect(skill).toContain("`state`");
    expect(skill).toContain("`flow`");
    expect(skill).toContain("### Annotation quality contract");
    expect(skill).toContain("clipping ancestor");
    expect(skill).toContain("must not change the host surface's geometry");
    expect(skill).toMatch(/outside the clipping\s+subtree/);
    expect(skill).toContain("row alignment");
    expect(skill).toContain("actual entry point");
    expect(skill).toContain("transient menu");
    expect(skill).toContain("sequential by annotation number");
    expect(skill).toContain("separate interaction targets");
    expect(skill).toContain("bounding rectangles");
    expect(skill).toContain("docs/api_to_audit.md");
    expect(skill).toContain("update:sdk-inventory");
    expect(skill).toContain("Copy for agent");
    expect(skill).toContain("scripts/bb-dev-app current");
    expect(skill).not.toContain("launch the exact bb desktop dev build");
  });

  it("codifies the fixture conventions established across every Guide page", () => {
    const skill = readFileSync(
      join(PLUGIN_ROOT, "skills/plugin-guide-maintenance/SKILL.md"),
      "utf8",
    );
    const normalized = skill.replace(/\s+/g, " ");

    expect(normalized).toContain("### Surface-fixture composition contract");
    expect(normalized).toContain("canonical product object");
    expect(normalized).toContain("file path, file icon, and filename");
    expect(normalized).toContain("hunk header, line numbers");
    expect(normalized).toContain(
      "Loaded content and its loading skeleton must use aligned height and vertical spacing",
    );
    expect(normalized).not.toContain("Scale as one unit");
    expect(normalized).toContain("installed plugin customizations");
    expect(normalized).toContain("visible host scope");
    expect(normalized).toContain("host-owned wrapper or header");
    expect(normalized).toContain("Derive fidelity; do not choose it");
    expect(normalized).toContain("no meaningful spatial owner");
    expect(normalized).toContain(
      "Every spatial fixture scrolls as one annotated unit",
    );
    expect(normalized).toContain(
      "The non-spatial capability grid is the only reflowing fixture",
    );
    expect(normalized).toContain("Do not scale a surface fixture");

    expect(normalized).toContain("### Annotation placement decision table");
    expect(normalized).toContain("Never nest interactive annotation anchors");
    expect(normalized).toContain("one active annotation outline");
    expect(normalized).toContain("elementFromPoint");

    expect(normalized).toContain("### Interaction and state contract");
    expect(normalized).toContain("Reserve its footprint");
    expect(normalized).toContain("source placement direction");
    expect(normalized).toContain("visually distinct selection");

    expect(normalized).toContain("### Page, card, and reference contract");
    expect(normalized).toContain("different owning host surface");
    expect(normalized).toContain("normal flow below the fixture");
    expect(normalized).toContain("both page-panning arrows");
    expect(normalized).toContain(". With this, a plugin can:");
    expect(normalized).toContain("multiple references distinct and composable");
    expect(normalized).toContain("provider is exactly `surface`");
    expect(normalized).toContain("item id is exactly `surface:<surface.id>`");
    expect(normalized).toContain("byte-identical clipboard and context output");
  });
});
