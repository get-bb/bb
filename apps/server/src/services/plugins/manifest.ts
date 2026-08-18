import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import semver from "semver";
import {
  derivePluginId,
  isCodeThemeFilePath,
  isPluginOwnedIconPath,
  pluginPackageJsonSchema,
  type UiCodeThemeDeclaration,
} from "@bb/domain";
import { resolvePluginCodeThemePath } from "../system/code-themes.js";
import { assertValidPluginCompactIconSvg } from "@bb/plugin-build";

export interface PluginManifest {
  /** Sanitized plugin id derived from the package name. */
  id: string;
  /** Full npm package name. */
  packageName: string;
  version: string;
  /** `bb.name` — human name shown in host-rendered plugin surfaces. */
  name: string;
  /** `bb.description` — human description shown in plugin management. */
  description: string;
  /** Explicit plugin branding, resolved to absolute asset paths. */
  branding: {
    /** Declared icon name or plugin-relative compact SVG path. */
    icon?: string;
    /** Resolved plugin-owned compact SVG declared through branding.icon. */
    compactIconPath?: string;
    logo?: {
      lightPath: string;
      darkPath?: string;
    };
  };
  /** semver range from engines.bb, when declared. */
  bbEngineRange: string | undefined;
  /** semver range from engines.bbPluginSdk; absent manifests are legacy. */
  bbPluginSdkRange: string | undefined;
  /** Absolute path of the backend entry file. */
  serverEntry: string;
  /** Absolute path of the frontend entry file, when declared. */
  appEntry: string | undefined;
  /** Absolute path of the host-runtime entry file, when declared. */
  hostEntry: string | undefined;
  /** CSS palettes declared by `bb.themes`, with manifest-relative paths resolved. */
  themes: Array<{
    id: string;
    name: string;
    description: string | null;
    cssPath: string;
    codeTheme: UiCodeThemeDeclaration | null;
    codeThemePaths: { dark?: string; light?: string };
  }>;
  /**
   * Absolute skills-root directories auto-imported as the plugin skills
   * tier (design §4.4). Defaults to `<rootDir>/skills`; `bb.skills` entries
   * relocate the roots (a trailing `/*` is accepted and ignored) and an
   * empty array opts out. Missing directories resolve to no skills.
   */
  skillsRootPaths: string[];
  /**
   * Names of the skills found under `skillsRootPaths`, resolved once here so
   * the frequently-called plugin list never does filesystem work. A skill is a
   * directory containing SKILL.md, and its directory name is its name.
   */
  skillNames: string[];
  rootDir: string;
}

export { derivePluginId } from "@bb/domain";

/** Resolve a manifest-relative entry path, rejecting escapes out of rootDir. */
function resolveEntry(rootDir: string, entry: string, label: string): string {
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

/** Skill directory names under the given roots, sorted and de-duplicated. */
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
        // lstat, not stat: a symlinked SKILL.md is rejected by the skill
        // loader, so counting it here would advertise a skill the agent never
        // loads.
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

/**
 * Read and validate `<rootDir>/package.json` as a plugin manifest. Throws
 * with a human-readable message on any problem — callers map that message
 * onto the plugin's error status.
 */
export async function readPluginManifest(
  rootDir: string,
): Promise<PluginManifest> {
  const packageJsonPath = join(rootDir, "package.json");
  let raw: string;
  try {
    raw = await readFile(packageJsonPath, "utf8");
  } catch {
    throw new Error(`no readable package.json at ${packageJsonPath}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`package.json is not valid JSON at ${packageJsonPath}`);
  }
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
  const serverEntry = resolveEntry(rootDir, bb.server, "bb.server");
  try {
    await stat(serverEntry);
  } catch {
    throw new Error(
      `manifest bb.server points at a missing file: ${bb.server}`,
    );
  }
  const hostEntry = bb.host
    ? resolveEntry(rootDir, bb.host, "bb.host")
    : undefined;
  if (hostEntry !== undefined) {
    try {
      await stat(hostEntry);
    } catch {
      throw new Error(`manifest bb.host points at a missing file: ${bb.host}`);
    }
  }
  const skillsRootPaths = (bb.skills ?? ["skills"]).map((entry) =>
    resolveEntry(rootDir, entry.replace(/\/\*$/, ""), "bb.skills"),
  );
  const resolveBrandingAsset = (entry: string, label: string): string => {
    if (!/\.(svg|png|webp)$/i.test(entry)) {
      throw new Error(
        `manifest ${label} must point at a .svg, .png, or .webp file, got "${entry}"`,
      );
    }
    return resolveEntry(rootDir, entry, label);
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
    if (label === "bb.branding.icon") {
      assertValidPluginCompactIconSvg(await readFile(realAsset), label);
    }
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
      cssPath: resolveEntry(rootDir, theme.css, `bb.themes.${theme.id}.css`),
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
    },
    bbEngineRange: engines?.bb,
    bbPluginSdkRange: engines?.bbPluginSdk,
    serverEntry,
    appEntry: bb.app ? resolveEntry(rootDir, bb.app, "bb.app") : undefined,
    hostEntry,
    themes,
    skillsRootPaths,
    skillNames: await readSkillNames(skillsRootPaths),
    rootDir,
  };
}
