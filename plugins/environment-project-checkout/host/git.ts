import { detectGitRepo, runGit } from "bb-environment-provider-host/git";
import fs from "node:fs/promises";
import path from "node:path";
import type { GitCheckoutRef, WorkspaceGitOperation } from "../contract.js";

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readHeadSha(cwd: string): Promise<string | null> {
  const result = await runGit(["rev-parse", "--verify", "HEAD"], {
    cwd,
    allowFailure: true,
  });
  if (result.exitCode !== 0) {
    return null;
  }
  const sha = result.stdout.trim();
  return sha || null;
}

export async function getCheckoutRef(cwd: string): Promise<GitCheckoutRef> {
  if (!(await detectGitRepo(cwd))) {
    return { kind: "unknown", reason: "Path is not a git repository" };
  }
  const [symbolicRef, headSha] = await Promise.all([
    runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], {
      cwd,
      allowFailure: true,
    }),
    readHeadSha(cwd),
  ]);
  const branchName = symbolicRef.stdout.trim();
  if (symbolicRef.exitCode === 0 && branchName) {
    return headSha === null
      ? { kind: "unborn", branchName }
      : { kind: "branch", branchName, headSha };
  }
  if (headSha !== null) {
    return { kind: "detached", headSha };
  }
  return {
    kind: "unknown",
    reason: "HEAD is not symbolic and no commit is checked out",
  };
}

export async function listLocalBranches(cwd: string): Promise<string[]> {
  const result = await runGit(
    ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    { cwd },
  );
  return result.stdout
    .split("\n")
    .map((branch) => branch.trim())
    .filter(Boolean);
}

const CONFLICT_PORCELAIN_STATUSES = new Set([
  "DD",
  "AU",
  "UD",
  "UA",
  "DU",
  "AA",
  "UU",
]);

const GIT_OPERATION_MARKERS: ReadonlyArray<{
  kind: "rebase" | "merge" | "cherry-pick" | "revert";
  markerNames: readonly string[];
}> = [
  { kind: "rebase", markerNames: ["rebase-merge", "rebase-apply"] },
  { kind: "merge", markerNames: ["MERGE_HEAD"] },
  { kind: "cherry-pick", markerNames: ["CHERRY_PICK_HEAD"] },
  { kind: "revert", markerNames: ["REVERT_HEAD"] },
];

async function readPorcelainStatus(cwd: string): Promise<string> {
  const status = await runGit(
    [
      "--no-optional-locks",
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ],
    { cwd },
  );
  return status.stdout;
}

export async function hasUncommittedChanges(cwd: string): Promise<boolean> {
  return (await readPorcelainStatus(cwd)).trim().length > 0;
}

export async function getWorkspaceGitOperation(
  cwd: string,
): Promise<WorkspaceGitOperation> {
  const [gitDirResult, status] = await Promise.all([
    runGit(["rev-parse", "--absolute-git-dir"], { cwd }),
    readPorcelainStatus(cwd),
  ]);
  const gitDir = gitDirResult.stdout.trim();
  const hasConflicts = status
    .split("\n")
    .filter((line) => line.length >= 2)
    .some(
      (line) =>
        line[0] === "U" ||
        line[1] === "U" ||
        CONFLICT_PORCELAIN_STATUSES.has(line.slice(0, 2)),
    );
  for (const marker of GIT_OPERATION_MARKERS) {
    for (const markerName of marker.markerNames) {
      if (await pathExists(path.join(gitDir, markerName))) {
        return { kind: marker.kind, hasConflicts };
      }
    }
  }
  return { kind: "none" };
}
