import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { buildPluginApp, buildPluginServer } from "@bb/plugin-build";

const rootDirectory = import.meta.dirname;
const repositoryRoot = resolve(rootDirectory, "../..");
const bbPackage = JSON.parse(
  await readFile(
    resolve(repositoryRoot, "packages/bb-app/package.json"),
    "utf8",
  ),
);

if (typeof bbPackage.version !== "string") {
  throw new Error("packages/bb-app/package.json is missing a version");
}

await rm(resolve(rootDirectory, "dist"), { recursive: true, force: true });
const server = await buildPluginServer(rootDirectory, bbPackage.version);
const app = await buildPluginApp(rootDirectory, bbPackage.version);

console.log(
  `tasks: built ${server.jsPath}, ${server.metaPath}, ${app.jsPath}, ${app.cssPath}, and ${app.metaPath}`,
);
