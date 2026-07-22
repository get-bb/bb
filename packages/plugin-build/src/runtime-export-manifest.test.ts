import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("runtime export manifest generator", () => {
  it("runs when Node does not provide a global Navigator", async () => {
    const scriptUrl = new URL(
      "../scripts/generate-runtime-export-manifest.mjs",
      import.meta.url,
    ).href;
    const source = `
      delete globalThis.navigator;
      if (typeof globalThis.navigator !== "undefined") {
        throw new Error("test could not remove globalThis.navigator");
      }
      process.argv.push("--check");
      await import(${JSON.stringify(scriptUrl)});
    `;

    const result = await execFileAsync(
      process.execPath,
      ["--input-type=module", "--eval", source],
      { timeout: 30_000 },
    );

    expect(result.stdout).toContain("runtime-export-manifest.ts");
  });
});
