import { describe, expect, it } from "vitest";

import {
  buildSurfaceEntryScaffold,
  classifyFixtureFidelity,
  fixtureResponsiveStrategy,
  parseScaffoldArgs,
  renderSurfaceEntryScaffold,
} from "../scripts/scaffold-surface-entry.mjs";
import anatomy from "../src/anatomy-manifest.json";

describe("surface-entry scaffold", () => {
  it.each([
    [
      {
        spatialOwner: false,
        transient: false,
        outcome: false,
        replacement: false,
      },
      "none",
    ],
    [
      {
        spatialOwner: true,
        transient: false,
        outcome: false,
        replacement: false,
      },
      "anchor",
    ],
    [
      {
        spatialOwner: true,
        transient: true,
        outcome: false,
        replacement: false,
      },
      "state",
    ],
    [
      {
        spatialOwner: true,
        transient: false,
        outcome: true,
        replacement: false,
      },
      "flow",
    ],
    [
      {
        spatialOwner: true,
        transient: false,
        outcome: false,
        replacement: true,
      },
      "flow",
    ],
  ] as const)("classifies %j as %s", (traits, expected) => {
    expect(classifyFixtureFidelity(traits)).toBe(expected);
  });

  it("derives fidelity from spatial ownership and observable behavior", () => {
    expect(
      classifyFixtureFidelity({
        spatialOwner: false,
        transient: false,
        outcome: false,
        replacement: false,
      }),
    ).toBe("none");
    expect(
      classifyFixtureFidelity({
        spatialOwner: true,
        transient: false,
        outcome: false,
        replacement: false,
      }),
    ).toBe("anchor");
  });

  it("uses one responsive rule for every generated spatial fixture", () => {
    expect(fixtureResponsiveStrategy({ spatialOwner: true })).toBe(
      "scale-together",
    );
    expect(fixtureResponsiveStrategy({ spatialOwner: false })).toBe("reflow");
  });

  it("generates the representative command-palette flow deterministically", () => {
    const first = parseScaffoldArgs([
      "--id",
      "command-palette-actions",
      "--title",
      "Command palette actions",
      "--group",
      "command-palette",
      "--source",
      "apps/app/src/lib/command-palette/palette-plugin-actions.ts",
      "--source",
      "apps/app/src/components/commands/CommandPalette.test.tsx",
      "--source",
      "apps/app/src/components/commands/CommandPalette.tsx",
      "--api-symbol",
      "PluginCommandPaletteActionRegistration",
      "--api-symbol",
      "PluginCommandPaletteActionContext",
      "--transient",
      "--outcome",
    ]);
    const reordered = parseScaffoldArgs([
      "--outcome",
      "--transient",
      "--api-symbol",
      "PluginCommandPaletteActionContext",
      "--source",
      "apps/app/src/components/commands/CommandPalette.tsx",
      "--source",
      "apps/app/src/components/commands/CommandPalette.test.tsx",
      "--group",
      "command-palette",
      "--title",
      "Command palette actions",
      "--id",
      "command-palette-actions",
      "--api-symbol",
      "PluginCommandPaletteActionRegistration",
      "--source",
      "apps/app/src/lib/command-palette/palette-plugin-actions.ts",
      "--api-symbol",
      "PluginCommandPaletteActionRegistration",
      "--source",
      "apps/app/src/lib/command-palette/palette-plugin-actions.ts",
    ]);

    expect(renderSurfaceEntryScaffold(first)).toBe(
      renderSurfaceEntryScaffold(reordered),
    );
    expect(buildSurfaceEntryScaffold(first)).toMatchObject({
      surface: {
        id: "command-palette-actions",
        apiSymbols: [
          "PluginCommandPaletteActionContext",
          "PluginCommandPaletteActionRegistration",
        ],
      },
      fixture: {
        groupId: "command-palette",
        fidelity: "flow",
        responsiveStrategy: "scale-together",
        requiredStates: ["anchor", "triggered", "outcome"],
        sources: [
          {
            path: "apps/app/src/components/commands/CommandPalette.test.tsx",
            anchors: ["TODO: Add a stable source anchor"],
          },
          {
            path: "apps/app/src/components/commands/CommandPalette.tsx",
            anchors: ["TODO: Add a stable source anchor"],
          },
          {
            path: "apps/app/src/lib/command-palette/palette-plugin-actions.ts",
            anchors: ["TODO: Add a stable source anchor"],
          },
        ],
        fixtureClassAnchors: ["TODO: Add a product token class"],
      },
    });
    expect(buildSurfaceEntryScaffold(first).fixture).toMatchObject({
      fidelity: anatomy.surfaceFixtures["command-palette-actions"].fidelity,
      sources: anatomy.surfaceFixtures["command-palette-actions"].sources
        .filter((source) => source.path.startsWith("apps/app/"))
        .map((source) => ({
          path: source.path,
          anchors: ["TODO: Add a stable source anchor"],
        }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    });
  });

  it("rejects a visual entry without an authoritative source", () => {
    expect(() =>
      buildSurfaceEntryScaffold({
        id: "missing-source",
        title: "Missing source",
        groupId: "app-shell",
        sourcePaths: [],
        apiSymbols: ["PluginMissingSource"],
        spatialOwner: true,
        transient: false,
        outcome: false,
        replacement: false,
      }),
    ).toThrow("spatial surfaces require at least one --source");
  });
});
