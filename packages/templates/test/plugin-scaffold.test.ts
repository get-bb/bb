import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLUGIN_SDK_VERSION } from "@bb/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scaffoldPlugin } from "../src/plugin-scaffold.js";

/**
 * The scaffold ships @bb/plugin-sdk's bundled .d.ts into the new plugin's
 * types/ dir so it typechecks without the (unpublished) workspace package on
 * disk. These guard that wiring; plugin-scaffold-external.test.ts performs the
 * actual outside-the-workspace typecheck with library checks enabled.
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
    expect(rootDts).toContain("interface TerminalsArea");
    expect(rootDts).toContain("terminals: TerminalsArea;");
    expect(rootDts).not.toContain("ThreadTerminalsArea");

    const tsconfig = JSON.parse(
      await readFile(join(targetDir, "tsconfig.json"), "utf8"),
    );
    expect(tsconfig.compilerOptions.paths["@bb/plugin-sdk"]).toEqual([
      "./types/bb-plugin-sdk.d.ts",
    ]);
    expect(tsconfig.compilerOptions.skipLibCheck).toBe(false);
    expect(tsconfig.include).toContain("types");

    // Normal scaffold source vendors root/app declarations; only tests using
    // the separately packaged testing subpaths need an SDK dependency.
    const pkg = JSON.parse(
      await readFile(join(targetDir, "package.json"), "utf8"),
    );
    expect(pkg.engines).toEqual({
      bb: ">=0.9",
      bbPluginSdk: `^${PLUGIN_SDK_VERSION}`,
    });
    expect(pkg.bb).toMatchObject({
      name: "Headless",
      description: "A BB plugin.",
      branding: { icon: "Zap" },
      server: "./server.ts",
    });
    expect(pkg.devDependencies["@bb/plugin-sdk"]).toBeUndefined();
    expect(pkg.devDependencies["@types/react"]).toBeDefined();
    // server.ts imports zod and the build inlines it, so an install that omits
    // dev deps still has to produce a buildable plugin (see
    // plugin-scaffold-dependencies.test.ts).
    expect(pkg.dependencies.zod).toBeDefined();
    expect(pkg.devDependencies.zod).toBeUndefined();

    // No app entry ⇒ no app types.
    await expect(
      readFile(join(targetDir, "types", "bb-plugin-sdk-app.d.ts"), "utf8"),
    ).rejects.toThrow();

    const readme = await readFile(join(targetDir, "README.md"), "utf8");
    expect(readme).toContain("https://github.com/get-bb/bb");
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

    const components = JSON.parse(
      await readFile(join(targetDir, "components.json"), "utf8"),
    );
    expect(components.registries["@bb"]).toBe(
      "https://raw.githubusercontent.com/get-bb/bb/desktop-v0.9.0/packages/plugin-registry/r/{name}.json",
    );
  });

  it("uses the canonical id in a scoped package scaffold", async () => {
    const targetDir = join(workDir, "bb-plugin-scoped");
    await scaffoldPlugin({
      targetDir,
      packageName: "@acme/bb-plugin-scoped",
      bbVersion: "0.9.0",
    });

    const pkg = JSON.parse(
      await readFile(join(targetDir, "package.json"), "utf8"),
    );
    expect(pkg.name).toBe("@acme/bb-plugin-scoped");
    expect(pkg.bb.name).toBe("Scoped");

    const readme = await readFile(join(targetDir, "README.md"), "utf8");
    expect(readme).toContain("bb plugin reload scoped");
    expect(readme).toContain("bb plugin config scoped");

    const server = await readFile(join(targetDir, "server.ts"), "utf8");
    expect(server).toContain("bb plugin config scoped");
    expect(server).not.toContain("bb plugin config @acme/");
  });
});
