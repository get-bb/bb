import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { BUNDLED_PLUGIN_CATALOG } from "../../../src/services/plugin-catalog/official-catalog.js";

describe("bundled official plugin catalog", () => {
  it("matches the repository catalog published by release tooling", async () => {
    const repositoryCatalog: unknown = JSON.parse(
      await readFile(
        new URL("../../../../../plugin-catalog.json", import.meta.url),
        "utf8",
      ),
    );
    expect(repositoryCatalog).toEqual(BUNDLED_PLUGIN_CATALOG);
  });
});
