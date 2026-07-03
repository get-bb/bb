import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";

/**
 * The `bb` field of a plugin's package.json. `server` is the backend entry
 * (factory default export). `app` is the optional frontend entry (compiled by
 * `bb plugin build`; unused until the frontend runtime phase). `skills`
 * relocates/filters the auto-imported `skills/` convention directory. `logo`
 * relocates the auto-detected `logo.(svg|png|webp)` root file; `logoDark`
 * does the same for the optional dark-theme variant (`logo-dark.*`).
 */
const bbManifestFieldSchema = z.object({
  server: z.string().min(1),
  app: z.string().min(1).optional(),
  skills: z.array(z.string().min(1)).optional(),
  logo: z.string().min(1).optional(),
  logoDark: z.string().min(1).optional(),
});

const pluginPackageJsonSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  engines: z.object({ bb: z.string().min(1).optional() }).optional(),
  bb: bbManifestFieldSchema,
});

export interface PluginManifest {
  /** Sanitized plugin id derived from the package name. */
  id: string;
  /** Full npm package name. */
  name: string;
  version: string;
  /** semver range from engines.bb, when declared. */
  bbEngineRange: string | undefined;
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
  /**
   * Absolute skills-root directories auto-imported as the plugin skills
   * tier (design §4.4). Defaults to `<rootDir>/skills`; `bb.skills` entries
   * relocate the roots (a trailing `/*` is accepted and ignored) and an
   * empty array opts out. Missing directories resolve to no skills.
   */
  skillsRootPaths: string[];
  rootDir: string;
}

/**
 * `bb-plugin-linear` → `linear`; scoped names drop the scope. The id
 * namespaces routes, storage, settings, and CLI subcommands.
 */
export function derivePluginId(packageName: string): string {
  const base = packageName.includes("/")
    ? (packageName.split("/").at(-1) ?? packageName)
    : packageName;
  const id = base
    .replace(/^bb-plugin-/, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "");
  if (id.length === 0) {
    throw new Error(`cannot derive a plugin id from package name "${packageName}"`);
  }
  return id;
}

/** Resolve a manifest-relative entry path, rejecting escapes out of rootDir. */
function resolveEntry(rootDir: string, entry: string, label: string): string {
  if (isAbsolute(entry)) {
    throw new Error(`manifest ${label} must be relative, got "${entry}"`);
  }
  const resolved = resolve(rootDir, entry);
  if (resolved !== rootDir && !resolved.startsWith(rootDir + "/")) {
    throw new Error(`manifest ${label} escapes the plugin directory: "${entry}"`);
  }
  return resolved;
}

/**
 * Read and validate `<rootDir>/package.json` as a plugin manifest. Throws
 * with a human-readable message on any problem — callers map that message
 * onto the plugin's error status.
 */
export async function readPluginManifest(rootDir: string): Promise<PluginManifest> {
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
  const { name, version, engines, bb } = parsed.data;
  const serverEntry = resolveEntry(rootDir, bb.server, "bb.server");
  try {
    await stat(serverEntry);
  } catch {
    throw new Error(`manifest bb.server points at a missing file: ${bb.server}`);
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
  return {
    id: derivePluginId(name),
    name,
    version,
    bbEngineRange: engines?.bb,
    serverEntry,
    appEntry: bb.app ? resolveEntry(rootDir, bb.app, "bb.app") : undefined,
    logoPath,
    logoDarkPath,
    skillsRootPaths,
    rootDir,
  };
}
