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
    expect(bundle).toMatch(/from\s*"@bb\/plugin-sdk"/);
  });

  describe("host-provided zod", () => {
    const manifest = {
      name: "bb-plugin-zod-host",
      version: "0.0.0",
      bb: {
        name: "Zod host fixture",
        description: "Server entry importing zod and zod/mini.",
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    };
    const serverSource = [
      'import { z } from "zod";',
      'import { z as mini } from "zod/mini";',
      "export const a = z.string();",
      "export const b = mini.string();",
      "export default function plugin() {}",
      "",
    ].join("\n");

    async function buildFixture(options?: { hostProvidedZod: boolean }) {
      const dir = await mkdtemp(join(tmpdir(), "bb-plugin-server-zod-"));
      tempDirs.push(dir);
      await writeFile(join(dir, "package.json"), JSON.stringify(manifest));
      await writeFile(join(dir, "server.ts"), serverSource);
      await mkdir(join(dir, "node_modules"), { recursive: true });
      await symlink(
        dirname(
          createRequire(
            resolve(import.meta.dirname, "../../plugin-sdk/package.json"),
          ).resolve("zod/package.json"),
        ),
        join(dir, "node_modules", "zod"),
        "dir",
      );
      const { jsPath } = await buildPluginServer(
        dir,
        "0.0.0-test",
        await testToolchain(),
        options,
      );
      return readFile(jsPath, "utf8");
    }

    it("externalises the bare specifier and keeps subpaths bundled", async () => {
      const bundle = await buildFixture({ hostProvidedZod: true });
      expect(bundle).toMatch(/from\s*"zod"/);
      expect(bundle).not.toMatch(/from\s*"zod\/mini"/);
    });

    it("bundles zod for an installed plugin, whose zod need not be the host's", async () => {
      const bundle = await buildFixture();
      expect(bundle).not.toMatch(/from\s*"zod"/);
      expect(bundle).not.toMatch(/from\s*"zod\/mini"/);
    });
  });

  describe("runtime dependency resolution", () => {
    async function fixture(source: string) {
      const dir = await mkdtemp(join(tmpdir(), "bb-plugin-runtime-resolve-"));
      tempDirs.push(dir);
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({
          name: "bb-plugin-runtime-resolution",
          version: "0.0.0",
          bb: {
            name: "Runtime resolution",
            description: "Exercises runtime dependency resolution.",
            branding: { icon: "Zap" },
            server: "./server.ts",
          },
        }),
      );
      await writeFile(join(dir, "server.ts"), source);
      return dir;
    }

    const sdkRequire = createRequire(
      resolve(import.meta.dirname, "../../plugin-sdk/package.json"),
    );

    it("keeps bare and prefixed Node builtins external during runtime compilation", async () => {
      const dir = await fixture(`
import { readFileSync } from "fs";
import { basename } from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "node:url";
export default () => [typeof readFileSync, basename("/a/b"), typeof spawn, fileURLToPath("file:///tmp/test")];
`);
      const { jsPath } = await buildPluginServer(
        dir,
        "0.0.0-test",
        await testToolchain(),
        {
          format: "cjs",
          fallbackResolve: (specifier) => sdkRequire.resolve(specifier),
        },
      );
      expect(sdkRequire(jsPath).default()).toEqual([
        "function",
        "b",
        "function",
        "/tmp/test",
      ]);
    });

    it("uses runtime fallback for missing Zod and subpaths without weakening release validation", async () => {
      const dir = await fixture(`
import { z } from "zod";
import { z as mini } from "zod/mini";
export default () => [z.string().parse("full"), mini.string().parse("mini")];
`);
      await expect(
        buildPluginServer(dir, "0.0.0-test", await testToolchain()),
      ).rejects.toThrow('could not resolve "zod"');
      const { jsPath } = await buildPluginServer(
        dir,
        "0.0.0-test",
        await testToolchain(),
        {
          format: "cjs",
          fallbackResolve: (specifier) => sdkRequire.resolve(specifier),
        },
      );
      expect(sdkRequire(jsPath).default()).toEqual(["full", "mini"]);
    });

    it("prefers the plugin's Zod installation to the runtime fallback", async () => {
      const dir = await fixture(
        'import { owner } from "zod"; export default () => owner;',
      );
      const zodDir = join(dir, "node_modules", "zod");
      await mkdir(zodDir, { recursive: true });
      await writeFile(
        join(zodDir, "package.json"),
        JSON.stringify({ name: "zod", main: "index.js" }),
      );
      await writeFile(join(zodDir, "index.js"), 'exports.owner = "plugin";');
      const { jsPath } = await buildPluginServer(
        dir,
        "0.0.0-test",
        await testToolchain(),
        {
          format: "cjs",
          fallbackResolve: () => {
            throw new Error("fallback must not replace installed Zod");
          },
        },
      );
      expect(sdkRequire(jsPath).default()).toBe("plugin");
    });
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

    expect((await import(pathToFileURL(jsPath).href)).default.name).toBe(
      "plugin",
    );
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

  it("keeps named exports of CommonJS dependencies when preserving module locations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-server-cjs-dep-"));
    tempDirs.push(dir);
    const serverEntry = join(dir, "server.ts");
    const dependencyDir = join(dir, "node_modules", "cjs-dependency");
    await mkdir(dependencyDir, { recursive: true });
    await writeFile(
      join(dependencyDir, "package.json"),
      JSON.stringify({ name: "cjs-dependency", main: "index.js" }),
    );
    await writeFile(
      join(dependencyDir, "index.js"),
      '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.Status = { OK: 0 };\nexports.ClientError = class ClientError {};\n',
    );
    await writeFile(
      serverEntry,
      'import { ClientError, Status } from "cjs-dependency";\nexport default () => ({ status: Status.OK, error: typeof ClientError });\n',
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
          packageName: "bb-plugin-cjs-dependency-fixture",
          pluginVersion: "1.0.0",
        },
      },
    );
    const loaded = createRequire(import.meta.url)(jsPath) as {
      default: () => Record<string, unknown>;
    };

    expect(loaded.default()).toEqual({ status: 0, error: "function" });
  });

  it("compiles Zod installed inside the plugin root when preserving module locations", async () => {
    const dir = await realpath(
      await mkdtemp(join(tmpdir(), "bb-plugin-server-inroot-zod-")),
    );
    tempDirs.push(dir);
    const serverEntry = join(dir, "server.ts");
    const zodDir = join(dir, "node_modules", "zod");
    await mkdir(join(zodDir, "v4", "classic"), { recursive: true });
    await mkdir(join(zodDir, "v4", "locales"), { recursive: true });
    await writeFile(
      join(zodDir, "package.json"),
      JSON.stringify({ name: "zod", type: "module", main: "index.js" }),
    );
    await writeFile(
      join(zodDir, "index.js"),
      'export { locales } from "./v4/classic/external.js";\nexport const owner = "plugin";\n',
    );
    await writeFile(
      join(zodDir, "v4", "classic", "external.js"),
      'import * as locales from "../locales/index.js";\nexport { locales };\n',
    );
    await writeFile(
      join(zodDir, "v4", "locales", "index.js"),
      'export { default as en } from "./en.js";\nexport { default as fr } from "./fr.js";\n',
    );
    await writeFile(
      join(zodDir, "v4", "locales", "en.js"),
      'export default () => "en";\n',
    );
    await writeFile(
      join(zodDir, "v4", "locales", "fr.js"),
      'export default () => "fr";\n',
    );
    await writeFile(
      serverEntry,
      'import { locales, owner } from "zod";\nexport default () => ({ owner, locale: locales.en() });\n',
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
          packageName: "bb-plugin-inroot-zod-fixture",
          pluginVersion: "1.0.0",
        },
      },
    );
    const loaded = createRequire(import.meta.url)(jsPath) as {
      default: () => Record<string, unknown>;
    };

    expect(loaded.default()).toEqual({ owner: "plugin", locale: "en" });
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
      expect(bundle).toMatch(/from\s*"@get-bb\/plugin-sdk"/);
      expect(bundle).not.toContain('"@get-bb/plugin-sdk/host"');
      expect(bundle).toContain("resolveNativeRoots:");
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
