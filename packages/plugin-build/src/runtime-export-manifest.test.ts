import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const GENERATOR_TIMEOUT_MS = 30_000;

describe("runtime export manifest generator", () => {
  it(
    "runs when Node does not provide a global Navigator",
    async () => {
      const scriptUrl = new URL(
        "../scripts/generate-runtime-export-manifest.mjs",
        import.meta.url,
      ).href;
      const source = `
      delete globalThis.navigator;
      if (typeof globalThis.navigator !== "undefined") {
        throw new Error("test could not remove globalThis.navigator");
      }
      await import(${JSON.stringify(scriptUrl)});
    `;

      const outDir = await mkdtemp(path.join(tmpdir(), "bb-runtime-manifest-"));
      try {
        const outPath = path.join(outDir, "manifest.ts");
        const result = await execFileAsync(
          process.execPath,
          ["--input-type=module", "--eval", source, "--", "--out", outPath],
          { timeout: GENERATOR_TIMEOUT_MS },
        );
        expect(result.stdout).toContain(outPath);
      } finally {
        await rm(outDir, { recursive: true, force: true });
      }
    },
    GENERATOR_TIMEOUT_MS,
  );
});
