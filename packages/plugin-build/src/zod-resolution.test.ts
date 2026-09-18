import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { buildPluginHost } from "./build-plugin-host.js";
import { resolvePluginBuildToolchain } from "./toolchain.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

/**
 * An SDK install with no zod reachable from it. A symlink into the workspace
 * would not reproduce the failure: esbuild resolves through the real path and
 * finds the SDK's own dev copy of zod.
 */
async function installSdkWithoutZod(pluginDir: string): Promise<void> {
  const sdkSource = resolve(import.meta.dirname, "../../plugin-sdk");
  const target = join(pluginDir, "node_modules", "@get-bb", "plugin-sdk");
  await mkdir(target, { recursive: true });
  for (const entry of ["dist", "bundled-types", "package.json"]) {
    await cp(join(sdkSource, entry), join(target, entry), { recursive: true });
  }
}

it("names zod as the plugin's missing dependency when a host entry cannot resolve it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-host-zod-"));
  tempDirs.push(dir);
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "bb-plugin-zodless",
      version: "0.0.0",
      bb: {
        name: "Zodless",
        description: "Host entry whose plugin never installed zod.",
        branding: { icon: "Zap" },
        server: "./server.ts",
        host: "./host.ts",
      },
    }),
  );
  await writeFile(
    join(dir, "host.ts"),
    [
      "import {",
      "  experimental_defineHostEntry,",
      "  experimental_nativeRootsHostContract,",
      '} from "@get-bb/plugin-sdk/host";',
      "export default experimental_defineHostEntry({",
      "  contract: experimental_nativeRootsHostContract,",
      "  handlers: { resolveNativeRoots: async () => ({ roots: [] }) },",
      "});",
      "",
    ].join("\n"),
  );
  await installSdkWithoutZod(dir);

  const built = buildPluginHost(
    dir,
    "0.0.0-test",
    await resolvePluginBuildToolchain(join(process.cwd(), ".unused-toolchain")),
  );

  // esbuild's own text points at a file inside node_modules and recommends
  // marking zod external, which would emit a bundle the host worker cannot
  // import. The plugin author's actual fix is a dependency.
  await expect(built).rejects.toThrow(/needs zod in its dependencies/);
  await expect(built).rejects.not.toThrow(/^Could not resolve "zod"$/);
});
