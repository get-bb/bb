import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import * as frontendRuntime from "../app.js";

function declarationValueExports(declarations: string): string[] {
  const match = declarations.match(/^export \{ ([^}]+) \};$/mu);
  expect(match, "frontend declaration value exports").not.toBeNull();
  return (match?.[1].split(", ") ?? []).sort();
}

describe("frontend plugin SDK export parity", () => {
  it("matches every public runtime value to the bundled declarations exactly", async () => {
    const declarations = await readFile(
      new URL("../../bundled-types/bb-plugin-sdk-app.d.ts", import.meta.url),
      "utf8",
    );

    expect(declarationValueExports(declarations)).toEqual(
      Object.keys(frontendRuntime).sort(),
    );
  });
});
