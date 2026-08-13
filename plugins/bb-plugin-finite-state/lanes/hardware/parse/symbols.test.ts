import { access } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseProject } from "./sheets.js";

const fixtureRoot = dirname(fileURLToPath(new URL("../../../test/fixtures/kicad/semantic/semantic.kicad_pro", import.meta.url)));
const rotatedFixtureRoot = dirname(fileURLToPath(new URL(
  "../../../test/fixtures/kicad/rotated-symbols/rotated_symbols.kicad_pro",
  import.meta.url,
)));
const customFieldsFixtureRoot = dirname(fileURLToPath(new URL(
  "../../../test/fixtures/kicad/custom-fields/custom_fields.kicad_pro",
  import.meta.url,
)));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("KiCad symbol parsing", () => {
  it("extracts semantic symbols with no KiCad executable or export artifacts", async () => {
    vi.stubEnv("PATH", "");
    await expect(access(`${fixtureRoot}/.fs-hw`)).rejects.toThrow();

    const parsed = await parseProject(fixtureRoot, "semantic.kicad_pro");
    const symbols = parsed.sheets.flatMap((sheet) => sheet.symbols);

    expect(symbols.map(({ reference, unit }) => `${reference}.${unit}`)).toEqual([
      "R2.1",
      "R10.1",
      "U3.1",
      "U3.2",
      "R4.1",
    ]);
    expect(symbols.some((symbol) => symbol.reference.startsWith("#PWR"))).toBe(false);
    expect(symbols.find((symbol) => symbol.reference === "R2")).toMatchObject({
      at: { x: 20, y: 20, angle: 0 },
      value: "1k",
      footprint: "Resistor_SMD:R_0603",
      mpn: null,
      manufacturer: null,
    });
    expect(symbols.find((symbol) => symbol.reference === "R10")).toMatchObject({
      mpn: "RES-10K-0805",
      manufacturer: "Finite Components",
      fields: { Tolerance: "1%" },
    });
    expect(symbols.find((symbol) => symbol.reference === "U3" && symbol.unit === 2)?.fields).toEqual({ DNP: "true" });
  }, 30_000);

  it("composes rotations and mirrors onto KiCad wire endpoints", async () => {
    const parsed = await parseProject(rotatedFixtureRoot, "rotated_symbols.kicad_pro");
    const nodes = new Map(parsed.nets.map((net) => [net.netName, net.nodes]));

    expect(nodes.get("N90")).toEqual([{ reference: "J90", pin: "1" }]);
    expect(nodes.get("N180")).toEqual([{ reference: "J180", pin: "1" }]);
    expect(nodes.get("N270")).toEqual([{ reference: "J270", pin: "1" }]);
    expect(nodes.get("N90_MX")).toEqual([{ reference: "J90MX", pin: "1" }]);
    expect(nodes.get("N90_MY")).toEqual([{ reference: "J90MY", pin: "1" }]);
  });

  it("extracts custom fields, units, DNP, positions, and excludes power symbols", async () => {
    const parsed = await parseProject(customFieldsFixtureRoot, "custom_fields.kicad_pro");
    const symbols = parsed.sheets.flatMap((sheet) => sheet.symbols);

    expect(symbols.map(({ reference, unit }) => `${reference}.${unit}`)).toEqual([
      "R1.1", "R2.1", "J1.1", "U1.1", "U1.2", "R3.1",
    ]);
    expect(symbols.some((symbol) => symbol.reference.startsWith("#PWR"))).toBe(false);
    expect(symbols.find((symbol) => symbol.reference === "R1")).toMatchObject({
      at: { x: 60, y: 40, angle: 0 },
      mpn: "FS150-R-10K",
      manufacturer: "Finite State Labs",
      fields: { Tolerance: "1%" },
    });
    expect(symbols.find((symbol) => symbol.reference === "R2")).toMatchObject({
      at: { x: 90, y: 50, angle: 90 },
      mpn: null,
      manufacturer: null,
      fields: { DNP: "true" },
    });
  });
});
