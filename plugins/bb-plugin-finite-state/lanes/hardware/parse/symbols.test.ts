import { access } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseProject } from "./sheets.js";

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
});
