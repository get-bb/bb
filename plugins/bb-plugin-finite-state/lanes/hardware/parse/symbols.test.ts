import { access, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseKicadSch } from "kicadts";
import { parseProject } from "./sheets.js";
import { extractSymbols } from "./symbols.js";

const fixtureRoot = dirname(fileURLToPath(new URL("../../../test/fixtures/kicad/semantic/semantic.kicad_pro", import.meta.url)));

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

  it.each([
    [undefined, { x: 149.86, y: 87.63 }],
    ["x", { x: 144.78, y: 87.63 }],
    ["y", { x: 149.86, y: 97.79 }],
  ] as const)("composes a 90-degree rotation with mirror %s", async (mirror, expected) => {
    const source = await readFile(new URL(
      "../../../test/fixtures/kicad/custom-fields/custom_fields.kicad_sch",
      import.meta.url,
    ), "utf8");
    const symbolInstancesStart = source.indexOf("\n  (symbol_instances");
    if (symbolInstancesStart < 0) throw new Error("fixture symbol instances missing");
    const schematic = parseKicadSch(`${source.slice(0, symbolInstancesStart)}\n)`);
    const connector = schematic.symbols.find((symbol) =>
      symbol.properties.some((property) => property.key === "Reference" && property.value === "J1"));
    if (!connector?.at) throw new Error("fixture connector missing");
    connector.at.angle = 90;
    connector.mirror = mirror;
    const actual = extractSymbols(schematic).pins.find((pin) =>
      pin.reference === "J1" && pin.pin === "2")?.at;
    expect(actual?.x).toBeCloseTo(expected.x, 6);
    expect(actual?.y).toBeCloseTo(expected.y, 6);
  });
});
