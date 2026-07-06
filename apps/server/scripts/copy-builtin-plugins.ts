import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUILTIN_PLUGINS_DIRECTORY_NAME,
  BUILTIN_PLUGIN_NAMES,
  resolveBuiltinPluginRootPathForModuleDir,
} from "../src/services/plugins/builtin-registry.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(scriptDir, "..");
const sourceModuleDir = path.resolve(serverRoot, "src", "services", "plugins");
const targetRoot = path.resolve(
  serverRoot,
  "dist",
  BUILTIN_PLUGINS_DIRECTORY_NAME,
);

await rm(targetRoot, { recursive: true, force: true });

if (BUILTIN_PLUGIN_NAMES.length > 0) {
  await mkdir(targetRoot, { recursive: true });
}

for (const name of BUILTIN_PLUGIN_NAMES) {
  await cp(
    resolveBuiltinPluginRootPathForModuleDir({
      moduleDir: sourceModuleDir,
      name,
    }),
    path.join(targetRoot, name),
    { recursive: true },
  );
}
