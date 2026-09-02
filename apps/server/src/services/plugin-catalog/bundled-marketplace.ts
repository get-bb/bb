import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BundledPluginRegistration } from "../plugins/builtin-registry.js";
import {
  BUNDLED_MARKETPLACE_NAME,
  isBundledMarketplaceEntry,
  parseBundledMarketplaceManifestJson,
  type MarketplaceManifestV2,
} from "./marketplace-manifest.js";

const MARKETPLACE_FILENAME = "marketplace.json";
const GENERATED_MARKETPLACE_DIRECTORY = "bb-official-marketplace";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export function resolveBundledMarketplaceDirectory(
  baseDirectory = moduleDirectory,
): string {
  const candidates = [
    path.resolve(baseDirectory, "builtin-plugins"),
    path.resolve(
      baseDirectory,
      "../../generated",
      GENERATED_MARKETPLACE_DIRECTORY,
    ),
    path.resolve(
      baseDirectory,
      "../src/generated",
      GENERATED_MARKETPLACE_DIRECTORY,
    ),
  ];
  return (
    candidates.find((candidate) =>
      existsSync(path.join(candidate, MARKETPLACE_FILENAME)),
    ) ?? candidates[1]
  );
}

export function loadBundledMarketplace(
  plugins: readonly BundledPluginRegistration[],
): { catalog: MarketplaceManifestV2; directory: string; manifestJson: string } {
  const directory = resolveBundledMarketplaceDirectory();
  const manifestPath = path.join(directory, MARKETPLACE_FILENAME);
  const catalog = parseBundledMarketplaceManifestJson(
    readFileSync(manifestPath, "utf8"),
    `${BUNDLED_MARKETPLACE_NAME} marketplace catalog`,
  );
  const names = new Set(plugins.map((plugin) => plugin.name));
  const filtered = {
    ...catalog,
    plugins: catalog.plugins.filter(
      (entry) =>
        isBundledMarketplaceEntry(entry) &&
        names.has(entry.source.bundled.plugin),
    ),
  };
  return {
    catalog: filtered,
    directory,
    manifestJson: JSON.stringify(filtered),
  };
}
