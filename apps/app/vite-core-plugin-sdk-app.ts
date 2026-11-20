import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePath, type Plugin } from "vite";

const appDir = dirname(fileURLToPath(import.meta.url));
const PLUGIN_RUNTIME_IMPORTERS =
  /(?:\.test\.[cm]?[jt]sx?|\.stories\.tsx)$|\/src\/test\//u;

export function corePluginSdkApp(): Plugin {
  const appSourcePrefix = `${normalizePath(resolve(appDir, "src"))}/`;
  const binding = resolve(appDir, "src/lib/core-plugin-sdk-app.ts");
  return {
    name: "bb:core-plugin-sdk-app",
    enforce: "pre",
    resolveId(source, importer) {
      if (source !== "@get-bb/plugin-sdk/app" || importer === undefined) {
        return null;
      }
      const normalizedImporter = normalizePath(importer);
      if (
        !normalizedImporter.startsWith(appSourcePrefix) ||
        PLUGIN_RUNTIME_IMPORTERS.test(normalizedImporter)
      ) {
        return null;
      }
      return binding;
    },
  };
}
