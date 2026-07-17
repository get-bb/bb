import { realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pluginPackageJsonSchema, type PluginPackageJson } from "@bb/domain";

function resolveManifestPath(
  rootDir: string,
  entry: string,
  label: string,
): string {
  if (isAbsolute(entry)) {
    throw new Error(`manifest ${label} must be relative, got "${entry}"`);
  }
  const resolved = resolve(rootDir, entry);
  if (resolved !== rootDir && !resolved.startsWith(rootDir + "/")) {
    throw new Error(
      `manifest ${label} escapes the plugin directory: "${entry}"`,
    );
  }
  return resolved;
}

export async function validatePluginBuildManifest(
  value: unknown,
  rootDir: string,
  packageJsonPath: string,
): Promise<PluginPackageJson> {
  const parsed = pluginPackageJsonSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") ?? "";
    throw new Error(
      `invalid plugin package.json${path ? ` (${path})` : ""} at ${packageJsonPath}: ${issue?.message ?? "unknown error"}`,
    );
  }
  const logo = parsed.data.bb.branding.logo;
  for (const [label, entry] of [
    ["bb.branding.logo.light", logo?.light],
    ["bb.branding.logo.dark", logo?.dark],
  ] as const) {
    if (entry === undefined) continue;
    if (!/\.(svg|png|webp)$/i.test(entry)) {
      throw new Error(
        `manifest ${label} must point at a .svg, .png, or .webp file, got "${entry}"`,
      );
    }
    const assetPath = resolveManifestPath(rootDir, entry, label);
    let assetStat;
    try {
      assetStat = await stat(assetPath);
    } catch {
      throw new Error(`manifest ${label} points at a missing file`);
    }
    if (!assetStat.isFile()) {
      throw new Error(`manifest ${label} must point at a file`);
    }
    const [realRoot, realAsset] = await Promise.all([
      realpath(rootDir),
      realpath(assetPath),
    ]);
    if (realAsset !== realRoot && !realAsset.startsWith(realRoot + "/")) {
      throw new Error(
        `manifest ${label} escapes the plugin directory through a symlink`,
      );
    }
  }
  return parsed.data;
}
