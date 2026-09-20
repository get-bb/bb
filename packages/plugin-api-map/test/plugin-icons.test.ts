import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { firstPartyPluginId, pluginIcon } from "../src/plugin-icons";
import { SURFACE_GROUPS } from "../src/surfaces";

const repoRoot = join(import.meta.dirname, "../../..");

describe("Guide first-party examples", () => {
  it("matches bundled plugin names, ids, and glyphs without substituting asset logos", () => {
    const manifests = readdirSync(join(repoRoot, "plugins"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        JSON.parse(
          readFileSync(
            join(repoRoot, "plugins", entry.name, "package.json"),
            "utf8",
          ),
        ),
      );
    const names = new Set(
      SURFACE_GROUPS.flatMap((group) =>
        group.surfaces.flatMap((surface) => surface.firstParty ?? []),
      ),
    );

    for (const name of names) {
      const manifest = manifests.find(
        (candidate) => candidate.bb.name === name,
      );
      expect(manifest, name).toBeDefined();
      expect(firstPartyPluginId(name), name).toBe(
        manifest.name.replace(/^bb-plugin-/, ""),
      );
      const glyph = manifest.bb.branding.icon;
      if (glyph.startsWith("./")) {
        expect(pluginIcon(name), name).toBeNull();
      } else {
        expect(pluginIcon(name), name).toBe(glyph);
      }
    }
  });
});
