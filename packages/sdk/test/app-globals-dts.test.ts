import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..", "..");
const generatorPath = path.join(
  repoRoot,
  "packages",
  "sdk",
  "scripts",
  "generate-app-globals-dts.mjs",
);
const declarationPath = path.join(
  repoRoot,
  "apps",
  "server",
  "src",
  "services",
  "threads",
  "app-scaffold-template",
  "source",
  "src",
  "bb-sdk.d.ts",
);
const APP_GLOBALS_CODEGEN_TEST_TIMEOUT_MS = 15_000;

describe("app globals declaration codegen", () => {
  it(
    "keeps the scaffold bb-sdk.d.ts generated from @bb/sdk",
    () => {
      expect(() =>
        execFileSync(process.execPath, [generatorPath, "--check"], {
          cwd: repoRoot,
          stdio: "pipe",
        }),
      ).not.toThrow();

      const declaration = readFileSync(declarationPath, "utf8");
      expect(declaration).toContain("GENERATED - do not edit");
      expect(declaration).not.toMatch(/^\s*import\s/mu);
      expect(declaration).toContain("interface Window");
      expect(declaration).toContain("bb?: Bb");
    },
    APP_GLOBALS_CODEGEN_TEST_TIMEOUT_MS,
  );
});
