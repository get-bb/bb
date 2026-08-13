import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseProject } from "./sheets.js";

const fixtureRoot = dirname(fileURLToPath(new URL("../../../test/fixtures/kicad/semantic/semantic.kicad_pro", import.meta.url)));

describe("KiCad net parsing", () => {
  it("derives labeled and hierarchical connectivity from schematic geometry", async () => {
    const parsed = await parseProject(fixtureRoot, "semantic.kicad_pro");
    expect(parsed.nets.find((net) => net.netName === "OP_OUT")).toEqual({
      netName: "OP_OUT",
      nodes: [
        { reference: "R4", pin: "1" },
        { reference: "U3", pin: "2" },
      ],
    });
    expect(parsed.nets.find((net) => net.netName === "R2_LOCAL")?.nodes).toEqual([
      { reference: "R2", pin: "1" },
    ]);
  }, 30_000);

  it("records unresolved connectivity as gaps instead of fabricated nets", async () => {
    const parsed = await parseProject(fixtureRoot, "semantic.kicad_pro");
    expect(parsed.connectivityGaps).toContainEqual({
      sheetPath: "semantic.kicad_sch",
      kind: "unresolved_label",
      detail: "Connected pins R2.2 have no source-defined net name",
      at: { x: 25, y: 20 },
    });
    expect(parsed.nets.flatMap((net) => net.nodes)).not.toContainEqual({ reference: "R2", pin: "2" });
    expect(parsed.nets.some((net) => /unnamed|unknown/iu.test(net.netName))).toBe(false);
  }, 30_000);
});
