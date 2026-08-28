import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildPluginApp,
  buildPluginHost,
  buildPluginServer,
  resolvePluginBuildToolchain,
} from "../packages/plugin-build/src/index.ts";
import { OFFICIAL_PLUGINS } from "../apps/server/src/services/plugins/builtin-registry.ts";
import { pluginPackageJsonSchema } from "../packages/domain/src/index.ts";
import { z } from "zod";

const repositoryRoot = resolve(import.meta.dirname, "..");
const officialNames = OFFICIAL_PLUGINS.map((plugin) => plugin.name);

const requested = process.argv.slice(2);
const selected =
  requested.length === 0 || requested.includes("all")
    ? officialNames
    : requested;

const toolchain = await resolvePluginBuildToolchain(
  resolve(repositoryRoot, "node_modules/.bb-toolchain"),
);

for (const plugin of selected) {
  if (!officialNames.includes(plugin)) {
    throw new Error(
      `unknown official plugin ${JSON.stringify(plugin)}; expected ${officialNames.join(", ")}, or all`,
    );
  }
}

const bbPackageJsonSchema = z.object({ version: z.string() }).passthrough();
const bbPackage = bbPackageJsonSchema.parse(
  JSON.parse(
    await readFile(
      resolve(repositoryRoot, "packages/bb-app/package.json"),
      "utf8",
    ),
  ),
);

for (const plugin of selected) {
  const rootDirectory = resolve(repositoryRoot, "plugins", plugin);
  await rm(resolve(rootDirectory, "dist"), { recursive: true, force: true });
  const manifest = pluginPackageJsonSchema.parse(
    JSON.parse(await readFile(resolve(rootDirectory, "package.json"), "utf8")),
  );

  const server = await buildPluginServer(
    rootDirectory,
    bbPackage.version,
    toolchain,
  );
  const app = manifest.bb?.app
    ? await buildPluginApp(rootDirectory, bbPackage.version, toolchain)
    : null;
  const host = manifest.bb?.host
    ? await buildPluginHost(rootDirectory, bbPackage.version, toolchain)
    : null;
  const outputs = [server.jsPath, server.metaPath];
  if (app !== null) {
    outputs.push(app.jsPath, app.cssPath, app.metaPath);
  }
  if (host !== null) outputs.push(host.jsPath, host.mapPath, host.metaPath);
  console.log(`${plugin}: built ${outputs.join(", ")}`);
}
