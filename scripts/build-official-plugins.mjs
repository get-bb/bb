import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildPluginApp,
  buildPluginServer,
} from "../packages/plugin-build/src/index.ts";

const repositoryRoot = resolve(import.meta.dirname, "..");
const pluginDirectories = new Map([
  ["github", "official-plugins/github"],
  ["docs", "official-plugins/docs"],
  ["memory", "official-plugins/memory"],
]);

const requested = process.argv.slice(2);
const selected =
  requested.length === 0 || requested.includes("all")
    ? [...pluginDirectories.keys()]
    : requested;

for (const plugin of selected) {
  if (!pluginDirectories.has(plugin)) {
    throw new Error(
      `unknown official plugin ${JSON.stringify(plugin)}; expected github, docs, memory, or all`,
    );
  }
}

const bbPackage = JSON.parse(
  await readFile(
    resolve(repositoryRoot, "packages/bb-app/package.json"),
    "utf8",
  ),
);
if (typeof bbPackage.version !== "string") {
  throw new Error("packages/bb-app/package.json is missing a version");
}

for (const plugin of selected) {
  const relativeDirectory = pluginDirectories.get(plugin);
  const rootDirectory = resolve(repositoryRoot, relativeDirectory);
  await rm(resolve(rootDirectory, "dist"), { recursive: true, force: true });

  const server = await buildPluginServer(rootDirectory, bbPackage.version);
  const app = await buildPluginApp(rootDirectory, bbPackage.version);
  console.log(
    `${plugin}: built ${server.jsPath}, ${server.metaPath}, ${app.jsPath}, ${app.cssPath}, and ${app.metaPath}`,
  );
}
