import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findPluginSdkInstallImports } from "./plugin-sdk-install-imports.js";

let rootDir: string | undefined;

afterEach(async () => {
  if (rootDir !== undefined)
    await rm(rootDir, { recursive: true, force: true });
});

async function writePlugin(files: Record<string, string>): Promise<string> {
  rootDir = await mkdtemp(join(tmpdir(), "bb-plugin-sdk-install-imports-"));
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: "bb-plugin-fixture",
      bb: { server: "./server.ts", host: "./host.ts", app: "./app.tsx" },
    }),
  );
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(rootDir, path)), { recursive: true });
    await writeFile(join(rootDir, path), contents);
  }
  return rootDir;
}

describe("findPluginSdkInstallImports", () => {
  it("skips type-only relative imports and follows runtime re-exports through cycles", async () => {
    const dir = await writePlugin({
      "server.ts": [
        'import type { Only } from "./types.js";',
        'export type { Only } from "./types.js";',
        'import { type Only as Other } from "./types.js";',
        'const dynamic = import("@get-bb/plugin-sdk/" + subpath);',
        'const required = require("@get-bb/plugin-sdk/" + subpath);',
        'export { helper } from "./runtime.js";',
      ].join("\n"),
      "types.ts":
        'import { bridge } from "@get-bb/plugin-sdk/provider-bridge";\nexport type Only = typeof bridge;',
      "runtime.ts":
        'import "./server.js";\nexport { helper } from "@get-bb/plugin-sdk/process";',
    });

    await expect(findPluginSdkInstallImports(dir)).resolves.toEqual([
      {
        entry: "server",
        file: "runtime.ts",
        specifier: "@get-bb/plugin-sdk/process",
      },
    ]);
  });

  it("reports a shared source for each entry that needs the SDK install", async () => {
    const dir = await writePlugin({
      "server.ts": 'export { bridge } from "./shared.js";',
      "host.ts": 'export { bridge } from "./shared.js";',
      "shared.ts":
        'export const bridge = require("@get-bb/plugin-sdk/provider-bridge");',
    });

    await expect(findPluginSdkInstallImports(dir)).resolves.toEqual([
      {
        entry: "server",
        file: "shared.ts",
        specifier: "@get-bb/plugin-sdk/provider-bridge",
      },
      {
        entry: "host",
        file: "shared.ts",
        specifier: "@get-bb/plugin-sdk/provider-bridge",
      },
    ]);
  });

  it("does not follow relative imports outside the plugin root, including symlinks", async () => {
    const dir = await writePlugin({
      "server.ts":
        'import "./linked.js";\nimport "../package.json";\nexport { helper } from "@get-bb/plugin-sdk/process";',
    });
    const outsideDir = await mkdtemp(join(tmpdir(), "bb-plugin-sdk-outside-"));
    try {
      await writeFile(
        join(outsideDir, "outside.ts"),
        'export { bridge } from "@get-bb/plugin-sdk/provider-bridge";',
      );
      await symlink(join(outsideDir, "outside.ts"), join(dir, "linked.js"));

      await expect(findPluginSdkInstallImports(dir)).resolves.toEqual([
        {
          entry: "server",
          file: "server.ts",
          specifier: "@get-bb/plugin-sdk/process",
        },
      ]);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("reports each entry's runtime SDK imports that bb does not provide, following relative imports", async () => {
    const dir = await writePlugin({
      "server.ts": [
        'import type { BbPluginApi } from "@get-bb/plugin-sdk";',
        'import { helper } from "./lib/helper.js";',
        'import "./missing.js";',
        "export default (api: BbPluginApi) => helper(api);",
      ].join("\n"),
      "lib/helper.ts":
        'import { experimental_hostToolchain } from "@get-bb/plugin-sdk/process";\nexport const helper = experimental_hostToolchain;\n',
      "host.ts": [
        'import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";',
        'import type { ProviderBridge } from "@get-bb/plugin-sdk/provider-bridge";',
        'const contract = await import("./contract");',
        "export default experimental_defineHostEntry(contract);",
      ].join("\n"),
      "contract/index.ts":
        'export { experimental_nativeRootsHostContract } from "@get-bb/plugin-sdk/host";\n',
      "app.tsx":
        'import { definePluginApp } from "@get-bb/plugin-sdk/app";\nimport { createTestApp } from "./panel.js";\nexport default definePluginApp(createTestApp);\n',
      "panel.tsx":
        'export { createTestApp } from "@get-bb/plugin-sdk/testing/app";\n',
    });

    await expect(findPluginSdkInstallImports(dir)).resolves.toEqual([
      {
        entry: "server",
        file: "lib/helper.ts",
        specifier: "@get-bb/plugin-sdk/process",
      },
      {
        entry: "host",
        file: "contract/index.ts",
        specifier: "@get-bb/plugin-sdk/host",
      },
      {
        entry: "app",
        file: "panel.tsx",
        specifier: "@get-bb/plugin-sdk/testing/app",
      },
    ]);
  });
});
