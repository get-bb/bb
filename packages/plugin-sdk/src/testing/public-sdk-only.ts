/**
 * The rule a plugin proves about itself: it reaches every capability through
 * the public SDK alone. No file in the package may import a private `@bb/*`
 * workspace package — not the plugin code, not the tests — and nothing may
 * import outside the allowlist: `@get-bb/plugin-sdk` and its published
 * subpaths, `zod`, node built-ins, the package's own files, plus whatever
 * public packages the plugin names in `allow`; test files may add the
 * published testing subpaths and the test runner.
 *
 * A `@bb/*` import still typechecks and runs inside bb's own monorepo, which
 * is exactly why it needs a test: the workspace hides the privilege. Inside
 * the monorepo a relative path can climb out of the package into a private
 * package's source just as quietly, so a relative specifier that resolves
 * outside the package root is reported too, and so is an `import()` or
 * `require()` whose argument is not a string literal — the scan cannot read
 * what it names. The scan returns what it found; the suite asserts on it,
 * with any runner.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist"]);
const SOURCE_EXTENSIONS = /\.(?:[cm]?[jt]s|tsx)$/u;
const TEST_FILE_PATTERN = /\.test\.[cm]?[jt]sx?$/u;
const PRIVATE_PACKAGE_PREFIX = "@bb/";

/** Specifiers plugin code (server, host, bridge, app) may import. */
const PLUGIN_IMPORT_ALLOWLIST: readonly RegExp[] = [
  /^@get-bb\/plugin-sdk$/u,
  /^@get-bb\/plugin-sdk\/(?:host|app|ai-services|provider-bridge|provider-bridge\/acp)$/u,
  /^zod$/u,
  /^node:/u,
  /^\.\.?\//u,
];

/** What a test file may import beyond the plugin allowlist. */
const TEST_IMPORT_ALLOWLIST: readonly RegExp[] = [
  /^@get-bb\/plugin-sdk\/(?:testing|testing\/app|testing\/host|provider-bridge\/testing)$/u,
  /^vitest$/u,
];

const IMPORT_SPECIFIER_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/gu;
/** An `import()` / `require()` whose argument is not a string literal. */
const DYNAMIC_SPECIFIER_PATTERN =
  /\b(?:import|require)\s*\(\s*(?!["'])([^)]+)\)/gu;
const RELATIVE_SPECIFIER_PATTERN = /^\.\.?\//u;

export interface PublicSdkOnlyScanOptions {
  /**
   * Public packages the plugin depends on beyond the SDK (a config-file
   * parser, say), matched against the whole specifier. Plugin code and tests
   * alike may import them.
   */
  allow?: readonly RegExp[];
}

export interface PublicSdkOnlyViolation {
  /** The importing file, relative to the package root. */
  file: string;
  /** The import specifier, or the argument text of a dynamic one. */
  specifier: string;
  reason:
    | "private-package"
    | "outside-allowlist"
    | "outside-package"
    | "dynamic-specifier";
}

export interface PublicSdkOnlyScan {
  /** Every source file scanned, relative to the package root, in walk order. */
  files: string[];
  violations: PublicSdkOnlyViolation[];
  /** `@bb/*` names in the package.json dependencies and devDependencies. */
  privateDependencies: string[];
}

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

function dynamicSpecifiers(source: string): string[] {
  return [...source.matchAll(DYNAMIC_SPECIFIER_PATTERN)].map((match) =>
    (match[1] ?? "").trim(),
  );
}

/** True when a relative specifier from `file` resolves outside the package. */
function escapesPackage(
  packageRoot: string,
  file: string,
  specifier: string,
): boolean {
  const target = relative(packageRoot, resolve(dirname(file), specifier));
  return isAbsolute(target) || target === ".." || target.startsWith(`..${sep}`);
}

function declaredDependencyNames(packageRoot: string): string[] {
  const manifest: unknown = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8"),
  );
  const names: string[] = [];
  for (const field of ["dependencies", "devDependencies"]) {
    const block =
      typeof manifest === "object" && manifest !== null && field in manifest
        ? (manifest as Record<string, unknown>)[field]
        : undefined;
    if (typeof block === "object" && block !== null) {
      names.push(...Object.keys(block));
    }
  }
  return names;
}

/**
 * Scan a plugin package for imports outside the public SDK. `packageRoot`
 * is the directory holding its package.json; every `.ts`/`.tsx`/`.js`
 * file below it except `node_modules` and `dist` is read.
 */
export function scanPublicSdkOnly(
  packageRoot: string,
  options: PublicSdkOnlyScanOptions = {},
): PublicSdkOnlyScan {
  const extra = options.allow ?? [];
  const pluginAllowlist = [...PLUGIN_IMPORT_ALLOWLIST, ...extra];
  const testAllowlist = [...pluginAllowlist, ...TEST_IMPORT_ALLOWLIST];
  const files: string[] = [];
  const violations: PublicSdkOnlyViolation[] = [];
  for (const path of listSourceFiles(packageRoot)) {
    const file = relative(packageRoot, path);
    files.push(file);
    const allowlist = TEST_FILE_PATTERN.test(path)
      ? testAllowlist
      : pluginAllowlist;
    const source = readFileSync(path, "utf8");
    for (const specifier of importSpecifiers(source)) {
      if (specifier.startsWith(PRIVATE_PACKAGE_PREFIX)) {
        violations.push({ file, specifier, reason: "private-package" });
      } else if (
        RELATIVE_SPECIFIER_PATTERN.test(specifier) &&
        escapesPackage(packageRoot, path, specifier) &&
        !extra.some((pattern) => pattern.test(specifier))
      ) {
        violations.push({ file, specifier, reason: "outside-package" });
      } else if (!allowlist.some((pattern) => pattern.test(specifier))) {
        violations.push({ file, specifier, reason: "outside-allowlist" });
      }
    }
    for (const specifier of dynamicSpecifiers(source)) {
      violations.push({ file, specifier, reason: "dynamic-specifier" });
    }
  }
  return {
    files,
    violations,
    privateDependencies: declaredDependencyNames(packageRoot).filter((name) =>
      name.startsWith(PRIVATE_PACKAGE_PREFIX),
    ),
  };
}
