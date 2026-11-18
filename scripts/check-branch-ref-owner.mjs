#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const BRANCH_REF_OWNER =
  "packages/environment-provider-host/src/workspace-git.ts";

export const BRANCH_REF_ALLOWLIST = {
  "apps/server/src/services/plugin-catalog/marketplace-source.ts":
    "A fresh marketplace clone has only the default local branch, so a named branch exists only on origin. Server-side, outside the host package.",
  "apps/server/src/services/plugins/plugin-updates.ts":
    "Classifies a ref in a fresh plugin clone as a branch; it does not choose between local and origin.",
  "packages/bb-app/src/app-update/source-checkout.ts":
    "Checks that a self-update fast-forwards bb's own source checkout; no branch is chosen.",
  "packages/environment-provider-host/src/branch-options.ts":
    "Pins origin's default branch to the top of the branch picker; it does not choose a base.",
  "plugins/environment-project-checkout/host/checkout.ts":
    "Switching to an existing branch keeps the local branch; origin is only the fresh-clone fallback.",
};

const SCAN_ROOTS = ["apps", "packages", "plugins"];
const SOURCE_FILE_RE = /\.[cm]?[jt]sx?$/;
const EXCLUDED_FILE_RE = /\.(test|spec|stories)\.[cm]?[jt]sx?$|\.d\.ts$/;
const EXCLUDED_SEGMENTS = new Set([
  "node_modules",
  "dist",
  "generated",
  "test",
  "tests",
  "testing",
  "__tests__",
  "__fixtures__",
]);

export function branchRefPatternRegex() {
  return new RegExp(
    [
      String.raw`refs/remotes/origin/\$\{`,
      String.raw`\x60origin/\$\{`,
      String.raw`["']origin/["']\s*\+`,
      String.raw`--is-ancestor\b`,
    ].join("|"),
    "g",
  );
}

export function isScannedPath(path) {
  const parts = path.split("/");
  if (!SCAN_ROOTS.includes(parts[0] ?? "")) return false;
  if (parts.some((part) => EXCLUDED_SEGMENTS.has(part))) return false;
  const name = parts.at(-1) ?? "";
  return SOURCE_FILE_RE.test(name) && !EXCLUDED_FILE_RE.test(name);
}

export function findBranchRefProblems(files, allowlist = BRANCH_REF_ALLOWLIST) {
  const problems = [];
  for (const { path, text } of files) {
    if (path === BRANCH_REF_OWNER || path in allowlist || !isScannedPath(path))
      continue;
    const count = text.match(branchRefPatternRegex())?.length ?? 0;
    if (count > 0) {
      problems.push(
        `${path}: builds origin/<name> refs or runs merge-base --is-ancestor (${count}). Use resolveBranchRef or branchRefCandidates from bb-environment-provider-host/git, or allowlist it with a reason.`,
      );
    }
  }
  return problems;
}

function listFiles(root) {
  return execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ...SCAN_ROOTS,
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\n")
    .filter((path) => isScannedPath(path));
}

function main() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const files = [];
  for (const path of listFiles(root)) {
    try {
      files.push({ path, text: readFileSync(join(root, path), "utf8") });
    } catch {
      continue;
    }
  }
  const problems = findBranchRefProblems(files);
  if (problems.length > 0) {
    console.error(
      `Branch ref owner check FAILED. Local-vs-origin branch choice lives in ${BRANCH_REF_OWNER}.\n${problems.join("\n")}`,
    );
    return 1;
  }
  console.log(
    `Branch ref owner check OK: ${Object.keys(BRANCH_REF_ALLOWLIST).length} allowlisted files.`,
  );
  return 0;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  process.exit(main());
