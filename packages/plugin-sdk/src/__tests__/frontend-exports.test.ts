import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import * as frontendRuntime from "../app.js";

const RUNTIME_ONLY_COMPAT_EXPORTS = ["useComposerView"];

function declarationValueExports(declarations: string): string[] {
  const match = declarations.match(/^export \{ ([^}]+) \};$/mu);
  expect(match, "frontend declaration value exports").not.toBeNull();
  return (match?.[1].split(", ") ?? []).sort();
}

describe("frontend plugin SDK export parity", () => {
  it("declares every public runtime value except the compatibility exports", async () => {
    const declarations = await readFile(
      new URL("../../bundled-types/bb-plugin-sdk-app.d.ts", import.meta.url),
      "utf8",
    );
    const declared = declarationValueExports(declarations);
    const runtime = Object.keys(frontendRuntime).sort();

    expect(declared).toEqual(
      runtime.filter((name) => !RUNTIME_ONLY_COMPAT_EXPORTS.includes(name)),
    );
    for (const name of RUNTIME_ONLY_COMPAT_EXPORTS) {
      expect(runtime).toContain(name);
      expect(declared).not.toContain(name);
    }
  });
});
