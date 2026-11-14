import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MANIFEST_PATH,
  VERSION_MODULE_PATH,
  planPluginSdkBump,
  readPluginSdkVersions,
} from "./bump-plugin-sdk.mjs";
import { compareSemver } from "./lib/semver.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = resolve(dirname(scriptPath), "..");
export const RELEASE_TAG_PREFIX = "plugin-sdk-v";
const REGISTRY_URL = "https://registry.npmjs.org/@get-bb%2Fplugin-sdk";
const BOT_IDENTITY = {
  GIT_AUTHOR_NAME: "github-actions[bot]",
  GIT_AUTHOR_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
  GIT_COMMITTER_NAME: "github-actions[bot]",
  GIT_COMMITTER_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
};
const MAX_ATTEMPTS = 5;

export function decidePluginSdkCut({ version, commit, claim, mainVersion }) {
  const mainOrder = compareSemver(mainVersion, version);

  if (mainOrder < 0) {
    return {
      kind: "refuse",
      message: `main carries @get-bb/plugin-sdk ${mainVersion}, older than ${version} at ${commit}. The version only moves forward; set main past ${version} before releasing.`,
    };
  }

  const advance = mainOrder === 0;

  if (claim.kind === "unclaimed") {
    return { kind: "claim", ownsVersion: true, advance };
  }

  if (claim.kind === "unattributed") {
    return {
      kind: "refuse",
      message: `@get-bb/plugin-sdk ${version} is on npm without a gitHead, so this release cannot tell whether ${commit} contains what was published under it. Set main past ${version} with node scripts/bump-plugin-sdk.mjs --patch and release from there.`,
    };
  }

  if (claim.commit === commit) {
    return { kind: "reuse", ownsVersion: true, advance };
  }

  if (claim.containedInRelease) {
    return { kind: "share", ownsVersion: false, advance };
  }

  return {
    kind: "refuse",
    message: `@get-bb/plugin-sdk ${version} was already cut from ${claim.commit} (${claim.source}), which ${commit} does not contain. A host built from ${commit} would report ${version} without everything published under it. Rerun the release from current main.`,
  };
}

function createGit(repoRoot) {
  const output = (args, options = {}) =>
    execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      ...options,
    });
  const run = (args, options) => output(args, options).trim();
  const show = (ref, path) => output(["show", `${ref}:${path}`]);
  const succeeds = (args) =>
    spawnSync("git", args, { cwd: repoRoot, stdio: "ignore" }).status === 0;

  return { run, show, succeeds };
}

function readVersionsAt(git, ref) {
  const versions = readPluginSdkVersions({
    manifestContent: git.show(ref, MANIFEST_PATH),
    moduleContent: git.show(ref, VERSION_MODULE_PATH),
  });

  if (versions.manifestVersion !== versions.moduleVersion) {
    throw new Error(
      `${ref} disagrees with itself: ${MANIFEST_PATH}=${versions.manifestVersion} ${VERSION_MODULE_PATH}=${versions.moduleVersion}.`,
    );
  }

  return versions.moduleVersion;
}

export async function findPublishedCommit(version) {
  const response = await fetch(REGISTRY_URL, {
    headers: { accept: "application/json" },
  });

  if (response.status === 404) {
    return { kind: "unpublished" };
  }

  if (!response.ok) {
    throw new Error(`npm registry responded ${response.status}`);
  }

  const metadata = await response.json();
  const published = metadata?.versions?.[version];

  if (published === undefined) {
    return { kind: "unpublished" };
  }

  return {
    kind: "published",
    gitHead: typeof published.gitHead === "string" ? published.gitHead : null,
  };
}

async function readClaim({ git, remote, version, commit, findPublished }) {
  const tagRef = `refs/tags/${RELEASE_TAG_PREFIX}${version}`;
  const tagLine = git.run(["ls-remote", remote, tagRef]);

  if (tagLine !== "") {
    const claimedCommit = tagLine.split(/\s+/u)[0];

    return {
      kind: "claimed",
      source: `tag ${RELEASE_TAG_PREFIX}${version}`,
      commit: claimedCommit,
      containedInRelease: git.succeeds([
        "merge-base",
        "--is-ancestor",
        claimedCommit,
        commit,
      ]),
    };
  }

  const published = await findPublished(version);

  if (published.kind === "unpublished") {
    return { kind: "unclaimed" };
  }

  if (published.gitHead === null) {
    return { kind: "unattributed" };
  }

  return {
    kind: "claimed",
    source: "npm gitHead",
    commit: published.gitHead,
    containedInRelease: git.succeeds([
      "merge-base",
      "--is-ancestor",
      published.gitHead,
      commit,
    ]),
  };
}

function pushAdvanceCommit({ git, remote, branch, mainRef, version, commit }) {
  const plan = planPluginSdkBump({
    argument: "--patch",
    manifestContent: git.show(mainRef, MANIFEST_PATH),
    moduleContent: git.show(mainRef, VERSION_MODULE_PATH),
  });
  const indexDirectory = mkdtempSync(join(tmpdir(), "plugin-sdk-cut-"));
  const env = {
    ...process.env,
    ...BOT_IDENTITY,
    GIT_INDEX_FILE: join(indexDirectory, "index"),
  };

  try {
    git.run(["read-tree", mainRef], { env });
    for (const [path, content] of [
      [MANIFEST_PATH, plan.manifestContent],
      [VERSION_MODULE_PATH, plan.moduleContent],
    ]) {
      const mode = git.run(["ls-tree", mainRef, "--", path]).split(/\s+/u)[0];
      const blob = git.run(["hash-object", "-w", "--stdin"], {
        input: content,
      });
      git.run(["update-index", "--cacheinfo", `${mode},${blob},${path}`], {
        env,
      });
    }
    const tree = git.run(["write-tree", "--missing-ok"], { env });
    const advanceCommit = git.run(
      [
        "commit-tree",
        tree,
        "-p",
        mainRef,
        "-m",
        `Advance @get-bb/plugin-sdk to ${plan.newVersion}`,
        "-m",
        `${version} was cut for release from ${commit}.`,
      ],
      { env },
    );

    return {
      pushed: git.succeeds([
        "push",
        "--quiet",
        remote,
        `${advanceCommit}:refs/heads/${branch}`,
      ]),
      nextVersion: plan.newVersion,
    };
  } finally {
    rmSync(indexDirectory, { recursive: true, force: true });
  }
}

export async function cutPluginSdkRelease({
  repoRoot,
  remote = "origin",
  branch = "main",
  dryRun,
  findPublished = findPublishedCommit,
  log,
}) {
  const git = createGit(repoRoot);
  const commit = git.run(["rev-parse", "HEAD"]);
  const version = readVersionsAt(git, "HEAD");
  const mainRef = `refs/remotes/${remote}/${branch}`;
  const tag = `${RELEASE_TAG_PREFIX}${version}`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    git.run([
      "fetch",
      "--quiet",
      "--no-tags",
      remote,
      `+refs/heads/${branch}:${mainRef}`,
    ]);
    const mainVersion = readVersionsAt(git, mainRef);
    const claim = await readClaim({
      git,
      remote,
      version,
      commit,
      findPublished,
    });
    const decision = decidePluginSdkCut({
      version,
      commit,
      claim,
      mainVersion,
    });

    if (decision.kind === "refuse") {
      throw new Error(decision.message);
    }

    if (dryRun) {
      log(
        `Dry run: would ${decision.kind} @get-bb/plugin-sdk ${version} for ${commit}${decision.advance ? ` and advance ${branch} past it` : ""}.`,
      );
      return { version, ownsVersion: decision.ownsVersion };
    }

    if (
      decision.kind === "claim" &&
      !git.succeeds(["push", "--quiet", remote, `${commit}:refs/tags/${tag}`])
    ) {
      log(`Tag ${tag} appeared while claiming it; re-reading (${attempt}).`);
      continue;
    }

    if (decision.advance) {
      const advance = pushAdvanceCommit({
        git,
        remote,
        branch,
        mainRef,
        version,
        commit,
      });

      if (!advance.pushed) {
        log(`${branch} moved while advancing it; retrying (${attempt}).`);
        continue;
      }

      log(`Advanced ${branch} to @get-bb/plugin-sdk ${advance.nextVersion}.`);
    }

    log(
      decision.ownsVersion
        ? `This release owns @get-bb/plugin-sdk ${version} (${tag} → ${commit}).`
        : `@get-bb/plugin-sdk ${version} belongs to an earlier release this commit contains; this run releases a host that carries it and does not publish it.`,
    );
    return { version, ownsVersion: decision.ownsVersion };
  }

  throw new Error(
    `Could not cut @get-bb/plugin-sdk ${version} after ${MAX_ATTEMPTS} attempts.`,
  );
}

async function main() {
  const result = await cutPluginSdkRelease({
    repoRoot: process.env.BB_CUT_PLUGIN_SDK_REPO_ROOT ?? defaultRepoRoot,
    dryRun: process.argv.includes("--dry-run"),
    log: console.log,
  });
  const outputPath = process.env.GITHUB_OUTPUT;

  if (outputPath !== undefined && outputPath !== "") {
    appendFileSync(
      outputPath,
      `version=${result.version}\nowns_version=${result.ownsVersion}\n`,
    );
  }
}

if (resolve(process.argv[1] ?? "") === scriptPath) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`::error::${message}`);
    process.exitCode = 1;
  });
}
