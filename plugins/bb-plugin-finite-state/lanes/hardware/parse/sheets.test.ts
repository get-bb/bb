import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseProject } from "./sheets.js";

const fixtures = dirname(fileURLToPath(new URL("../../../test/fixtures/kicad/README.md", import.meta.url)));

describe("KiCad sheet walking", () => {
  it("returns the ordered hierarchical sheet tree", async () => {
    const parsed = await parseProject(`${fixtures}/semantic`, "semantic.kicad_pro");
    expect(parsed.sheets.map((sheet) => ({
      path: sheet.sheetPath,
      name: sheet.name,
      parent: sheet.parent,
      order: sheet.pageOrder,
      size: [sheet.widthMm, sheet.heightMm],
    }))).toEqual([
      {
        path: "semantic.kicad_sch",
        name: "semantic",
        parent: null,
        order: 0,
        size: [297, 210],
      },
      {
        path: "sensor.kicad_sch",
        name: "Sensor",
        parent: "semantic.kicad_sch",
        order: 1,
        size: [210, 297],
      },
    ]);
  }, 30_000);

  it("refuses a named hierarchical sheet cycle", async () => {
    await expect(parseProject(`${fixtures}/cycle`, "cycle.kicad_pro")).rejects.toThrow(
      "KICAD_SHEET_CYCLE: cycle.kicad_sch -> child.kicad_sch -> cycle.kicad_sch",
    );
  }, 30_000);
});
