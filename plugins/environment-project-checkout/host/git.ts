import { hasRef, runGit } from "bb-environment-provider-host/git";
import fs from "node:fs/promises";
import path from "node:path";
import type { WorkspaceGitOperation } from "../contract.js";

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function locateBranch(
  cwd: string,
  name: string,
): Promise<"local" | "origin" | "missing"> {
  if (await hasRef(cwd, `refs/heads/${name}`)) {
    return "local";
  }
  if (await hasRef(cwd, `refs/remotes/origin/${name}`)) {
    return "origin";
  }
  return "missing";
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
