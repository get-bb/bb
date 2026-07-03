import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scaffoldPlugin } from "../src/plugin-scaffold.js";

/**
 * The scaffold ships @bb/plugin-sdk's bundled .d.ts into the new plugin's
 * types/ dir so it typechecks without the (unpublished) workspace package on
 * disk. These guard that wiring — the actual typecheck against those types is
 * exercised end to end by @bb/cli's plugin-build scaffold test.
 */
describe("scaffoldPlugin bundled types", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "bb-scaffold-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("ships root types and maps @bb/plugin-sdk to them (headless)", async () => {
    const targetDir = join(workDir, "bb-plugin-headless");
    await scaffoldPlugin({
      targetDir,
      packageName: "bb-plugin-headless",
      bbVersion: "0.9.0",
    });

    const rootDts = await readFile(
      join(targetDir, "types", "bb-plugin-sdk.d.ts"),
      "utf8",
    );
    expect(rootDts).toContain("interface BbPluginApi");

    const tsconfig = JSON.parse(
      await readFile(join(targetDir, "tsconfig.json"), "utf8"),
    );
    expect(tsconfig.compilerOptions.paths["@bb/plugin-sdk"]).toEqual([
      "./types/bb-plugin-sdk.d.ts",
    ]);
    expect(tsconfig.include).toContain("types");

    // The unpublished workspace package must NOT be a dependency; the real npm
    // types the bundle references are.
    const pkg = JSON.parse(
      await readFile(join(targetDir, "package.json"), "utf8"),
    );
    expect(pkg.devDependencies["@bb/plugin-sdk"]).toBeUndefined();
    expect(pkg.devDependencies.zod).toBeDefined();

    // No app entry ⇒ no app types.
    await expect(
      readFile(join(targetDir, "types", "bb-plugin-sdk-app.d.ts"), "utf8"),
    ).rejects.toThrow();

    const readme = await readFile(join(targetDir, "README.md"), "utf8");
    expect(readme).toContain("https://github.com/ymichael/bb");
  });

  it("also ships app types and maps the /app subpath for --app plugins", async () => {
    const targetDir = join(workDir, "bb-plugin-ui");
    await scaffoldPlugin({
      targetDir,
      packageName: "bb-plugin-ui",
      bbVersion: "0.9.0",
      app: true,
    });

    const appDts = await readFile(
      join(targetDir, "types", "bb-plugin-sdk-app.d.ts"),
      "utf8",
    );
    expect(appDts).toContain("definePluginApp");

    const tsconfig = JSON.parse(
      await readFile(join(targetDir, "tsconfig.json"), "utf8"),
    );
    expect(tsconfig.compilerOptions.paths["@bb/plugin-sdk/app"]).toEqual([
      "./types/bb-plugin-sdk-app.d.ts",
    ]);
    expect(tsconfig.include).toContain("app.tsx");
  });
});
