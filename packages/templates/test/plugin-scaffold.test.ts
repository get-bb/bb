import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLUGIN_SDK_VERSION } from "@bb/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolvePluginSdkLayout,
  scaffoldPlugin,
  syncPluginTypes,
} from "../src/plugin-scaffold.js";

/**
 * New scaffolds resolve the plugin API from the published npm package, pinned
 * to the exact SDK of the bb that scaffolded them — no vendored `types/`, no
 * tsconfig path map. These guard that shape;
 * plugin-scaffold-external.test.ts performs the actual outside-the-workspace
 * install and typecheck with library checks enabled.
 */
describe("scaffoldPlugin SDK dependency", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "bb-scaffold-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("pins @get-bb/plugin-sdk exactly and vendors no declarations (headless)", async () => {
    const targetDir = join(workDir, "bb-plugin-headless");
    await scaffoldPlugin({
      targetDir,
      packageName: "bb-plugin-headless",
      bbVersion: "0.9.0",
    });

    await expect(access(join(targetDir, "types"))).rejects.toThrow();

    const tsconfig = JSON.parse(
      await readFile(join(targetDir, "tsconfig.json"), "utf8"),
    );
    // No path map at all for a headless plugin: `@get-bb/plugin-sdk` must
    // resolve through node_modules, the way an editor and `tsc` both do.
    expect(tsconfig.compilerOptions.paths).toBeUndefined();
    expect(tsconfig.compilerOptions.skipLibCheck).toBe(false);
    expect(tsconfig.include).toEqual(["server.ts"]);

    const pkg = JSON.parse(
      await readFile(join(targetDir, "package.json"), "utf8"),
    );
    // Exact, not a caret: the declarations describe one bb build.
    expect(pkg.devDependencies["@get-bb/plugin-sdk"]).toBe(PLUGIN_SDK_VERSION);
    expect(pkg.dependencies["@get-bb/plugin-sdk"]).toBeUndefined();
    // The engines floor stays — the host reads it as a minimum within the
    // major, independently of the npm pin.
    expect(pkg.engines).toEqual({
      bb: ">=0.9",
      bbPluginSdk: `>=${PLUGIN_SDK_VERSION}`,
    });
    expect(pkg.bb).toMatchObject({
      name: "Headless",
      description: "A BB plugin.",
      branding: { icon: "Zap" },
      server: "./server.ts",
    });
    expect(pkg.devDependencies["@types/react"]).toBeDefined();
    // server.ts imports zod and the build inlines it, so an install that omits
    // dev deps still has to produce a buildable plugin (see
    // plugin-scaffold-dependencies.test.ts).
    expect(pkg.dependencies.zod).toBeDefined();
    expect(pkg.devDependencies.zod).toBeUndefined();

    const readme = await readFile(join(targetDir, "README.md"), "utf8");
    expect(readme).toContain(
      "node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts",
    );
    expect(readme).toContain(
      "sync this plugin's SDK surface to the running BB",
    );
    expect(readme).not.toContain("rewrite types/");
    expect(readme).toContain("https://github.com/get-bb/bb");
  });

  it("keeps only the shadcn alias in paths for --app plugins", async () => {
    const targetDir = join(workDir, "bb-plugin-ui");
    await scaffoldPlugin({
      targetDir,
      packageName: "bb-plugin-ui",
      bbVersion: "0.9.0",
      app: true,
    });

    await expect(access(join(targetDir, "types"))).rejects.toThrow();

    const tsconfig = JSON.parse(
      await readFile(join(targetDir, "tsconfig.json"), "utf8"),
    );
    expect(tsconfig.compilerOptions.paths).toEqual({ "@/*": ["./*"] });
    expect(tsconfig.include).toContain("app.tsx");
    expect(tsconfig.include).not.toContain("types");

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

/**
 * The seam `bb plugin types|build|dev` use to decide whether a plugin still
 * owns vendored declarations. Getting this wrong in either direction is a real
 * failure: writing `types/` into a new plugin shadows the installed package,
 * and skipping the refresh for an old one strands it on a stale API.
 */
describe("resolvePluginSdkLayout", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "bb-layout-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("reports the npm layout with its exact pin for a fresh scaffold", async () => {
    const targetDir = join(workDir, "bb-plugin-new-style");
    await scaffoldPlugin({
      targetDir,
      packageName: "bb-plugin-new-style",
      bbVersion: "0.9.0",
    });

    await expect(resolvePluginSdkLayout(targetDir)).resolves.toEqual({
      kind: "package",
      pin: PLUGIN_SDK_VERSION,
    });
  });

  it("reports the vendored layout for a legacy plugin, which still refreshes", async () => {
    const targetDir = join(workDir, "bb-plugin-legacy");
    await scaffoldPlugin({
      targetDir,
      packageName: "bb-plugin-legacy",
      bbVersion: "0.9.0",
    });
    // Rebuild the pre-npm layout: vendored declarations plus the path map,
    // and no SDK dependency.
    const pkgPath = join(targetDir, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
    delete pkg.devDependencies["@get-bb/plugin-sdk"];
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    const tsconfigPath = join(targetDir, "tsconfig.json");
    const tsconfig = JSON.parse(await readFile(tsconfigPath, "utf8"));
    tsconfig.compilerOptions.paths = {
      "@get-bb/plugin-sdk": ["./types/bb-plugin-sdk.d.ts"],
    };
    await writeFile(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);

    await expect(resolvePluginSdkLayout(targetDir)).resolves.toEqual({
      kind: "vendored",
      pin: null,
    });

    // The refresh path is unchanged for that plugin: it writes the vendored
    // declarations this bb ships.
    const files = await syncPluginTypes({ rootDir: targetDir, app: false });
    expect(files).toEqual([
      { path: "types/bb-plugin-sdk.d.ts", outcome: "written" },
    ]);
    const vendored = await readFile(
      join(targetDir, "types", "bb-plugin-sdk.d.ts"),
      "utf8",
    );
    expect(vendored).toContain("interface BbPluginApi");
  });

  it("stays vendored while declarations exist but the path map is gone", async () => {
    const targetDir = join(workDir, "bb-plugin-half-migrated");
    await scaffoldPlugin({
      targetDir,
      packageName: "bb-plugin-half-migrated",
      bbVersion: "0.9.0",
    });
    await syncPluginTypes({ rootDir: targetDir, app: false });

    const layout = await resolvePluginSdkLayout(targetDir);
    expect(layout.kind).toBe("vendored");
    expect(layout.pin).toBe(PLUGIN_SDK_VERSION);
  });
});
