import {
  areHostPathsEqual,
  canonicalizeHostPath,
  isAbsoluteHostPath,
  isHostPathWithin,
} from "@bb/domain";

export const MAX_WORKSPACE_FOLDERS = 64;

interface WorkspaceFolderPathProblemArgs {
  existingPaths: readonly string[];
  mainPath: string;
  path: string;
}

interface WorkspaceFolderPathProblem {
  kind: "invalid" | "duplicate";
  message: string;
}

export function workspaceFolderPathProblem(
  args: WorkspaceFolderPathProblemArgs,
): WorkspaceFolderPathProblem | null {
  const invalid = (message: string): WorkspaceFolderPathProblem => ({
    kind: "invalid",
    message,
  });
  if (!isAbsoluteHostPath(args.path) || args.path.includes("\0")) {
    return invalid(`Folder ${args.path} must be an absolute path`);
  }
  if (areHostPathsEqual(args.path, args.mainPath)) {
    return invalid(`Folder ${args.path} is the main folder`);
  }
  if (isHostPathWithin({ rootPath: args.mainPath, candidatePath: args.path })) {
    return invalid(
      `Folder ${args.path} is inside the main folder ${args.mainPath}`,
    );
  }
  if (isHostPathWithin({ rootPath: args.path, candidatePath: args.mainPath })) {
    return invalid(
      `Folder ${args.path} contains the main folder ${args.mainPath}`,
    );
  }
  if (
    args.existingPaths.some((existing) =>
      areHostPathsEqual(existing, args.path),
    )
  ) {
    return {
      kind: "duplicate",
      message: `Folder ${args.path} is already listed`,
    };
  }
  return null;
}

export function validateWorkspaceFolderPaths(args: {
  mainPath: string;
  paths: readonly string[];
}): string[] {
  const accepted: string[] = [];
  for (const raw of args.paths) {
    const path = canonicalizeHostPath(raw);
    const problem = workspaceFolderPathProblem({
      existingPaths: accepted,
      mainPath: args.mainPath,
      path,
    });
    if (problem !== null) {
      throw new Error(problem.message);
    }
    accepted.push(path);
  }
  return accepted;
}

export function mergeWorkspaceFolderPaths(args: {
  mainPath: string;
  paths: readonly string[];
}): string[] {
  const merged: string[] = [];
  for (const path of args.paths) {
    if (
      areHostPathsEqual(path, args.mainPath) ||
      merged.some((existing) => areHostPathsEqual(existing, path))
    ) {
      continue;
    }
    merged.push(path);
  }
  return merged;
}
