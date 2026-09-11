import { existsSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

const runtimeOutputRoots = [
  "apps/app/dist",
  "apps/server/dist",
  "packages/bundled-plugins/dist",
  "apps/host-daemon/dist",
  "packages/plugin-build/dist",
  "packages/plugin-sdk/dist",
  "packages/plugin-sdk/bundled-types",
  "packages/templates/src/generated",
  "packages/plugin-build/src/generated",
  "apps/server/src/generated",
];

export async function cleanRuntimeOutputs(root) {
  const pluginsRoot = join(root, "plugins");
  if (existsSync(pluginsRoot)) {
    for (const entry of readdirSync(pluginsRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        await rm(join(pluginsRoot, entry.name, ".bundled-runtime"), {
          recursive: true,
          force: true,
        });
      }
    }
  }
  for (const path of runtimeOutputRoots) {
    await rm(join(root, path), { recursive: true, force: true });
  }
}
