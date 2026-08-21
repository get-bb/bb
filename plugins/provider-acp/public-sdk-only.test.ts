/**
 * The first-party ACP plugin has no privilege: it reaches every capability
 * through the public SDK alone, exactly as a third-party ACP plugin (Amp)
 * would. No file in this package may import a private `@bb/*` workspace
 * package — not the plugin code, not the tests. Plugin code may import only
 * `@get-bb/plugin-sdk` (and its published subpaths), `zod`, node built-ins,
 * and its own files; tests may add the published testing kit and the test
 * runner.
 *
 * A `@bb/*` import would still typecheck and run inside this monorepo, which
 * is exactly why it needs a test: the workspace hides the privilege. This is
 * the same guard the echo-provider canary carries (#2189).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = dirname(fileURLToPath(import.meta.url));

const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist"]);
const SOURCE_EXTENSIONS = /\.(?:[cm]?[jt]s|tsx)$/u;

/** Specifiers plugin code (server, host) may import. */
const PLUGIN_IMPORT_ALLOWLIST = [
  /^@get-bb\/plugin-sdk$/u,
  /^@get-bb\/plugin-sdk\/(?:provider-bridge|host|app)$/u,
  /^@get-bb\/plugin-sdk\/provider-bridge\/acp$/u,
  /^@get-bb\/plugin-sdk\/host$/u,
  /^zod$/u,
  /^node:/u,
  /^\.\.?\//u,
];

/** What a test file may import beyond the plugin allowlist. */
const TEST_IMPORT_ALLOWLIST = [
  /^@get-bb\/plugin-sdk\/provider-bridge\/testing$/u,
  /^vitest$/u,
];

const IMPORT_SPECIFIER_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/gu;

function listSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...listSourceFiles(join(directory, entry.name)));
      }
      continue;
    }
    if (SOURCE_EXTENSIONS.test(entry.name)) {
      files.push(join(directory, entry.name));
    }
  }
  return files;
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(IMPORT_SPECIFIER_PATTERN)].map(
    (match) => match[1] ?? "",
  );
}

function isTestFile(path: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/u.test(path);
}

describe("provider-acp imports only the public SDK", () => {
  const files = listSourceFiles(packageRoot);

  it("scans the plugin's source files", () => {
    const names = files.map((file) => relative(packageRoot, file));
    expect(names).toContain("server.ts");
    expect(names).toContain(join("src", "host.ts"));
  });

  for (const file of files) {
    const name = relative(packageRoot, file);
    it(`${name} has no @bb/* import and stays inside the allowlist`, () => {
      const source = readFileSync(file, "utf8");
      const specifiers = importSpecifiers(source);
      const privateImports = specifiers.filter((specifier) =>
        specifier.startsWith("@bb/"),
      );
      expect(privateImports, `${name} imports private packages`).toEqual([]);

      const allowlist = isTestFile(file)
        ? [...PLUGIN_IMPORT_ALLOWLIST, ...TEST_IMPORT_ALLOWLIST]
        : PLUGIN_IMPORT_ALLOWLIST;
      const disallowed = specifiers.filter(
        (specifier) => !allowlist.some((pattern) => pattern.test(specifier)),
      );
      expect(disallowed, `${name} imports outside the allowlist`).toEqual([]);
    });
  }

  it("declares no @bb/* dependency in package.json", () => {
    const manifest = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ];
    expect(declared.filter((name) => name.startsWith("@bb/"))).toEqual([]);
  });
});
