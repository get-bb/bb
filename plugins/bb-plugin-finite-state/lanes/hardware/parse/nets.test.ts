import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseProject } from "./sheets.js";

const fixtureRoot = dirname(fileURLToPath(new URL("../../../test/fixtures/kicad/semantic/semantic.kicad_pro", import.meta.url)));
const customFieldsRoot = dirname(fileURLToPath(new URL(
  "../../../test/fixtures/kicad/custom-fields/custom_fields.kicad_pro",
  import.meta.url,
)));

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
    expect(parsed.nets.find((net) => net.netName === "OP_INPUT")?.nodes).toEqual([
      { reference: "U3", pin: "1" },
      { reference: "U3", pin: "3" },
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

  it("matches originally-authored labeled, hierarchical, and unresolved connectivity", async () => {
    const parsed = await parseProject(customFieldsRoot, "custom_fields.kicad_pro");
    expect(parsed.nets).toEqual([
      { netName: "AUX_INPUT", nodes: [{ reference: "U1", pin: "3" }] },
      { netName: "AUX_OUTPUT", nodes: [{ reference: "U1", pin: "4" }] },
      { netName: "COMMAND", nodes: [{ reference: "U1", pin: "1" }] },
      {
        netName: "CONTROL",
        nodes: [{ reference: "R3", pin: "1" }, { reference: "U1", pin: "2" }],
      },
      {
        netName: "INPUT_SIGNAL",
        nodes: [{ reference: "J1", pin: "1" }, { reference: "R1", pin: "1" }],
      },
      { netName: "SENSOR_RETURN", nodes: [{ reference: "R3", pin: "2" }] },
    ]);
    expect(parsed.connectivityGaps).toEqual([
      {
        sheetPath: "custom_fields.kicad_sch",
        kind: "unresolved_label",
        detail: "Connected pins R2.2, J1.2 have no source-defined net name",
        at: { x: 35, y: 45 },
      },
      {
        sheetPath: "custom_fields.kicad_sch",
        kind: "unresolved_label",
        detail: "Connected pins R1.2 have no source-defined net name",
        at: { x: 65, y: 40 },
      },
      {
        sheetPath: "custom_fields.kicad_sch",
        kind: "unresolved_label",
        detail: "Connected pins R2.1 have no source-defined net name",
        at: { x: 90, y: 55 },
      },
    ]);
    for (const gap of parsed.connectivityGaps) {
      if (gap.at) expect(Object.keys(gap.at).sort()).toEqual(["x", "y"]);
    }
  }, 30_000);
});
