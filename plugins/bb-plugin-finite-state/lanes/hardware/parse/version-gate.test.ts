import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseProject } from "./sheets.js";

const fixtures = dirname(fileURLToPath(new URL("../../../test/fixtures/kicad/README.md", import.meta.url)));

describe("KiCad schematic version gate", () => {
  it("rejects KiCad 5 with the file and detected version", async () => {
    await expect(parseProject(`${fixtures}/legacy`, "legacy.kicad_pro")).rejects.toThrow(
      "KICAD_VERSION_UNSUPPORTED: legacy.kicad_sch uses unsupported KiCad format 4",
    );
  }, 30_000);

  it("rejects a truncated supported-format sheet explicitly", async () => {
    await expect(parseProject(`${fixtures}/corrupt`, "corrupt.kicad_pro")).rejects.toThrow(
      /KICAD_PARSE_FAILED: corrupt\.kicad_sch:/u,
    );
  }, 30_000);
});
