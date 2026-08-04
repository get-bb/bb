import { join } from "node:path";
import {
  resolvePluginBuildToolchain,
  type PluginBuildToolchain,
} from "@bb/plugin-build";
import type { PluginServiceDeps } from "./plugin-service-internal.js";

/**
 * In-flight/settled toolchain per data dir. Holding the promise (not the
 * result) means concurrent installs share one fetch instead of racing npm
 * into the same directory. Keyed by data dir because tests run several
 * servers in one process.
 */
const byDataDir = new Map<string, Promise<PluginBuildToolchain>>();

/**
 * Resolve the pinned esbuild/Tailwind set bb builds plugin bundles with,
 * downloading it on first use.
 *
 * Shipped artifacts carry no build toolchain: it is fetched into
 * `<dataDir>/plugins/toolchain-<pins>/` the first time a `git:` or `path:`
 * plugin is actually built. Installing a prebuilt `npm:` plugin, or loading a
 * builtin, never reaches this.
 */
export async function getPluginBuildToolchain(
  args: Pick<PluginServiceDeps, "dataDir" | "logger">,
): Promise<PluginBuildToolchain> {
  const existing = byDataDir.get(args.dataDir);
  if (existing !== undefined) return existing;
  const pending = resolvePluginBuildToolchain(join(args.dataDir, "plugins"), {
    onFetchStart: () => {
      args.logger.info(
        "downloading the plugin build toolchain (first plugin build on this machine)",
      );
    },
    onFetchDone: (elapsedMs) => {
      args.logger.info(
        `plugin build toolchain ready in ${Math.round(elapsedMs / 100) / 10}s`,
      );
    },
  });
  byDataDir.set(args.dataDir, pending);
  try {
    return await pending;
  } catch (error) {
    // A failed fetch must not poison later installs — the next one retries.
    byDataDir.delete(args.dataDir);
    throw error;
  }
}
