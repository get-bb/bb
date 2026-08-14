import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = "plugins/bb-plugin-finite-state";

function runGit(repositoryRoot, args, encoding = "utf8") {
  const result = spawnSync("git", args, { cwd: repositoryRoot, encoding });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed:\n${String(result.stderr).trim()}`,
    );
  }
  return result.stdout;
}

async function exists(repositoryRoot, relativePath) {
  try {
    await access(path.join(repositoryRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

export async function changedFiniteStateFiles({ repositoryRoot, baseRef }) {
  const mergeBase = runGit(repositoryRoot, [
    "merge-base",
    baseRef,
    "HEAD",
  ]).trim();
  const output = runGit(
    repositoryRoot,
    [
      "diff",
      "--name-only",
      "--diff-filter=ACMRT",
      "-z",
      `${mergeBase}...HEAD`,
      "--",
      PLUGIN_ROOT,
    ],
    "buffer",
  );
  const files = output
    .toString("utf8")
    .split("\0")
    .filter((file) => file.length > 0);
  const present = await Promise.all(
    files.map(async (file) => ({
      file,
      exists: await exists(repositoryRoot, file),
    })),
  );
  return present.filter(({ exists }) => exists).map(({ file }) => file);
}

export async function checkChangedFiniteStateFormatting({
  repositoryRoot,
  baseRef,
  prettierCommand = "pnpm",
  prettierArguments = ["exec", "prettier"],
  stdio = "inherit",
}) {
  const files = await changedFiniteStateFiles({ repositoryRoot, baseRef });
  if (files.length === 0) return { files, status: 0 };

  const result = spawnSync(
    prettierCommand,
    [...prettierArguments, "--check", "--ignore-unknown", "--", ...files],
    { cwd: repositoryRoot, stdio },
  );
  if (result.error) throw result.error;
  return { files, status: result.status ?? 1 };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const baseRef = process.argv[2];
  if (!baseRef) {
    console.error(
      "Usage: node check-changed-formatting.mjs <pull-request-base-ref>",
    );
    process.exitCode = 2;
  } else {
    const result = await checkChangedFiniteStateFormatting({
      repositoryRoot: process.cwd(),
      baseRef,
    });
    if (result.files.length === 0) {
      console.log("No changed Finite State files require a Prettier check.");
    }
    process.exitCode = result.status;
  }
}
