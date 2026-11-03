import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pluginPackageJsonSchema } from "@bb/domain";
import { listBundledPluginRegistrations } from "../plugins/builtin-registry.js";

const shippedProviderIds = new Set<string>();
for (const { rootDir } of listBundledPluginRegistrations()) {
  try {
    const manifest = pluginPackageJsonSchema.parse(
      JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")),
    );
    for (const provider of manifest.bb.experimental_providers ?? []) {
      shippedProviderIds.add(provider.id);
    }
  } catch {}
}

export function reportedProviderId(providerId: string): string {
  return shippedProviderIds.has(providerId) ? providerId : "other";
}
