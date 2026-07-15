import { describe, expect, it } from "vitest";
import {
  normalizePersistedPluginCatalog,
  parsePluginCatalog,
} from "../../../src/services/plugin-catalog/catalog.js";

const baseCatalog = {
  schemaVersion: 1,
  plugins: [
    {
      id: "notes",
      displayName: "Notes",
      description: "Notes",
      source: { npm: { package: "bb-plugin-notes", range: "^1.0.0" } },
    },
  ],
};

describe("plugin catalog validation", () => {
  it("accepts only npm, git, and GitHub Release entry sources", () => {
    expect(parsePluginCatalog(baseCatalog).plugins[0]?.id).toBe("notes");
    expect(() =>
      parsePluginCatalog({
        ...baseCatalog,
        plugins: [
          {
            ...baseCatalog.plugins[0],
            source: { path: "plugins/notes" },
          },
        ],
      }),
    ).toThrow(/invalid plugin catalog/);
  });

  it("rejects unknown schema versions, duplicate ids, and escaping git subdirectories", () => {
    expect(() =>
      parsePluginCatalog({ ...baseCatalog, schemaVersion: 99 }),
    ).toThrow(/schemaVersion 99/);
    expect(() =>
      parsePluginCatalog({
        ...baseCatalog,
        plugins: [baseCatalog.plugins[0], baseCatalog.plugins[0]],
      }),
    ).toThrow(/duplicate plugin id/);
    expect(() =>
      parsePluginCatalog({
        ...baseCatalog,
        plugins: [
          {
            ...baseCatalog.plugins[0],
            source: {
              git: {
                url: "https://example.test/plugin.git",
                ref: "main",
                subdir: "../escape",
              },
            },
          },
        ],
      }),
    ).toThrow(/must stay inside/);
  });

  it("normalizes only the legacy persisted official identity shape", () => {
    expect(
      normalizePersistedPluginCatalog({
        ...baseCatalog,
        name: "bb-official",
        displayName: "BB Official",
      }),
    ).toEqual({ catalog: baseCatalog, normalizedLegacyShape: true });
    expect(() =>
      normalizePersistedPluginCatalog({
        ...baseCatalog,
        name: "custom-catalog",
        displayName: "Custom",
      }),
    ).toThrow(/invalid plugin catalog/);
  });
});
