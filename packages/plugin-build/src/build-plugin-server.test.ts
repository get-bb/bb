import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPluginServer,
  PLUGIN_SERVER_EXTERNALS,
} from "./build-plugin-server.js";
import { resolvePluginBuildToolchain } from "./toolchain.js";

function testToolchain() {
  return resolvePluginBuildToolchain(join(tmpdir(), "bb-toolchain-unused"));
}

describe("plugin server build", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("keeps both the current and the pre-rename SDK specifier external", () => {
    expect(PLUGIN_SERVER_EXTERNALS).toContain("@get-bb/plugin-sdk");
    expect(PLUGIN_SERVER_EXTERNALS).toContain("@bb/plugin-sdk");
  });

  it("builds a pre-rename source importing bare @bb/plugin-sdk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-server-legacy-"));
    tempDirs.push(dir);
    await mkdir(join(dir, "dist"), { recursive: true });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-legacy-sdk-fixture",
        version: "0.0.0",
        bb: {
          name: "Legacy SDK fixture",
          description: "Verifies the pre-rename SDK specifier stays external.",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(
      join(dir, "server.ts"),
      [
        'import type { BbPluginApi } from "@bb/plugin-sdk";',
        'import { defineRpcContract } from "@bb/plugin-sdk";',
        "export default function plugin(bb: BbPluginApi) {",
        "  void defineRpcContract;",
        "  void bb;",
        "}",
        "",
      ].join("\n"),
    );

    const { jsPath } = await buildPluginServer(
      dir,
      "0.0.0-test",
      await testToolchain(),
    );

    const bundle = await readFile(jsPath, "utf8");
    expect(bundle).toContain('from "@bb/plugin-sdk"');
  });

  it("accepts runtime-validated server config without applying release asset validation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-server-runtime-"));
    tempDirs.push(dir);
    const serverEntry = join(dir, "server.ts");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-runtime-fixture",
        version: "1.0.0",
        bb: {
          name: "Runtime fixture",
          description: "Uses runtime branding validation.",
          branding: { logo: { light: "./logo.svg" } },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(
      join(dir, "logo.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    );
    await writeFile(serverEntry, "export default function plugin() {}\n");

    const { jsPath } = await buildPluginServer(
      dir,
      "0.0.0-test",
      await testToolchain(),
      {
        validatedConfig: {
          serverEntry,
          packageName: "bb-plugin-runtime-fixture",
          pluginVersion: "1.0.0",
        },
      },
    );

    expect(await readFile(jsPath, "utf8")).toContain("function plugin");
  });

  it("places release ESM in an explicit module package scope", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-server-commonjs-"));
    tempDirs.push(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-commonjs-fixture",
        version: "1.0.0",
        type: "commonjs",
        bb: {
          name: "CommonJS fixture",
          description: "Builds an ESM server inside a CommonJS package.",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(join(dir, "server.ts"), "export default () => {};\n");

    const { jsPath } = await buildPluginServer(
      dir,
      "0.0.0-test",
      await testToolchain(),
    );

    expect(
      JSON.parse(await readFile(join(dir, "dist/package.json"), "utf8")),
    ).toEqual({ type: "module" });
    expect(typeof (await import(pathToFileURL(jsPath).href)).default).toBe(
      "function",
    );
  });

  it("preserves module locations without rewriting source text", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-server-location-"));
    tempDirs.push(dir);
    const serverEntry = join(dir, "server.ts");
    await writeFile(
      join(dir, "helper.mjs"),
      'export const value = "helper";\n',
    );
    await writeFile(
      serverEntry,
      `const literal = "import.meta.url";
const pattern = /import\\.meta\\.url/;
const target = "./helper.mjs";
export default async function plugin() {
  return {
    literal,
    pattern: pattern.test(literal),
    urls: [import.meta.url, import.meta.url],
    dirname: import.meta.dirname,
    filename: import.meta.filename,
    dynamic: (await import(target)).value,
  };
}
`,
    );

    const { jsPath } = await buildPluginServer(
      dir,
      "0.0.0-test",
      await testToolchain(),
      {
        format: "cjs",
        preserveSourceModuleLocation: true,
        externalizeSourceOutsideRoot: true,
        validatedConfig: {
          serverEntry,
          packageName: "bb-plugin-location-fixture",
          pluginVersion: "1.0.0",
        },
      },
    );
    const loaded = createRequire(import.meta.url)(jsPath) as {
      default: () => Promise<Record<string, unknown>>;
    };
    const canonicalServerEntry = await realpath(serverEntry);

    await expect(loaded.default()).resolves.toEqual({
      literal: "import.meta.url",
      pattern: true,
      urls: [
        pathToFileURL(canonicalServerEntry).href,
        pathToFileURL(canonicalServerEntry).href,
      ],
      dirname: dirname(canonicalServerEntry),
      filename: canonicalServerEntry,
      dynamic: "helper",
    });
  });

  it("rejects static source imports outside the plugin tree", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "bb-plugin-server-boundary-"));
    tempDirs.push(workDir);
    const dir = join(workDir, "plugin");
    await mkdir(dir);
    const serverEntry = join(dir, "server.ts");
    await writeFile(join(workDir, "shared.js"), "export const value = 1;\n");
    await writeFile(
      serverEntry,
      'import { value } from "../shared.js"; export default () => value;\n',
    );

    await expect(
      buildPluginServer(dir, "0.0.0-test", await testToolchain(), {
        format: "cjs",
        externalizeSourceOutsideRoot: true,
        validatedConfig: {
          serverEntry,
          packageName: "bb-plugin-boundary-fixture",
          pluginVersion: "1.0.0",
        },
      }),
    ).rejects.toThrow(
      "server source import escapes the plugin directory: ../shared.js",
    );
  });

  describe("SDK subpath imports", () => {
    const manifest = {
      name: "bb-plugin-server-subpath-fixture",
      version: "1.0.0",
      engines: { bb: ">=0.0" },
      bb: {
        name: "Server subpath fixture",
        description: "Imports a host contract from the SDK in server code.",
        branding: { icon: "Cpu" },
        server: "./server.ts",
      },
    };
    const serverSource = [
      'import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";',
      'import { experimental_nativeRootsHostContract } from "@get-bb/plugin-sdk/host";',
      "export const contract = defineRpcContract(experimental_nativeRootsHostContract);",
      "export default function plugin(bb: BbPluginApi) {",
      "  void bb;",
      "}",
      "",
    ].join("\n");

    async function writeFixture(dir: string): Promise<void> {
      await writeFile(join(dir, "package.json"), JSON.stringify(manifest));
      await writeFile(join(dir, "server.ts"), serverSource);
    }

    it("keeps the bare specifier external and bundles the subpath from the plugin's SDK", async () => {
      const dir = await mkdtemp(join(tmpdir(), "bb-plugin-server-subpath-"));
      tempDirs.push(dir);
      await writeFixture(dir);
      await mkdir(join(dir, "node_modules", "@get-bb"), { recursive: true });
      await symlink(
        resolve(import.meta.dirname, "../../plugin-sdk"),
        join(dir, "node_modules", "@get-bb", "plugin-sdk"),
        "dir",
      );

      const { jsPath } = await buildPluginServer(
        dir,
        "0.0.0-test",
        await testToolchain(),
        { fallbackResolve: () => undefined, externalizeBareImports: true },
      );

      const bundle = await readFile(jsPath, "utf8");
      expect(bundle).toContain('from "@get-bb/plugin-sdk"');
      expect(bundle).not.toContain('"@get-bb/plugin-sdk/host"');
      expect(bundle).toContain("resolveNativeRoots");
    });

    it("names the missing SDK dependency when the plugin has no node_modules", async () => {
      const dir = await mkdtemp(join(tmpdir(), "bb-plugin-server-no-sdk-"));
      tempDirs.push(dir);
      await writeFixture(dir);

      await expect(
        buildPluginServer(dir, "0.0.0-test", await testToolchain()),
      ).rejects.toThrow(
        '"@get-bb/plugin-sdk/host" is not installed for this plugin (no node_modules/@get-bb/plugin-sdk); a server entry\'s "@get-bb/plugin-sdk/host" import is bundled from the plugin\'s own SDK install (bb serves only the bare "@get-bb/plugin-sdk" at load time), so the plugin needs the SDK as a dependency',
      );
    });

    it("names the unbuilt SDK dist when the package is installed without it", async () => {
      const dir = await mkdtemp(
        join(tmpdir(), "bb-plugin-server-unbuilt-sdk-"),
      );
      tempDirs.push(dir);
      await writeFixture(dir);
      const sdkDir = join(dir, "node_modules", "@get-bb", "plugin-sdk");
      await mkdir(sdkDir, { recursive: true });
      await writeFile(
        join(sdkDir, "package.json"),
        JSON.stringify({
          name: "@get-bb/plugin-sdk",
          version: "0.0.0-test",
          type: "module",
          exports: {
            ".": { import: "./dist/index.js", default: "./dist/index.js" },
            "./host": { import: "./dist/host.js", default: "./dist/host.js" },
          },
        }),
      );

      await expect(
        buildPluginServer(dir, "0.0.0-test", await testToolchain()),
      ).rejects.toThrow(
        `"@get-bb/plugin-sdk/host" is installed for this plugin but its dist is not built: run the SDK build (${join(await realpath(sdkDir), "dist", "host.js")} is missing)`,
      );
    });
  });
});
