import fs from "node:fs/promises";
import path from "node:path";
import {
  isWatchPathWithinRoot,
  normalizeWatchEventPath,
  toWatchRootRelativeKey,
} from "./watch-event-path.js";
import type { WorkspaceStatusChangeEvent } from "./watch-status-types.js";

type ParcelWatcherSubscribe = (typeof import("@parcel/watcher"))["subscribe"];
type ParcelWatcherOptions = Parameters<ParcelWatcherSubscribe>[2];
type ParcelWatcherCallback = Parameters<ParcelWatcherSubscribe>[1];
type ParcelWatcherEventBatch = Parameters<ParcelWatcherCallback>[1];

export interface WatchSubscriptionSpec {
  includeSharedGitRefs?: boolean;
  kind: "common-dir" | "git-dir" | "workspace-root";
  options?: ParcelWatcherOptions;
  rootPath: string;
}

interface GitMetadataLayout {
  commonDirPath: string;
  gitDirPath: string;
}

async function canonicalizePath(inputPath: string): Promise<string> {
  try {
    return await fs.realpath(inputPath);
  } catch {
    return inputPath;
  }
}

function trimOutput(value: string): string {
  return value.trim().replace(/\n+$/u, "");
}

async function resolveGitDirectory(cwd: string): Promise<string | undefined> {
  const dotGitPath = path.join(cwd, ".git");
  try {
    const dotGitStat = await fs.lstat(dotGitPath);
    if (dotGitStat.isDirectory()) {
      return canonicalizePath(dotGitPath);
    }
    if (!dotGitStat.isFile()) {
      return undefined;
    }
    const dotGitContents = await fs.readFile(dotGitPath, "utf8");
    const firstLine = dotGitContents.split("\n")[0]?.trim() ?? "";
    if (!firstLine.startsWith("gitdir:")) {
      return undefined;
    }
    const relativeGitDir = firstLine.slice("gitdir:".length).trim();
    if (relativeGitDir.length === 0) {
      return undefined;
    }
    return canonicalizePath(path.resolve(cwd, relativeGitDir));
  } catch {
    return undefined;
  }
}

async function resolveGitCommonDirectory(gitDirPath: string): Promise<string> {
  try {
    const relativeCommonDirPath = trimOutput(
      await fs.readFile(path.join(gitDirPath, "commondir"), "utf8"),
    );
    if (relativeCommonDirPath.length === 0) {
      return gitDirPath;
    }
    return canonicalizePath(path.resolve(gitDirPath, relativeCommonDirPath));
  } catch {
    return gitDirPath;
  }
}

async function resolveGitMetadataLayout(
  cwd: string,
): Promise<GitMetadataLayout | null> {
  const gitDirPath = await resolveGitDirectory(cwd);
  if (!gitDirPath) {
    return null;
  }
  return {
    commonDirPath: await resolveGitCommonDirectory(gitDirPath),
    gitDirPath,
  };
}

function createCommonDirWatchOptions(): ParcelWatcherOptions {
  return {
    ignore: ["hooks", "info", "logs", "modules", "objects", "worktrees"],
  };
}

function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  return isWatchPathWithinRoot(rootPath, candidatePath);
}

function resolveEventPath(rootPath: string, eventPath: string): string {
  return normalizeWatchEventPath(rootPath, eventPath);
}

function normalizeRelativePath(
  rootPath: string,
  candidatePath: string,
): string {
  return toWatchRootRelativeKey(rootPath, candidatePath);
}

function isSharedGitRefPath(relativePath: string): boolean {
  if (relativePath.length === 0 || relativePath.endsWith(".lock")) {
    return false;
  }
  if (relativePath === "packed-refs") {
    return true;
  }
  return (
    relativePath.startsWith("refs/heads/") ||
    relativePath.startsWith("refs/remotes/")
  );
}

function classifyGitDirPath(
  relativePath: string,
): WorkspaceStatusChangeEvent["changeKinds"][number] | null {
  if (
    relativePath.length === 0 ||
    relativePath === "commondir" ||
    relativePath === "gitdir" ||
    relativePath.endsWith(".lock")
  ) {
    return null;
  }
  return "workspace-git-changed";
}

function classifyCommonDirPath(
  relativePath: string,
): WorkspaceStatusChangeEvent["changeKinds"][number] | null {
  return isSharedGitRefPath(relativePath) ? "shared-git-refs-changed" : null;
}

export function collectWorkspaceStatusChanges(args: {
  events: ParcelWatcherEventBatch;
  spec: WatchSubscriptionSpec;
}): WorkspaceStatusChangeEvent | null {
  const changedPaths = new Set<string>();
  const changeKinds = new Set<
    WorkspaceStatusChangeEvent["changeKinds"][number]
  >();

  for (const event of args.events) {
    const candidatePath = resolveEventPath(args.spec.rootPath, event.path);
    if (!isPathWithinRoot(args.spec.rootPath, candidatePath)) {
      continue;
    }

    const relativePath = normalizeRelativePath(
      args.spec.rootPath,
      candidatePath,
    );
    const eventChangeKinds: WorkspaceStatusChangeEvent["changeKinds"][number][] =
      [];
    if (args.spec.kind === "workspace-root") {
      eventChangeKinds.push("workspace-content-changed");
    } else if (args.spec.kind === "git-dir") {
      const gitDirChangeKind = classifyGitDirPath(relativePath);
      if (gitDirChangeKind) {
        eventChangeKinds.push(gitDirChangeKind);
      }
      if (
        args.spec.includeSharedGitRefs === true &&
        isSharedGitRefPath(relativePath)
      ) {
        eventChangeKinds.push("shared-git-refs-changed");
      }
    } else {
      const commonDirChangeKind = classifyCommonDirPath(relativePath);
      if (commonDirChangeKind) {
        eventChangeKinds.push(commonDirChangeKind);
      }
    }
    if (eventChangeKinds.length === 0) {
      continue;
    }
    changedPaths.add(candidatePath);
    for (const changeKind of eventChangeKinds) {
      changeKinds.add(changeKind);
    }
  }

  if (changedPaths.size === 0 || changeKinds.size === 0) {
    return null;
  }

  return {
    changedPaths: Array.from(changedPaths).sort(),
    changeKinds: Array.from(changeKinds),
  };
}

export async function resolveMetadataWatchSpecs(
  cwd: string,
): Promise<WatchSubscriptionSpec[] | null> {
  const layout = await resolveGitMetadataLayout(cwd);
  if (!layout) {
    return null;
  }
  const commonDirSpec: WatchSubscriptionSpec = {
    includeSharedGitRefs: true,
    kind: layout.gitDirPath === layout.commonDirPath ? "git-dir" : "common-dir",
    options: createCommonDirWatchOptions(),
    rootPath: layout.commonDirPath,
  };
  if (layout.gitDirPath === layout.commonDirPath) {
    return [commonDirSpec];
  }
  return [
    {
      kind: "git-dir",
      rootPath: layout.gitDirPath,
    },
    commonDirSpec,
  ];
}
