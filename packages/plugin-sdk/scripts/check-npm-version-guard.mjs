// Keeps npm from lagging the plugin SDK.
//
// The publish job (.github/workflows/publish-bb-app.yml, job publish-plugin-sdk)
// only publishes @get-bb/plugin-sdk when PLUGIN_SDK_VERSION is absent from npm.
// That is safe exactly as long as a released version's *published content* never
// changes underneath it. Declarations alone are not enough: a runtime-only change
// (dist/ output, an exports map entry, a peer range) leaves bundled-types
// identical, so a types-only guard would pass and publish-if-missing would then
// never ship it — npm would keep serving stale executable code under a version
// that no longer matches this repo.
//
// So this guard compares the whole would-be-published package against the
// published tarball for the current version:
//   - every packed file (bundled-types/*, dist/*, README.md)
//   - the manifest fields consumers actually resolve against (see
//     COMPARED_MANIFEST_FIELDS)
// The local side is produced by `npm pack`, i.e. the same file selection npm
// will use at publish time, rather than a hand-maintained list.
//
// Content equality is trustworthy here because dist/ is reproducible: the
// esbuild bundles embed no timestamps, paths, or hashes, and two forced rebuilds
// of this package produce byte-identical dist/ output.
//
// Exit codes: 0 pass, 1 published content drift without a version bump, 2
// infrastructure (registry unreachable, or the local package could not be built
// or packed).
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const repoRoot = path.resolve(pkgRoot, "..", "..");
const PACKAGE_NAME = "@get-bb/plugin-sdk";
const REGISTRY_URL = "https://registry.npmjs.org/@get-bb%2Fplugin-sdk";

/**
 * Manifest fields whose value is part of what consumers resolve against. A
 * change to any of them changes the package for everyone who already installed
 * this version, so it needs a version bump just like a file change. Fields that
 * only describe the release (version, description, homepage, devDependencies)
 * are deliberately excluded.
 */
export const COMPARED_MANIFEST_FIELDS = [
  "exports",
  "files",
  "main",
  "peerDependencies",
  "peerDependenciesMeta",
  "publishConfig",
  "repository",
  "types",
];

/**
 * Normalize a packed text file for content comparison: line endings differ
 * across the checkout and the packed tarball, and trailing whitespace at EOF is
 * not part of what ships. Nothing else is touched — we want real drift to be
 * visible.
 */
export function normalizePackedFile(text) {
  return text.replace(/\r\n/gu, "\n").replace(/\s+$/u, "") + "\n";
}

/** Stable stringify so key order in package.json is not reported as drift. */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function manifestFieldsDiffer(a, b) {
  return JSON.stringify(canonicalize(a)) !== JSON.stringify(canonicalize(b));
}

/**
 * Pure decision logic, separated from IO so the matrix is testable.
 *
 * @param {object} input
 * @param {string} input.version local package version
 * @param {object} input.local one of:
 *   {kind:"packed", files: Record<string,string>, manifest: Record<string,unknown>}
 *   {kind:"pack-failed", message}
 *   Only consulted when the registry says this version is published.
 * @param {object} input.registry one of:
 *   {kind:"network-error", message}
 *   {kind:"package-not-found"}
 *   {kind:"version-not-found"}
 *   {kind:"published", files: Record<string,string>, manifest: Record<string,unknown>}
 * @returns {{status:"pass"|"fail"|"error", exitCode:0|1|2, reason:string,
 *   message:string, changedFiles:string[]}}
 */
export function decideNpmVersionGuard({ version, local, registry }) {
  if (registry.kind === "network-error") {
    return {
      status: "error",
      exitCode: 2,
      reason: "registry-unreachable",
      changedFiles: [],
      message: `could not reach registry for ${PACKAGE_NAME}: ${registry.message}`,
    };
  }

  if (registry.kind === "package-not-found") {
    return {
      status: "pass",
      exitCode: 0,
      reason: "package-not-published",
      changedFiles: [],
      message: `${PACKAGE_NAME} is not on npm yet, so ${version} cannot have drifted. The publish job will ship it.`,
    };
  }

  if (registry.kind === "version-not-found") {
    return {
      status: "pass",
      exitCode: 0,
      reason: "version-not-published",
      changedFiles: [],
      message: `${PACKAGE_NAME}@${version} is not on npm yet. The publish job will ship this version.`,
    };
  }

  if (local.kind === "pack-failed") {
    return {
      status: "error",
      exitCode: 2,
      reason: "local-package-unavailable",
      changedFiles: [],
      message: `could not build or pack ${PACKAGE_NAME} locally: ${local.message}`,
    };
  }

  const allPaths = [
    ...new Set([...Object.keys(local.files), ...Object.keys(registry.files)]),
  ].sort();
  const changedFiles = allPaths.filter(
    (name) =>
      normalizePackedFile(local.files[name] ?? "") !==
      normalizePackedFile(registry.files[name] ?? ""),
  );

  const changedManifestFields = COMPARED_MANIFEST_FIELDS.filter((field) =>
    manifestFieldsDiffer(local.manifest[field], registry.manifest[field]),
  );

  if (changedFiles.length === 0 && changedManifestFields.length === 0) {
    return {
      status: "pass",
      exitCode: 0,
      reason: "package-matches-published",
      changedFiles: [],
      message: `${PACKAGE_NAME}@${version} is published and its packed files and manifest match this checkout.`,
    };
  }

  const changed = [
    ...changedFiles,
    ...changedManifestFields.map((field) => `package.json (${field})`),
  ];
  return {
    status: "fail",
    exitCode: 1,
    reason: "package-changed-without-version-bump",
    changedFiles: changed,
    message: [
      `${PACKAGE_NAME}@${version} is already published, but the package this checkout would publish differs from it:`,
      ...changed.map((name) => `  - ${name}`),
      "",
      "A published version is never republished, so this change would never reach",
      "npm consumers. Bump the version, then re-run:",
      "",
      "  node scripts/bump-plugin-sdk.mjs --patch",
      "",
      "That moves packages/domain/src/plugin-sdk-version.ts and",
      "packages/plugin-sdk/package.json together; they must stay in sync.",
    ].join("\n"),
  };
}

/** Read every file under `dir` as text, keyed by its path relative to `dir`. */
function readPackedTree(dir) {
  const files = {};
  const walk = (current, prefix) => {
    for (const name of readdirSync(current).sort()) {
      const absolute = path.join(current, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      if (statSync(absolute).isDirectory()) {
        walk(absolute, relative);
      } else {
        files[relative] = readFileSync(absolute, "utf8");
      }
    }
  };
  walk(dir, "");
  return files;
}

/**
 * Split an extracted `package/` directory into its manifest and its other
 * files. package.json is compared field by field, not as text, so npm's own
 * normalization of the packed manifest is not reported as drift.
 */
function splitPackage(packageDir) {
  const files = readPackedTree(packageDir);
  const manifestText = files["package.json"] ?? "{}";
  delete files["package.json"];
  return { files, manifest: JSON.parse(manifestText) };
}

function extractTarball(tarballPath, workDir) {
  execFileSync("tar", ["-xzf", tarballPath, "-C", workDir], { stdio: "pipe" });
  return splitPackage(path.join(workDir, "package"));
}

/**
 * Build the package and pack it exactly as npm publish would, so the comparison
 * covers dist/ and the manifest, not just the declarations.
 *
 * The build runs through turbo so upstream `^build` dependencies are honored. In
 * CI it is a cache hit: ci.yml already runs `turbo run build typecheck lint`
 * before this guard, and publish-bb-app.yml builds the SDK before publishing.
 * `npm pack --ignore-scripts` then packs that freshly built tree without
 * re-running prepack.
 */
function loadLocalPackage() {
  try {
    execFileSync(
      "pnpm",
      [
        "exec",
        "turbo",
        "run",
        "build",
        `--filter=${PACKAGE_NAME}`,
        "--output-logs=errors-only",
      ],
      { cwd: repoRoot, stdio: "pipe" },
    );
  } catch (error) {
    return {
      kind: "pack-failed",
      message: `turbo build failed: ${error}`,
    };
  }

  if (!existsSync(path.join(pkgRoot, "dist"))) {
    return {
      kind: "pack-failed",
      message: "the build produced no dist/ directory",
    };
  }

  const workDir = mkdtempSync(path.join(tmpdir(), "plugin-sdk-guard-local-"));
  try {
    const output = execFileSync(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", workDir],
      { cwd: pkgRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const [packed] = JSON.parse(output);
    const tarballPath = path.join(workDir, packed.filename);
    return { kind: "packed", ...extractTarball(tarballPath, workDir) };
  } catch (error) {
    return { kind: "pack-failed", message: `npm pack failed: ${error}` };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/** Fetch registry metadata and, when the version exists, its packed content. */
async function loadRegistryState(version) {
  let response;
  try {
    response = await fetch(REGISTRY_URL, {
      headers: { accept: "application/json" },
    });
  } catch (error) {
    return { kind: "network-error", message: String(error) };
  }

  if (response.status === 404) return { kind: "package-not-found" };
  if (!response.ok) {
    return {
      kind: "network-error",
      message: `registry responded ${response.status}`,
    };
  }

  let metadata;
  try {
    metadata = await response.json();
  } catch (error) {
    return {
      kind: "network-error",
      message: `unreadable registry body: ${error}`,
    };
  }

  const published = metadata?.versions?.[version];
  if (!published) return { kind: "version-not-found" };

  const tarballUrl = published?.dist?.tarball;
  if (typeof tarballUrl !== "string") {
    return {
      kind: "network-error",
      message: `no tarball URL for ${PACKAGE_NAME}@${version}`,
    };
  }

  let tarball;
  try {
    const tarballResponse = await fetch(tarballUrl);
    if (!tarballResponse.ok) {
      return {
        kind: "network-error",
        message: `tarball download responded ${tarballResponse.status}`,
      };
    }
    tarball = Buffer.from(await tarballResponse.arrayBuffer());
  } catch (error) {
    return {
      kind: "network-error",
      message: `tarball download failed: ${error}`,
    };
  }

  // tar is present on GitHub runners and dev machines; extracting with it keeps
  // this script dependency-free.
  const workDir = mkdtempSync(path.join(tmpdir(), "plugin-sdk-guard-"));
  try {
    const tarballPath = path.join(workDir, "package.tgz");
    writeFileSync(tarballPath, tarball);
    try {
      return { kind: "published", ...extractTarball(tarballPath, workDir) };
    } catch (error) {
      // A corrupt or truncated download is infrastructure, not real drift.
      return {
        kind: "network-error",
        message: `tarball extraction failed: ${error}`,
      };
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function main() {
  const asJson = process.argv.includes("--json");
  const { version } = JSON.parse(
    readFileSync(path.join(pkgRoot, "package.json"), "utf8"),
  );
  const registry = await loadRegistryState(version);
  // Building and packing costs ~20s, so only pay it when there is a published
  // tarball to compare against.
  const local =
    registry.kind === "published"
      ? loadLocalPackage()
      : { kind: "not-needed", files: {}, manifest: {} };
  const decision = decideNpmVersionGuard({ version, local, registry });

  if (asJson) {
    console.log(
      JSON.stringify({ package: PACKAGE_NAME, version, ...decision }, null, 2),
    );
  } else if (decision.status === "pass") {
    console.log(`npm version guard: PASS — ${decision.message}`);
  } else {
    console.error(
      `::error::npm version guard: ${decision.status.toUpperCase()}\n${decision.message}`,
    );
  }
  process.exit(decision.exitCode);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  await main();
}
