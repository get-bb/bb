import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { buildPluginHost } from "./build-plugin-host.js";
import { resolvePluginBuildToolchain } from "./toolchain.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function installSdkWithoutZod(pluginDir: string): Promise<void> {
  const sdkSource = resolve(import.meta.dirname, "../../plugin-sdk");
  const target = join(pluginDir, "node_modules", "@get-bb", "plugin-sdk");
  await mkdir(target, { recursive: true });
  for (const entry of ["dist", "bundled-types", "package.json"]) {
    await cp(join(sdkSource, entry), join(target, entry), { recursive: true });
  }
}

it("requires Zod at build time and bundles it for a host without node_modules", async () => {
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
      "  handlers: { resolveNativeRoots: async () => ({ skills: [], commands: [] }) },",
      "});",
      'export const invalidInput = experimental_nativeRootsHostContract.resolveNativeRoots.input["~standard"].validate({ providerId: "", cwd: null });',
      "",
    ].join("\n"),
  );
  await installSdkWithoutZod(dir);

  const toolchain = await resolvePluginBuildToolchain(
    join(process.cwd(), ".unused-toolchain"),
  );
  const built = buildPluginHost(dir, "0.0.0-test", toolchain);

  await expect(built).rejects.toThrow(/needs zod in its dependencies/);
  await expect(built).rejects.not.toThrow(/^Could not resolve "zod"$/);

  const sdkRequire = createRequire(
    resolve(import.meta.dirname, "../../plugin-sdk/package.json"),
  );
  await cp(
    dirname(sdkRequire.resolve("zod/package.json")),
    join(dir, "node_modules", "zod"),
    { recursive: true },
  );
  const { jsPath } = await buildPluginHost(dir, "0.0.0-test", toolchain);
  await rm(join(dir, "node_modules"), { recursive: true });
  const module = await import(pathToFileURL(jsPath).href);
  expect(module.invalidInput).toMatchObject({
    issues: [expect.objectContaining({ path: ["providerId"] })],
  });
  expect(await module.default.handlers.resolveNativeRoots()).toEqual({
    skills: [],
    commands: [],
  });
});
