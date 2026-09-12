import fs from "node:fs/promises";
import path from "node:path";
import {
  runGit,
  WorkspaceError,
  type GitProcessOptions,
} from "@bb/host-workspace";
import { ExpectedCommandDispatchError } from "../command-dispatch-support.js";

const PROJECT_CLONE_TIMEOUT_MS = 20 * 60 * 1000;

function normalizeProjectSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80)
    .replace(/-+$/u, "");
  return slug || "project";
}

export function resolveProjectCloneDefaultPath(
  dataDir: string,
  projectSlug: string,
): string {
  return path.resolve(dataDir, "checkouts", normalizeProjectSlug(projectSlug));
}

async function requireEmptyOrMissingTarget(targetPath: string): Promise<void> {
  try {
    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory() || (await fs.readdir(targetPath)).length > 0) {
      throw new ExpectedCommandDispatchError(
        "target_not_empty",
        `Clone target is not empty: ${targetPath}`,
      );
    }
  } catch (error) {
    if (error instanceof ExpectedCommandDispatchError) {
      throw error;
    }
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

export async function inspectProjectPath(
  projectPath: string,
  options: GitProcessOptions = {},
): Promise<{
  path: string;
  gitRemoteUrl: string | null;
}> {
  const resolvedPath = path.resolve(projectPath);
  const result = await runGit(["remote", "get-url", "origin"], {
    cwd: resolvedPath,
    ...options,
    allowFailure: true,
  });
  const gitRemoteUrl = result.exitCode === 0 ? result.stdout.trim() : "";
  return {
    path: resolvedPath,
    gitRemoteUrl: gitRemoteUrl || null,
  };
}

export async function cloneProject(args: {
  dataDir: string;
  projectSlug: string;
  remoteUrl: string;
  env?: NodeJS.ProcessEnv;
  targetPath?: string;
  shellPath?: string;
  onProgress?: (line: string) => void;
}): Promise<{ path: string; gitRemoteUrl: string | null }> {
  const targetPath = path.resolve(
    args.targetPath ??
      resolveProjectCloneDefaultPath(args.dataDir, args.projectSlug),
  );
  await requireEmptyOrMissingTarget(targetPath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  let pendingProgress = "";
  const onStderr =
    args.onProgress === undefined
      ? undefined
      : (chunk: string): void => {
          pendingProgress += chunk;
          for (;;) {
            const match = /\r\n|\r|\n/u.exec(pendingProgress);
            if (match === null) return;
            args.onProgress?.(pendingProgress.slice(0, match.index));
            pendingProgress = pendingProgress.slice(
              match.index + match[0].length,
            );
          }
        };
  try {
    await runGit(["clone", "--progress", args.remoteUrl, targetPath], {
      cwd: path.dirname(targetPath),
      env: args.env,
      ...(args.shellPath !== undefined ? { shellPath: args.shellPath } : {}),
      timeoutMs: PROJECT_CLONE_TIMEOUT_MS,
      ...(onStderr === undefined ? {} : { onStderr }),
    });
  } catch (error) {
    if (error instanceof WorkspaceError) {
      throw new ExpectedCommandDispatchError(error.code, error.message);
    }
    throw new Error(error instanceof Error ? error.message : String(error));
  } finally {
    if (pendingProgress.length > 0) args.onProgress?.(pendingProgress);
  }
  return inspectProjectPath(
    targetPath,
    args.shellPath === undefined ? {} : { shellPath: args.shellPath },
  );
}
