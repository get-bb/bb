import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildPluginApp,
  buildPluginServer,
  resolvePluginBuildToolchain,
} from "../../../packages/plugin-build/src/index.ts";

const repositoryRoot = resolve(import.meta.dirname, "..", "..", "..");
const pluginRoot = resolve(repositoryRoot, "plugins", "workspace-explorer");

const bbPackage = JSON.parse(
  await readFile(resolve(repositoryRoot, "packages/bb-app/package.json"), "utf8"),
);
if (typeof bbPackage.version !== "string") {
  throw new Error("packages/bb-app/package.json is missing a version");
}

const toolchain = await resolvePluginBuildToolchain(
  resolve(repositoryRoot, "node_modules/.bb-toolchain"),
);

await rm(resolve(pluginRoot, "dist"), { recursive: true, force: true });
const manifest = JSON.parse(
  await readFile(resolve(pluginRoot, "package.json"), "utf8"),
);

const server = await buildPluginServer(pluginRoot, bbPackage.version, toolchain);
const outputs = [server.jsPath, server.metaPath];
if (manifest.bb?.app) {
  const app = await buildPluginApp(pluginRoot, bbPackage.version, toolchain);
  outputs.push(app.jsPath, app.cssPath, app.metaPath);
}
console.log(`workspace-explorer: built ${outputs.join(", ")}`);
