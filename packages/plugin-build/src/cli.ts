import { resolve } from "node:path";
import bbApp from "../../bb-app/package.json" with { type: "json" };
import { preparePluginRuntime } from "./prepare-plugin-runtime.js";
import { resolvePluginBuildToolchain } from "./toolchain.js";

if (process.argv.length !== 3 || process.argv[2] !== "prepare-bundled") {
  throw new Error(
    "Usage: bb-plugin-build prepare-bundled (from a plugin directory)",
  );
}
const sourceRoot = process.cwd();
await preparePluginRuntime({
  sourceRoot,
  targetDir: resolve(sourceRoot, ".bundled-runtime"),
  bbVersion: bbApp.version,
  toolchain: await resolvePluginBuildToolchain(
    resolve(import.meta.dirname, "../node_modules/.bb-toolchain"),
  ),
});
