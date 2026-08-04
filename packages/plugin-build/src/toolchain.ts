import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Exact versions bb builds plugin bundles with. Pinned rather than ranged so
 * a fetched toolchain is reproducible and its directory name is stable.
 * Bump deliberately; `toolchainCacheDir` keys off these, so a bump installs
 * alongside the old set instead of mutating it.
 */
export const PLUGIN_TOOLCHAIN_PINS = {
  esbuild: "0.28.1",
  "@tailwindcss/node": "4.3.0",
  "@tailwindcss/oxide": "4.3.0",
  tailwindcss: "4.3.0",
} as const;

/**
 * Module specifiers the build functions import. Defaults to bare names, which
 * resolve from the caller's own `node_modules` — that is how the monorepo
 * build scripts run, since they have the packages as devDependencies. The
 * server and CLI instead pass paths from {@link resolvePluginBuildToolchain},
 * so shipped artifacts carry no platform binaries.
 */
export interface PluginBuildToolchain {
  esbuild: string;
  tailwindNode: string;
  tailwindOxide: string;
}

export const BARE_PLUGIN_BUILD_TOOLCHAIN: PluginBuildToolchain = {
  esbuild: "esbuild",
  tailwindNode: "@tailwindcss/node",
  tailwindOxide: "@tailwindcss/oxide",
};

function pinKey(): string {
  return Object.entries(PLUGIN_TOOLCHAIN_PINS)
    .map(([name, version]) => `${name}@${version}`)
    .sort()
    .join(",");
}

/**
 * Directory holding one pinned toolchain set. Keyed by the pins themselves so
 * upgrading bb installs a fresh set beside the old one rather than mutating a
 * directory a concurrent build may be importing from.
 */
export function toolchainCacheDir(baseDir: string): string {
  const key = Object.values(PLUGIN_TOOLCHAIN_PINS).join("-");
  return join(baseDir, `toolchain-${key}`);
}

async function isInstalled(dir: string): Promise<boolean> {
  try {
    const raw = await readFile(join(dir, ".bb-toolchain.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { pins?: unknown }).pins === pinKey()
    );
  } catch {
    return false;
  }
}

/**
 * The toolchain as resolved from this package's own dependencies, or null.
 *
 * Non-null in the monorepo and anywhere the packages happen to be installed,
 * where they are devDependencies of `@bb/plugin-build`. Null in a shipped
 * server, CLI, or desktop app, which carry none of them — those fetch.
 *
 * Checked first so development and tests never pay a download, and so a
 * machine that already has a usable toolchain does not get a second copy.
 */
function resolveLocalToolchain(): PluginBuildToolchain | null {
  try {
    const require = createRequire(import.meta.url);
    return {
      esbuild: pathToFileURL(require.resolve("esbuild")).href,
      tailwindNode: pathToFileURL(require.resolve("@tailwindcss/node")).href,
      tailwindOxide: pathToFileURL(require.resolve("@tailwindcss/oxide")).href,
    };
  } catch {
    return null;
  }
}

function resolveFrom(dir: string, specifier: string): string {
  // A file URL, not a path: `await import()` of a bare Windows path fails.
  const require = createRequire(join(dir, "noop.js"));
  return pathToFileURL(require.resolve(specifier)).href;
}

/**
 * Ensure the pinned toolchain exists under `baseDir` and return specifiers the
 * build functions can import.
 *
 * bb installs its own pinned packages here — never plugin code — so this runs
 * with `--ignore-scripts` and touches no plugin-authored script. The first
 * call for a given pin set downloads; later calls resolve from disk and do no
 * network work.
 */
export async function resolvePluginBuildToolchain(
  baseDir: string,
  options?: { onFetchStart?: () => void },
): Promise<PluginBuildToolchain> {
  const local = resolveLocalToolchain();
  if (local !== null) return local;
  const dir = toolchainCacheDir(baseDir);
  if (!(await isInstalled(dir))) {
    options?.onFetchStart?.();
    await mkdir(dir, { recursive: true });
    // A package.json keeps npm from walking up and adopting an ancestor
    // project's configuration or lockfile.
    await writeFile(
      join(dir, "package.json"),
      `${JSON.stringify({ name: "bb-plugin-toolchain", private: true, version: "0.0.0" }, null, 2)}\n`,
    );
    await run(
      "npm",
      [
        "install",
        "--prefix",
        dir,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        ...Object.entries(PLUGIN_TOOLCHAIN_PINS).map(
          ([name, version]) => `${name}@${version}`,
        ),
      ],
      { maxBuffer: 1024 * 1024 * 16 },
    );
    await writeFile(
      join(dir, ".bb-toolchain.json"),
      `${JSON.stringify({ pins: pinKey() }, null, 2)}\n`,
    );
  }
  return {
    esbuild: resolveFrom(dir, "esbuild"),
    tailwindNode: resolveFrom(dir, "@tailwindcss/node"),
    tailwindOxide: resolveFrom(dir, "@tailwindcss/oxide"),
  };
}
