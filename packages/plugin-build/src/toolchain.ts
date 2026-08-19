import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { omitNpmScriptPolicyEnv } from "@bb/process-utils";

const run = promisify(execFile);

/**
 * Exact versions bb builds plugin bundles with. Pinned rather than ranged so
 * a fetched toolchain is reproducible and its directory name is stable.
 * Bump deliberately; {@link toolchainCacheDir} keys off these, so a bump
 * installs alongside the old set instead of mutating it.
 */
export const PLUGIN_TOOLCHAIN_PINS = {
  esbuild: "0.28.1",
  "@tailwindcss/node": "4.3.0",
  "@tailwindcss/oxide": "4.3.0",
  tailwindcss: "4.3.0",
} as const;

/**
 * Everything the build functions need from outside their own package.
 *
 * The three module fields are specifiers passed to `import()`. `tailwindCssDir`
 * is a directory rather than a module because Tailwind's CSS entry points
 * (`index.css`, `theme.css`, …) are resolved by name at compile time, and the
 * package holding them lives wherever the toolchain does — which, for a
 * shipped server, is neither the plugin nor bb's own bundle.
 */
export interface PluginBuildToolchain {
  esbuild: string;
  tailwindNode: string;
  tailwindOxide: string;
  tailwindCssDir: string;
}

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

/**
 * Directory of an installed package, found by walking up from its resolved
 * entry point.
 *
 * `require.resolve(`${name}/package.json`)` is not usable: packages with an
 * `exports` map (all four pins) may not expose it.
 */
function packageDir(require: NodeRequire, name: string): string | null {
  let dir: string;
  try {
    dir = dirname(require.resolve(name));
  } catch {
    return null;
  }
  for (let depth = 0; depth < 10; depth += 1) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          (parsed as { name?: unknown }).name === name
        ) {
          return dir;
        }
      } catch {
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function readVersion(require: NodeRequire, name: string): string | null {
  const dir = packageDir(require, name);
  if (dir === null) return null;
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf8"),
    );
    const version =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { version?: unknown }).version
        : undefined;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/**
 * Build a toolchain from `require`, or null if any package is missing or is
 * not the pinned version.
 *
 * Version equality matters: the build emits artifacts whose compatibility bb
 * later validates, and an unpinned local Tailwind or esbuild would silently
 * produce bundles the pinned set would not.
 */
function toolchainFrom(require: NodeRequire): PluginBuildToolchain | null {
  for (const [name, pinned] of Object.entries(PLUGIN_TOOLCHAIN_PINS)) {
    if (readVersion(require, name) !== pinned) return null;
  }
  try {
    const tailwindCssDir = packageDir(require, "tailwindcss");
    if (tailwindCssDir === null) return null;
    return {
      esbuild: pathToFileURL(require.resolve("esbuild")).href,
      tailwindNode: pathToFileURL(require.resolve("@tailwindcss/node")).href,
      tailwindOxide: pathToFileURL(require.resolve("@tailwindcss/oxide")).href,
      tailwindCssDir,
    };
  } catch {
    return null;
  }
}

/**
 * The toolchain as resolved from this package's own dependencies, or null.
 *
 * Non-null in the monorepo and in tests, where these are devDependencies of
 * `@bb/plugin-build`. Null in a shipped server, CLI, or desktop app, which
 * carry none of them — those fetch. Checked first so development never pays a
 * download and never gets a second copy of a toolchain it already has.
 */
function resolveLocalToolchain(): PluginBuildToolchain | null {
  return toolchainFrom(createRequire(import.meta.url));
}

async function isInstalled(dir: string): Promise<boolean> {
  try {
    const raw = await readFile(join(dir, ".bb-toolchain.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { pins?: unknown }).pins !== pinKey()
    ) {
      return false;
    }
  } catch {
    return false;
  }
  // The marker is written last, but a half-deleted cache can outlive it.
  return toolchainFrom(createRequire(join(dir, "noop.js"))) !== null;
}

/**
 * Ensure the pinned toolchain exists under `baseDir` and return specifiers the
 * build functions can import.
 *
 * bb installs its own pinned packages here — never plugin code — so this runs
 * with `--ignore-scripts` and touches no plugin-authored script.
 *
 * Cross-process safe: a server and a CLI can race here. Each installs into a
 * private staging directory and promotes by rename, so npm never has two
 * writers in one prefix and a reader never sees a partial tree. A loser of the
 * race discards its own copy and uses the winner's.
 */
export async function resolvePluginBuildToolchain(
  baseDir: string,
  options?: {
    onFetchStart?: () => void;
    /** Called once the toolchain is on disk and verified, with elapsed ms. */
    onFetchDone?: (elapsedMs: number) => void;
    ignoreLocal?: boolean;
  },
): Promise<PluginBuildToolchain> {
  if (options?.ignoreLocal !== true) {
    const local = resolveLocalToolchain();
    if (local !== null) return local;
  }

  const dir = toolchainCacheDir(baseDir);
  if (await isInstalled(dir)) {
    const cached = toolchainFrom(createRequire(join(dir, "noop.js")));
    if (cached !== null) return cached;
  }

  options?.onFetchStart?.();
  const startedAt = Date.now();
  const staging = `${dir}.staging-${randomUUID()}`;
  try {
    await mkdir(staging, { recursive: true });
    // A package.json stops npm walking up and adopting an ancestor project's
    // configuration or lockfile.
    await writeFile(
      join(staging, "package.json"),
      `${JSON.stringify({ name: "bb-plugin-toolchain", private: true, version: "0.0.0" }, null, 2)}\n`,
    );
    await run(
      "npm",
      [
        "install",
        "--prefix",
        staging,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        ...Object.entries(PLUGIN_TOOLCHAIN_PINS).map(
          ([name, version]) => `${name}@${version}`,
        ),
      ],
      {
        maxBuffer: 1024 * 1024 * 16,
        // Script policy is bb's (`--ignore-scripts` above); an inherited
        // `npm_config_allow_scripts` would make npm refuse the install.
        env: omitNpmScriptPolicyEnv(process.env),
      },
    );
    const staged = toolchainFrom(createRequire(join(staging, "noop.js")));
    if (staged === null) {
      throw new Error(
        "the downloaded plugin build toolchain is incomplete or misversioned",
      );
    }
    await writeFile(
      join(staging, ".bb-toolchain.json"),
      `${JSON.stringify({ pins: pinKey() }, null, 2)}\n`,
    );
    await mkdir(dirname(dir), { recursive: true });
    try {
      await rename(staging, dir);
    } catch {
      // Another process promoted first, or the rename crossed a device.
      // Either way its tree is equivalent — verify and use it.
      if (!(await isInstalled(dir))) throw new Error(errorPromoting(dir));
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }

  const promoted = toolchainFrom(createRequire(join(dir, "noop.js")));
  if (promoted === null) throw new Error(errorPromoting(dir));
  options?.onFetchDone?.(Date.now() - startedAt);
  return promoted;
}

function errorPromoting(dir: string): string {
  return `could not install the plugin build toolchain into ${dir}`;
}
