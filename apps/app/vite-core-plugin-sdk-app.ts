import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePath, type Plugin } from "vite";

const appDir = dirname(fileURLToPath(import.meta.url));
const PLUGIN_RUNTIME_IMPORTERS =
  /(?:\.test\.[cm]?[jt]sx?|\.stories\.tsx)$|\/src\/test\//u;

export function corePluginSdkApp(): Plugin {
  const appSourcePrefix = `${normalizePath(resolve(appDir, "src"))}/`;
  const coreContributionPrefix = `${normalizePath(resolve(appDir, "src/core-contributions"))}/`;
  const binding = resolve(appDir, "src/lib/core-plugin-sdk-app.ts");
  const sonnerBinding = resolve(appDir, "src/lib/plugin-sonner.ts");
  return {
    name: "bb:core-plugin-sdk-app",
    enforce: "pre",
    resolveId(source, importer) {
      if (importer === undefined) return null;
      const normalizedImporter = normalizePath(importer);
      if (PLUGIN_RUNTIME_IMPORTERS.test(normalizedImporter)) return null;
      if (source === "@get-bb/plugin-sdk/app") {
        return normalizedImporter.startsWith(appSourcePrefix) ? binding : null;
      }
      if (source === "sonner") {
        return normalizedImporter.startsWith(coreContributionPrefix)
          ? sonnerBinding
          : null;
      }
      return null;
    },
  };
}
