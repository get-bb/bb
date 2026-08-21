import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  PLUGIN_SERVER_EXTERNALS,
  RUNTIME_SLOT_BY_SPECIFIER,
} from "@bb/plugin-build";
import { scaffoldPlugin } from "@bb/templates/plugin-scaffold";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * A scaffold that imports a package it declares as a devDependency is
 * unbuildable the moment something installs without dev deps — and that is the
 * common case, not the exotic one: the packaged CLI runs with
 * NODE_ENV=production (npm reads it as `omit=dev`), and the server installs
 * git: plugins with an explicit `--omit=dev`. Issue #1133 was exactly this,
 * with `zod` in devDependencies while `server.ts` imported it.
 *
 * The rule is derived from the build's own externals/shim lists rather than
 * restated here, so adding a shim or an external cannot leave this stale.
 * Lives in the CLI because `bb plugin new` writes the scaffold and
 * `bb plugin build` consumes it; @bb/templates cannot depend on
 * @bb/plugin-build without a workspace cycle.
 */

const DIRS_WITHOUT_BUNDLED_SOURCE = new Set([
  "node_modules",
  "dist",
  // Vendored SDK declarations, if a pre-npm plugin still carries them — the
  // npm types they reference are devDependencies by design.
  "types",
  "skills",
]);

async function generatedSourceFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!DIRS_WITHOUT_BUNDLED_SOURCE.has(entry.name)) {
          await walk(entryPath);
        }
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        files.push(entryPath);
      }
    }
  }
  await walk(rootDir);
  return files;
}

/** Bare npm specifiers a generated file imports (not relative, alias, builtin). */
function importedSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  for (const match of source.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)) {
    const specifier = match[1];
    if (
      specifier === undefined ||
      specifier.startsWith(".") ||
      specifier.startsWith("@/") ||
      specifier.startsWith("node:")
    ) {
      continue;
    }
    specifiers.add(specifier);
  }
  return [...specifiers];
}

/** The npm package owning a specifier: `react/jsx-runtime` → `react`. */
function packageNameOf(specifier: string): string {
  const segments = specifier.split("/");
  return specifier.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : (segments[0] ?? specifier);
}

async function scaffoldWithDependencies(args: {
  workDir: string;
  app: boolean;
}): Promise<{ targetDir: string; dependencies: string[] }> {
  const packageName = `bb-plugin-${args.app ? "app" : "headless"}`;
  const targetDir = join(args.workDir, packageName);
  await scaffoldPlugin({
    targetDir,
    packageName,
    bbVersion: "0.9.0",
    app: args.app,
  });
  const manifest: { dependencies?: Record<string, string> } = JSON.parse(
    await readFile(join(targetDir, "package.json"), "utf8"),
  );
  return { targetDir, dependencies: Object.keys(manifest.dependencies ?? {}) };
}

describe("scaffold dependency classification", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "bb-scaffold-deps-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it.each([{ app: false }, { app: true }])(
    "declares every bundled import as a dependency (app: $app)",
    async ({ app }) => {
      const { targetDir, dependencies } = await scaffoldWithDependencies({
        workDir,
        app,
      });

      const misdeclared: string[] = [];
      for (const file of await generatedSourceFiles(targetDir)) {
        for (const specifier of importedSpecifiers(
          await readFile(file, "utf8"),
        )) {
          // Swapped for a host runtime shim, or left unresolved for the
          // loader — either way it is never read from node_modules.
          if (specifier in RUNTIME_SLOT_BY_SPECIFIER) continue;
          const packageName = packageNameOf(specifier);
          if (PLUGIN_SERVER_EXTERNALS.includes(packageName)) continue;
          if (dependencies.includes(packageName)) continue;
          misdeclared.push(
            `${relative(targetDir, file)} imports "${specifier}"`,
          );
        }
      }

      expect(misdeclared).toEqual([]);
    },
  );

  it("keeps host-provided packages out of dependencies", async () => {
    const { dependencies } = await scaffoldWithDependencies({
      workDir,
      app: true,
    });

    // Bundling a shimmed package ships a second copy of a singleton (a second
    // React means "Invalid hook call"), and bundling an external defeats the
    // loader alias.
    expect(
      dependencies.filter(
        (name) =>
          name in RUNTIME_SLOT_BY_SPECIFIER ||
          PLUGIN_SERVER_EXTERNALS.includes(name),
      ),
    ).toEqual([]);
  });
});
