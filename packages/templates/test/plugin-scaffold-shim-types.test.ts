import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scaffoldPlugin } from "../src/plugin-scaffold.js";
import { PLUGIN_SHIMMED_TYPE_DEPENDENCIES } from "../src/generated/plugin-starter-files.generated.js";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const appRoot = join(repoRoot, "apps", "app");
const pluginSdkRoot = join(repoRoot, "packages", "plugin-sdk");

/**
 * #2072: `bb plugin build` resolves the shimmed packages (sonner, vaul, the
 * portal radix families, @pierre/diffs, ...) through an esbuild shim, but a
 * plugin's `tsc` resolves them through node_modules like any other import —
 * so the scaffold must declare every one of them for types, not just the ones
 * its starter components happen to use. This scaffolds a plugin, materialises
 * node_modules the way `npm install --include=dev` would (exactly the packages
 * the manifest declares, linked from this workspace so no network is needed),
 * and runs the scaffold's own tsc over an app that imports each shimmed
 * specifier.
 */

/**
 * Where the workspace keeps an installed package. pnpm lays each dependency
 * out as `node_modules/<name>` (a link into the store) under the package that
 * declares it; `require.resolve` is no use for ESM-only packages with a strict
 * exports map (@pierre/diffs).
 */
function workspacePackageRoot(name: string): string {
  for (const base of [appRoot, repoRoot, pluginSdkRoot]) {
    const candidate = join(base, "node_modules", name);
    try {
      readFileSync(join(candidate, "package.json"), "utf8");
      return candidate;
    } catch {
      // not here
    }
  }
  throw new Error(`package not installed in the workspace: ${name}`);
}

async function installDeclaredDependencies(targetDir: string): Promise<void> {
  const manifest: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } = JSON.parse(await readFile(join(targetDir, "package.json"), "utf8"));
  const names = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);
  for (const name of names) {
    const target = join(targetDir, "node_modules", name);
    await mkdir(dirname(target), { recursive: true });
    // The SDK links to the workspace package (bundled-types/ is built by the
    // turbo dependency of this test task).
    const source =
      name === "@get-bb/plugin-sdk"
        ? pluginSdkRoot
        : workspacePackageRoot(name);
    await symlink(source, target, "dir");
  }
}

async function runTsc(
  targetDir: string,
): Promise<{ ok: boolean; output: string }> {
  const tsc = join(workspacePackageRoot("typescript"), "lib", "tsc.js");
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [tsc, "--project", "tsconfig.json"],
      { cwd: targetDir },
    );
    return { ok: true, output: `${stdout}${stderr}` };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string };
    return {
      ok: false,
      output: `${failed.stdout ?? ""}${failed.stderr ?? ""}`,
    };
  }
}

/**
 * Every shimmed specifier a plugin may import, including subpath exports —
 * the build's table is keyed by specifier, the manifest by package, and a
 * package can declare types for its root but not a subpath.
 */
const SHIMMED_SPECIFIERS = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  ...Object.keys(PLUGIN_SHIMMED_TYPE_DEPENDENCIES),
  "@pierre/diffs/react",
];

describe("scaffold typechecks the runtime-shimmed imports (#2072)", () => {
  let workDir: string;
  let targetDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "bb-scaffold-shims-"));
    targetDir = join(workDir, "bb-plugin-toasty");
    await scaffoldPlugin({
      targetDir,
      packageName: "bb-plugin-toasty",
      bbVersion: "0.39.0",
    });
    await installDeclaredDependencies(targetDir);
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('the documented `import { toast } from "sonner"` and every other shimmed specifier resolve', async () => {
    const appPath = join(targetDir, "app.tsx");
    const app = await readFile(appPath, "utf8");
    // Add the documented import ahead of the scaffold's own imports so the
    // test does not depend on which React names the starter page uses.
    const firstImport = app.indexOf("\nimport ");
    expect(firstImport).toBeGreaterThan(-1);
    await writeFile(
      appPath,
      `${app.slice(0, firstImport + 1)}import { toast } from "sonner";\ntoast.success("hi");\n${app.slice(firstImport + 1)}`,
    );
    const lines = SHIMMED_SPECIFIERS.map(
      (specifier, i) => `import * as m${i} from "${specifier}";`,
    );
    lines.push(
      `export const all = [${SHIMMED_SPECIFIERS.map((_, i) => `m${i}`).join(", ")}];`,
    );
    await writeFile(
      join(targetDir, "components", "all-shims.ts"),
      `${lines.join("\n")}\n`,
    );

    const result = await runTsc(targetDir);

    // Before the fix: "error TS2307: Cannot find module 'sonner' or its
    // corresponding type declarations." for sonner, vaul, @pierre/diffs and
    // nine radix families — every shim the starter components did not import.
    const missing = [
      ...result.output.matchAll(/Cannot find module '([^']+)'/g),
    ].map((m) => m[1]);
    expect(missing, result.output).toEqual([]);
    expect(result.output).toBe("");
    expect(result.ok).toBe(true);
  }, 120_000);
});
