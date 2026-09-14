import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const pluginBuild = await import(
  pathToFileURL(
    resolve(import.meta.dirname, "../../packages/plugin-build/src/index.ts"),
  ).href
);
const {
  buildPluginApp,
  buildPluginHost,
  buildPluginServer,
  resolvePluginBuildToolchain,
} = pluginBuild;

const repositoryRoot = resolve(import.meta.dirname, "../..");
const pluginRoot = resolve(repositoryRoot, "plugins", "git-graph");

const toolchain = await resolvePluginBuildToolchain(
  resolve(repositoryRoot, "node_modules/.bb-toolchain"),
);
const bbPackage = JSON.parse(
  await readFile(
    resolve(repositoryRoot, "packages/bb-app/package.json"),
    "utf8",
  ),
);
const manifest = JSON.parse(
  await readFile(resolve(pluginRoot, "package.json"), "utf8"),
);

await rm(resolve(pluginRoot, "dist"), { recursive: true, force: true });
const server = await buildPluginServer(
  pluginRoot,
  bbPackage.version,
  toolchain,
);
const outputs = [server.jsPath, server.metaPath];
if (manifest.bb?.app) {
  const app = await buildPluginApp(pluginRoot, bbPackage.version, toolchain);
  outputs.push(app.jsPath, app.cssPath, app.metaPath);
}
if (manifest.bb?.host) {
  const host = await buildPluginHost(pluginRoot, bbPackage.version, toolchain);
  outputs.push(host.jsPath, host.mapPath, host.metaPath);
}
console.log(`git-graph production build: ${outputs.join(", ")}`);
