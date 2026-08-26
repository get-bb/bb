import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = join(import.meta.dirname, "../../..");
const PLUGIN_ROOT = join(REPOSITORY_ROOT, "plugins/plugin-api-docs");
const MAINTENANCE_SKILL_ROOT = join(
  REPOSITORY_ROOT,
  ".bb/skills/plugin-guide-maintenance",
);
const PROVIDER_NATIVE_SKILL_ROOT = join(
  REPOSITORY_ROOT,
  ".agents/skills/plugin-guide-maintenance",
);
const LEGACY_PLUGIN_SKILL_ROOT = join(
  import.meta.dirname,
  "../../../plugins/plugin-api-docs/skills/plugin-guide-maintenance",
);

describe("Plugin Guide maintenance skill", () => {
  it("is a repository maintainer skill that the plugin does not ship", () => {
    const manifest = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, "package.json"), "utf8"),
    );
    const skill = readFileSync(
      join(MAINTENANCE_SKILL_ROOT, "SKILL.md"),
      "utf8",
    );

    expect(manifest.bb.skills).toEqual([]);
    expect(existsSync(PROVIDER_NATIVE_SKILL_ROOT)).toBe(false);
    expect(existsSync(LEGACY_PLUGIN_SKILL_ROOT)).toBe(false);
    expect(
      existsSync(
        join(MAINTENANCE_SKILL_ROOT, "scripts/verify-guide-chrome.mjs"),
      ),
    ).toBe(true);
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
      join(MAINTENANCE_SKILL_ROOT, "SKILL.md"),
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
    expect(normalized).toContain("scales as one annotated composition");
    expect(normalized).toContain("installed plugin customizations");
    expect(normalized).toContain("visible host scope");
    expect(normalized).toContain("host-owned wrapper or header");
    expect(normalized).toContain("Derive fidelity; do not choose it");
    expect(normalized).toContain("no meaningful spatial owner");
    // The geometry rules are derivation contracts, not authored constants.
    expect(normalized).toContain(
      "min(MAX_FIXTURE_SCALE, availW / authoredW, availH / authoredH)",
    );
    expect(normalized).toContain(
      "page selector is the sole narrow-width horizontal scroll owner",
    );
    expect(normalized).toContain("carets hug the label strip");
    expect(normalized).toContain(
      "Off-stage carousel pages must not contribute inline overflow",
    );
    expect(skill).toContain("980px-tall plugin content region");
    expect(normalized).toContain("no `100dvh` arithmetic");
    expect(normalized).toContain(
      "blank canvas bounds are minimums, not fixed heights",
    );
    expect(normalized).toContain(
      "The non-spatial capability grid is the only reflowing fixture",
    );
    expect(normalized).toContain("clamp(8px, 3cqh, 28px)");
    expect(normalized).toContain("`FIXTURE_WIDTH_BANDS` table");
    expect(normalized).toContain("only while a card is open");
    expect(normalized).toContain("one center-outward gesture");
    expect(normalized).toContain(
      "stay legible while the fixture shrinks under them",
    );
    expect(normalized).toContain("chip's effective footprint");
    expect(normalized).toContain("rides the frame edge");
    expect(normalized).toContain("shared chip-bar treatment from `scroll-edges.ts`");
    expect(normalized).toContain("`FOCUS_RING_CLASS` owner");
    expect(normalized).toContain(
      "Page tabs are one horizontally scrolling, non-wrapping row",
    );

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
    expect(normalized).toContain(
      "fixed host tabs before scrollable content tabs",
    );
    expect(normalized).toContain(
      "one Guide-owned gap between a fixture and its card",
    );
    expect(normalized).toContain(
      "title names the visible product object or outcome",
    );
    expect(normalized).toContain("Build a plugin that uses");
  });

  it("keeps desktop footer spacing from manufacturing page overflow", () => {
    const app = readFileSync(join(PLUGIN_ROOT, "app.tsx"), "utf8");

    expect(app).toMatch(/pb-6[^"]*lg:pb-0/);
    expect(app).toMatch(/pt-5[^"]*lg:pt-4/);
  });
});
