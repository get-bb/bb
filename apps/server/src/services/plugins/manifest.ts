import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import semver from "semver";
import {
  derivePluginId,
  isCodeThemeFilePath,
  isPluginOwnedIconPath,
  pluginPackageJsonSchema,
  type UiCodeThemeDeclaration,
} from "@bb/domain";
import { resolvePluginCodeThemePath } from "../system/code-themes.js";
import {
  readPluginPackageJsonFile,
  resolveManifestAssetFile,
  resolveManifestEntryFile,
  resolveManifestPath,
  assertValidPluginCompactIconSvg,
  assertValidPluginIconSvg,
} from "@bb/plugin-build";

export interface PluginManifest {
  id: string;
  packageName: string;
  version: string;
  name: string;
  description: string;
  branding: {
    icon?: string;
    compactIconPath?: string;
    logo?: {
      lightPath: string;
      darkPath?: string;
    };
    icons: ReadonlyMap<string, string>;
  };
  bbEngineRange: string | undefined;
  bbPluginSdkRange: string | undefined;
  serverEntry: string;
  appEntry: string | undefined;
  hostEntry: string | undefined;
  themes: Array<{
    id: string;
    name: string;
    description: string | null;
    cssPath: string;
    codeTheme: UiCodeThemeDeclaration | null;
    codeThemePaths: { dark?: string; light?: string };
  }>;
  skillsRootPaths: string[];
  skillNames: string[];
  rootDir: string;
}

async function readSkillNames(rootPaths: string[]): Promise<string[]> {
  const names = new Set<string>();
  for (const rootPath of rootPaths) {
    let entries;
    try {
      entries = await readdir(rootPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const skillFile = await lstat(join(rootPath, entry.name, "SKILL.md"));
        if (!skillFile.isFile()) continue;
      } catch {
        continue;
      }
      names.add(entry.name);
    }
  }
  return [...names].sort();
}

export async function readPluginManifest(
  rootDir: string,
): Promise<PluginManifest> {
  const packageJsonPath = join(rootDir, "package.json");
  const json = await readPluginPackageJsonFile(packageJsonPath);
  const parsed = pluginPackageJsonSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") ?? "";
    throw new Error(
      `invalid plugin package.json${path ? ` (${path})` : ""}: ${issue?.message ?? "unknown error"}`,
    );
  }
  const { name: packageName, version, engines, bb } = parsed.data;
  if (
    engines?.bbPluginSdk !== undefined &&
    semver.validRange(engines.bbPluginSdk) === null
  ) {
    throw new Error(
      "invalid plugin package.json (engines.bbPluginSdk): must be a valid semver range",
    );
  }
  const serverEntry = await resolveManifestEntryFile(
    rootDir,
    bb.server,
    "bb.server",
  );
  const hostEntry = bb.host
    ? await resolveManifestEntryFile(rootDir, bb.host, "bb.host")
    : undefined;
  const skillsRootPaths = (bb.skills ?? ["skills"]).map((entry) =>
    resolveManifestPath(rootDir, entry.replace(/\/\*$/, ""), "bb.skills"),
  );
  const resolveBrandingAsset = (entry: string, label: string): string => {
    if (!/\.(svg|png|webp)$/i.test(entry)) {
      throw new Error(
        `manifest ${label} must point at a .svg, .png, or .webp file, got "${entry}"`,
      );
    }
    return resolveManifestPath(rootDir, entry, label);
  };
  const brandingLogo =
    bb.branding.logo === undefined
      ? undefined
      : {
          lightPath: resolveBrandingAsset(
            bb.branding.logo.light,
            "bb.branding.logo.light",
          ),
          ...(bb.branding.logo.dark === undefined
            ? {}
            : {
                darkPath: resolveBrandingAsset(
                  bb.branding.logo.dark,
                  "bb.branding.logo.dark",
                ),
              }),
        };
  const brandingCompactIconPath =
    bb.branding.icon !== undefined && isPluginOwnedIconPath(bb.branding.icon)
      ? resolveBrandingAsset(bb.branding.icon, "bb.branding.icon")
      : undefined;
  for (const [label, assetPath] of [
    ["bb.branding.icon", brandingCompactIconPath],
    ["bb.branding.logo.light", brandingLogo?.lightPath],
    ["bb.branding.logo.dark", brandingLogo?.darkPath],
  ] as const) {
    if (assetPath === undefined) continue;
    const realAsset = await resolveManifestAssetFile(rootDir, assetPath, label);
    if (label === "bb.branding.icon") {
      assertValidPluginCompactIconSvg(await readFile(realAsset), label);
    }
  }
  const brandingIcons = new Map<string, string>();
  for (const [name, entry] of Object.entries(
    bb.branding.experimental_icons ?? {},
  )) {
    const label = `bb.branding.experimental_icons["${name}"]`;
    const realAsset = await resolveManifestAssetFile(
      rootDir,
      resolveManifestPath(rootDir, entry, label),
      label,
    );
    assertValidPluginIconSvg(await readFile(realAsset), label);
    brandingIcons.set(name, realAsset);
  }
  const themeIds = new Set<string>();
  const themes = (bb.themes ?? []).map((theme) => {
    if (themeIds.has(theme.id)) {
      throw new Error(`manifest bb.themes contains duplicate id "${theme.id}"`);
    }
    themeIds.add(theme.id);
    if (!theme.css.toLowerCase().endsWith(".css")) {
      throw new Error(
        `manifest bb.themes theme "${theme.id}" must point at a .css file`,
      );
    }
    const codeTheme = theme.codeTheme ?? null;
    const codeThemePaths: { dark?: string; light?: string } = {};
    if (codeTheme?.dark !== undefined && isCodeThemeFilePath(codeTheme.dark)) {
      codeThemePaths.dark = resolvePluginCodeThemePath(
        rootDir,
        theme.id,
        "dark",
        codeTheme.dark,
      );
    }
    if (
      codeTheme?.light !== undefined &&
      isCodeThemeFilePath(codeTheme.light)
    ) {
      codeThemePaths.light = resolvePluginCodeThemePath(
        rootDir,
        theme.id,
        "light",
        codeTheme.light,
      );
    }
    return {
      id: theme.id,
      name: theme.name,
      description: theme.description ?? null,
      cssPath: resolveManifestPath(rootDir, theme.css, `bb.themes.${theme.id}.css`),
      codeTheme,
      codeThemePaths,
    };
  });
  for (const theme of themes) {
    try {
      await stat(theme.cssPath);
    } catch {
      throw new Error(
        `manifest bb.themes theme "${theme.id}" points at a missing file`,
      );
    }
    for (const [side, path] of Object.entries(theme.codeThemePaths)) {
      try {
        await stat(path);
      } catch {
        throw new Error(
          `manifest bb.themes theme "${theme.id}" codeTheme.${side} points at a missing file`,
        );
      }
    }
  }
  return {
    id: derivePluginId(packageName),
    packageName,
    version,
    name: bb.name,
    description: bb.description,
    branding: {
      ...(bb.branding.icon === undefined ? {} : { icon: bb.branding.icon }),
      ...(brandingCompactIconPath === undefined
        ? {}
        : { compactIconPath: brandingCompactIconPath }),
      ...(brandingLogo === undefined ? {} : { logo: brandingLogo }),
      icons: brandingIcons,
    },
    bbEngineRange: engines?.bb,
    bbPluginSdkRange: engines?.bbPluginSdk,
    serverEntry,
    appEntry: bb.app ? resolveManifestPath(rootDir, bb.app, "bb.app") : undefined,
    hostEntry,
    themes,
    skillsRootPaths,
    skillNames: await readSkillNames(skillsRootPaths),
    rootDir,
  };
}
