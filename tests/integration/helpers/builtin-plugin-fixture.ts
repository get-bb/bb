import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolvePluginBuildToolchain } from "../../../packages/plugin-build/src/toolchain.js";
import { resolveBuiltinPluginRootPath } from "../../../apps/server/src/services/plugins/builtin-registry.js";
import { readPluginManifest } from "../../../apps/server/src/services/plugins/manifest.js";
import { buildMutablePluginHost } from "../../../apps/server/src/services/plugins/mutable-plugin-artifacts.js";

export const INTEGRATION_APP_VERSION = "0.0.0-dev";
export const PROJECT_CHECKOUT_BUILTIN_PLUGIN = "environment-project-checkout";
export const INTEGRATION_BUILTIN_PLUGINS = [
  PROJECT_CHECKOUT_BUILTIN_PLUGIN,
  "git",
];

const TEMPLATE_PATH_ENV = "BB_TEST_BUILTIN_HOST_RECORDS";

export async function copyBuiltinHostBuildRecords(
  dataDir: string,
): Promise<void> {
  const templatePath = process.env[TEMPLATE_PATH_ENV];
  if (templatePath === undefined) return;
  await fs.cp(templatePath, path.join(dataDir, "plugins", "runtime", "host"), {
    recursive: true,
  });
}

export async function setupBuiltinHostBuildRecords(): Promise<
  () => Promise<void>
> {
  const dataDir = await fs.mkdtemp(
    path.join(tmpdir(), "bb-builtin-host-fixture-"),
  );
  const recordsPath = path.join(dataDir, "plugins", "runtime", "host");
  const previousTemplatePath = process.env[TEMPLATE_PATH_ENV];
  try {
    await fs.mkdir(recordsPath, { recursive: true });
    const toolchain = await resolvePluginBuildToolchain(
      path.join(dataDir, "plugins"),
    );
    for (const name of INTEGRATION_BUILTIN_PLUGINS) {
      const rootDir = resolveBuiltinPluginRootPath(name);
      const manifest = await readPluginManifest(rootDir);
      if (
        manifest.hostEntry === undefined ||
        manifest.hostEntry === path.join(rootDir, "dist", "host.js")
      ) {
        continue;
      }
      await buildMutablePluginHost({
        dataDir,
        pluginId: manifest.id,
        rootDir,
        bbVersion: INTEGRATION_APP_VERSION,
        toolchain,
      });
    }
  } catch (error) {
    await fs.rm(dataDir, { recursive: true, force: true });
    throw error;
  }
  process.env[TEMPLATE_PATH_ENV] = recordsPath;
  return async () => {
    if (previousTemplatePath === undefined) {
      delete process.env[TEMPLATE_PATH_ENV];
    } else {
      process.env[TEMPLATE_PATH_ENV] = previousTemplatePath;
    }
    await fs.rm(dataDir, { recursive: true, force: true });
  };
}
