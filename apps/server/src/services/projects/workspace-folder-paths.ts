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

export interface WorkspaceFolderPathProblem {
  kind:
    | "relative"
    | "main_folder"
    | "inside_main_folder"
    | "contains_main_folder"
    | "duplicate";
  message: string;
}

export function workspaceFolderPathProblem(
  args: WorkspaceFolderPathProblemArgs,
): WorkspaceFolderPathProblem | null {
  if (!isAbsoluteHostPath(args.path) || args.path.includes("\0")) {
    return {
      kind: "relative",
      message: `Folder ${args.path} must be an absolute path`,
    };
  }
  if (areHostPathsEqual(args.path, args.mainPath)) {
    return {
      kind: "main_folder",
      message: `Folder ${args.path} is the main folder`,
    };
  }
  if (isHostPathWithin({ rootPath: args.mainPath, candidatePath: args.path })) {
    return {
      kind: "inside_main_folder",
      message: `Folder ${args.path} is inside the main folder ${args.mainPath}`,
    };
  }
  if (isHostPathWithin({ rootPath: args.path, candidatePath: args.mainPath })) {
    return {
      kind: "contains_main_folder",
      message: `Folder ${args.path} contains the main folder ${args.mainPath}`,
    };
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

export interface EnvironmentAdditionalPath {
  path: string;
  replaces: string | null;
}

export function validateEnvironmentAdditionalPaths(args: {
  mainPath: string;
  entries: readonly EnvironmentAdditionalPath[];
}): EnvironmentAdditionalPath[] {
  const accepted: EnvironmentAdditionalPath[] = [];
  for (const entry of args.entries) {
    const path = canonicalizeHostPath(entry.path);
    const problem = workspaceFolderPathProblem({
      existingPaths: accepted.map((existing) => existing.path),
      mainPath: args.mainPath,
      path,
    });
    if (problem !== null) {
      throw new Error(problem.message);
    }
    const replaces =
      entry.replaces === null ? null : canonicalizeHostPath(entry.replaces);
    if (
      replaces !== null &&
      (!isAbsoluteHostPath(replaces) || replaces.includes("\0"))
    ) {
      throw new Error(
        `Folder ${path} replaces ${replaces}, which must be an absolute path`,
      );
    }
    accepted.push({ path, replaces });
  }
  return accepted;
}

export function validateSetupFolderPaths(args: {
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
  projectFolderPaths: readonly string[];
  additionalPaths: readonly EnvironmentAdditionalPath[];
}): string[] {
  const projectFolderPaths = args.projectFolderPaths.filter(
    (path) =>
      !args.additionalPaths.some(
        (entry) =>
          entry.replaces !== null && areHostPathsEqual(entry.replaces, path),
      ),
  );
  const merged: string[] = [];
  for (const path of [
    ...projectFolderPaths,
    ...args.additionalPaths.map((entry) => entry.path),
  ]) {
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
