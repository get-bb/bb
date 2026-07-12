import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import semver from "semver";
import { z } from "zod";
import { derivePluginId } from "@bb/domain";

/**
 * The `bb` field of a plugin's package.json. `server` is the backend entry
 * (factory default export). `app` is the optional frontend entry (compiled by
 * `bb plugin build`; unused until the frontend runtime phase). `skills`
 * relocates/filters the auto-imported `skills/` convention directory. `logo`
 * relocates the auto-detected `logo.(svg|png|webp)` root file; `logoDark`
 * does the same for the optional dark-theme variant (`logo-dark.*`). `icon`
 * is a host icon-name hint used when the plugin ships no logo.
 */
const bbManifestFieldSchema = z.object({
  server: z.string().min(1),
  app: z.string().min(1).optional(),
  /**
   * Human, Title-Case name for the settings nav + detail header (e.g.
   * "Remote access"); falls back to the derived plugin id when absent.
   */
  displayName: z.string().min(1).optional(),
  icon: z.string().min(1).optional(),
  skills: z.array(z.string().min(1)).optional(),
  logo: z.string().min(1).optional(),
  logoDark: z.string().min(1).optional(),
  themes: z
    .array(
      z.object({
        id: z
          .string()
          .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
          .max(64),
        name: z.string().min(1),
        description: z.string().min(1).optional(),
        css: z.string().min(1),
      }),
    )
    .optional(),
});

const pluginPackageJsonSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  engines: z
    .object({
      bb: z.string().min(1).optional(),
      bbPluginSdk: z
        .string()
        .min(1)
        .refine((range) => semver.validRange(range) !== null, {
          message: "must be a valid semver range",
        })
        .optional(),
    })
    .optional(),
  bb: bbManifestFieldSchema,
});

export interface PluginManifest {
  /** Sanitized plugin id derived from the package name. */
  id: string;
  /** Full npm package name. */
  name: string;
  version: string;
  /** package.json description, shown in the Settings → Plugins row. */
  description: string | null;
  /** `bb.displayName` — human nav/header label; null when not declared. */
  displayName: string | null;
  /** `bb.icon` — host icon-name hint; null when not declared. */
  icon: string | null;
  /** semver range from engines.bb, when declared. */
  bbEngineRange: string | undefined;
  /** semver range from engines.bbPluginSdk; absent manifests are legacy. */
  bbPluginSdkRange: string | undefined;
  /** Absolute path of the backend entry file. */
  serverEntry: string;
  /** Absolute path of the frontend entry file, when declared. */
  appEntry: string | undefined;
  /**
   * Absolute path of the sidebar/menu logo declared via `bb.logo` (svg, png,
   * or webp). Undefined when not declared — the loader then auto-detects
   * `logo.svg` / `logo.png` / `logo.webp` at the plugin root.
   */
  logoPath: string | undefined;
  /**
   * Absolute path of the dark-theme logo variant declared via `bb.logoDark`.
   * Undefined when not declared — the loader then auto-detects
   * `logo-dark.svg` / `logo-dark.png` / `logo-dark.webp` at the plugin root.
   */
  logoDarkPath: string | undefined;
  /** CSS palettes declared by `bb.themes`, with manifest-relative paths resolved. */
  themes: Array<{
    id: string;
    name: string;
    description: string | null;
    cssPath: string;
  }>;
  /**
   * Absolute skills-root directories auto-imported as the plugin skills
   * tier (design §4.4). Defaults to `<rootDir>/skills`; `bb.skills` entries
   * relocate the roots (a trailing `/*` is accepted and ignored) and an
   * empty array opts out. Missing directories resolve to no skills.
   */
  skillsRootPaths: string[];
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
  const { name, version, description, engines, bb } = parsed.data;
  const serverEntry = resolveEntry(rootDir, bb.server, "bb.server");
  try {
    await stat(serverEntry);
  } catch {
    throw new Error(
      `manifest bb.server points at a missing file: ${bb.server}`,
    );
  }
  const skillsRootPaths = (bb.skills ?? ["skills"]).map((entry) =>
    resolveEntry(rootDir, entry.replace(/\/\*$/, ""), "bb.skills"),
  );
  const resolveLogoEntry = (
    entry: string | undefined,
    label: string,
  ): string | undefined => {
    if (entry === undefined) return undefined;
    if (!/\.(svg|png|webp)$/i.test(entry)) {
      throw new Error(
        `manifest ${label} must point at a .svg, .png, or .webp file, got "${entry}"`,
      );
    }
    return resolveEntry(rootDir, entry, label);
  };
  const logoPath = resolveLogoEntry(bb.logo, "bb.logo");
  const logoDarkPath = resolveLogoEntry(bb.logoDark, "bb.logoDark");
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
    return {
      id: theme.id,
      name: theme.name,
      description: theme.description ?? null,
      cssPath: resolveEntry(rootDir, theme.css, `bb.themes.${theme.id}.css`),
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
  }
  return {
    id: derivePluginId(name),
    name,
    version,
    description:
      description !== undefined && description.trim().length > 0
        ? description
        : null,
    displayName: bb.displayName ?? null,
    icon: bb.icon ?? null,
    bbEngineRange: engines?.bb,
    bbPluginSdkRange: engines?.bbPluginSdk,
    serverEntry,
    appEntry: bb.app ? resolveEntry(rootDir, bb.app, "bb.app") : undefined,
    logoPath,
    logoDarkPath,
    themes,
    skillsRootPaths,
    rootDir,
  };
}
