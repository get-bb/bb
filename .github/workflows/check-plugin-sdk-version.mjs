import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MANIFEST_PATH,
  VERSION_MODULE_PATH,
  readPluginSdkVersions,
} from "../../scripts/bump-plugin-sdk.mjs";
import { compareSemver } from "../../scripts/lib/semver.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = resolve(scriptPath, "..", "..", "..");
const SDK_SOURCE_PREFIX = "packages/plugin-sdk/src/";
const PLUGIN_MANIFEST_PATTERN = /^plugins\/[^/]+\/package\.json$/u;
const FLOOR_PATTERN = /^>=(\d+\.\d+\.\d+)$/u;

export function isSdkSourcePath(path) {
  return (
    path.startsWith(SDK_SOURCE_PREFIX) &&
    !path.includes("/__tests__/") &&
    !/\.test\.[cm]?[jt]sx?$/u.test(path)
  );
}

function floorOf(range) {
  const match = range === undefined ? null : FLOOR_PATTERN.exec(range);
  return match === null ? null : match[1];
}

export function isRaisedFloor({ before, after }) {
  if (after === undefined) return false;
  const beforeFloor = floorOf(before);
  const afterFloor = floorOf(after);
  if (beforeFloor === null || afterFloor === null) return before !== after;
  return compareSemver(afterFloor, beforeFloor) > 0;
}

export function findPluginSdkVersionProblems({
  base,
  head,
  sdkSourceChanged,
  floorChanges,
}) {
  const problems = [];

  if (head.manifestVersion !== head.moduleVersion) {
    problems.push(
      `${MANIFEST_PATH} says ${head.manifestVersion} but ${VERSION_MODULE_PATH} says ${head.moduleVersion}. They must agree; move both with node scripts/bump-plugin-sdk.mjs.`,
    );
  }

  if (compareSemver(head.moduleVersion, base.moduleVersion) < 0) {
    problems.push(
      `PLUGIN_SDK_VERSION moved backwards from ${base.moduleVersion} to ${head.moduleVersion}. A release may already carry ${base.moduleVersion}, so the version only moves forward; restore it.`,
    );
  }

  if (sdkSourceChanged) {
    const expected = `>=${head.moduleVersion}`;
    for (const change of floorChanges.filter(isRaisedFloor)) {
      if (change.after !== expected) {
        problems.push(
          `${change.plugin} raises engines.bbPluginSdk to ${change.after} alongside a change to ${SDK_SOURCE_PREFIX}. The first host with that change is the next release, ${head.moduleVersion}; every earlier version was released without it. Use "${expected}".`,
        );
      }
    }
  }

  return problems;
}

function createGit(repoRoot) {
  const run = (args) =>
    execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const show = (ref, path) => {
    const result = spawnSync("git", ["show", `${ref}:${path}`], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return result.status === 0 ? result.stdout : null;
  };
  const isCommit = (ref) =>
    spawnSync("git", ["cat-file", "-e", `${ref}^{commit}`], {
      cwd: repoRoot,
      stdio: "ignore",
    }).status === 0;
  const showRequired = (ref, path) =>
    execFileSync("git", ["show", `${ref}:${path}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  return { run, show, showRequired, isCommit };
}

function resolveComparisonBase(git, env) {
  const explicit = env.PLUGIN_SDK_CHECK_BASE ?? "";
  const candidates =
    explicit !== "" && !/^0+$/u.test(explicit) && git.isCommit(explicit)
      ? [explicit]
      : [
          `origin/${env.GITHUB_BASE_REF || "main"}`,
          env.GITHUB_BASE_REF || "main",
        ];

  for (const candidate of candidates) {
    try {
      return git.run(["merge-base", candidate, "HEAD"]);
    } catch {
      continue;
    }
  }
  return null;
}

function bbPluginSdkRange(content) {
  if (content === null) return undefined;
  const range = JSON.parse(content)?.engines?.bbPluginSdk;
  return typeof range === "string" ? range : undefined;
}

function readWorkingFile(repoRoot, path) {
  try {
    return readFileSync(resolve(repoRoot, path), "utf8");
  } catch {
    return null;
  }
}

export function checkPluginSdkVersion({ repoRoot, env }) {
  const git = createGit(repoRoot);
  const base = resolveComparisonBase(git, env);

  if (base === null) {
    return { skipped: true, problems: [] };
  }

  const changed = git
    .run(["diff", "--name-only", base, "HEAD"])
    .split("\n")
    .filter(Boolean);
  const floorChanges = changed
    .filter((path) => PLUGIN_MANIFEST_PATTERN.test(path))
    .map((path) => ({
      plugin: path,
      before: bbPluginSdkRange(git.show(base, path)),
      after: bbPluginSdkRange(readWorkingFile(repoRoot, path)),
    }));

  return {
    skipped: false,
    problems: findPluginSdkVersionProblems({
      base: readPluginSdkVersions({
        manifestContent: git.showRequired(base, MANIFEST_PATH),
        moduleContent: git.showRequired(base, VERSION_MODULE_PATH),
      }),
      head: readPluginSdkVersions({
        manifestContent: readFileSync(resolve(repoRoot, MANIFEST_PATH), "utf8"),
        moduleContent: readFileSync(
          resolve(repoRoot, VERSION_MODULE_PATH),
          "utf8",
        ),
      }),
      sdkSourceChanged: changed.some(isSdkSourcePath),
      floorChanges,
    }),
  };
}

if (resolve(process.argv[1] ?? "") === scriptPath) {
  const result = checkPluginSdkVersion({
    repoRoot: defaultRepoRoot,
    env: process.env,
  });

  if (result.skipped) {
    console.log("No base commit to compare against; skipping.");
  } else if (result.problems.length > 0) {
    console.error(
      result.problems.map((problem) => `::error::${problem}`).join("\n"),
    );
    process.exitCode = 1;
  } else {
    console.log("Plugin SDK version and first-party floors are consistent.");
  }
}
