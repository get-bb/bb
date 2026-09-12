import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  isPluginOwnedIconPath,
  pluginPackageJsonSchema,
  type PluginPackageJson,
} from "@bb/domain";
import {
  assertValidPluginCompactIconSvg,
  assertValidPluginIconSvg,
  assertValidPluginLogoSvg,
} from "./svg-asset.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readPluginPackageJsonFile(
  packageJsonPath: string,
): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(packageJsonPath, "utf8");
  } catch {
    throw new Error(`no readable package.json at ${packageJsonPath}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`package.json is not valid JSON at ${packageJsonPath}`);
  }
}

export function resolveManifestPath(
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

export async function resolveManifestEntryFile(
  rootDir: string,
  entry: string,
  label: string,
): Promise<string> {
  const resolved = resolveManifestPath(rootDir, entry, label);
  try {
    await stat(resolved);
  } catch {
    throw new Error(`manifest ${label} points at a missing file: ${entry}`);
  }
  return resolved;
}

export async function resolveManifestAssetFile(
  rootDir: string,
  assetPath: string,
  label: string,
): Promise<string> {
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
  return realAsset;
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
  const compactIcon =
    parsed.data.bb.branding.icon !== undefined &&
    isPluginOwnedIconPath(parsed.data.bb.branding.icon)
      ? parsed.data.bb.branding.icon
      : undefined;
  for (const [label, entry] of [
    ["bb.branding.icon", compactIcon],
    ["bb.branding.logo.light", logo?.light],
    ["bb.branding.logo.dark", logo?.dark],
  ] as const) {
    if (entry === undefined) continue;
    if (!/\.(svg|png|webp)$/i.test(entry)) {
      throw new Error(
        `manifest ${label} must point at a .svg, .png, or .webp file, got "${entry}"`,
      );
    }
    const realAsset = await resolveManifestAssetFile(
      rootDir,
      resolveManifestPath(rootDir, entry, label),
      label,
    );
    if (label === "bb.branding.icon") {
      assertValidPluginCompactIconSvg(await readFile(realAsset), label);
    } else if (/\.svg$/iu.test(entry)) {
      assertValidPluginLogoSvg(
        await readFile(realAsset),
        `manifest ${label} (${JSON.stringify(entry)})`,
      );
    }
  }
  for (const [name, entry] of Object.entries(
    parsed.data.bb.branding.experimental_icons ?? {},
  )) {
    const label = `bb.branding.experimental_icons["${name}"]`;
    const realAsset = await resolveManifestAssetFile(
      rootDir,
      resolveManifestPath(rootDir, entry, label),
      label,
    );
    assertValidPluginIconSvg(await readFile(realAsset), label);
  }
  return parsed.data;
}
