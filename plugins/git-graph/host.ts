import path from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { gitGraphHostContract } from "./host-contract.js";
import type { FsReader } from "./git/discovery.js";
import { nodeFsReader } from "./git/node-fs.js";
import { repoRelPathFormError, isValidRelativeFilePath } from "./git/paths.js";
import { lazyProbingGitRunner, type GitRunner } from "./git/run.js";
import {
  createGitGraphService,
  repoAbsolutePath,
  type GitGraphService,
} from "./git/service.js";

export interface GitGraphHostDeps {
  readonly runGit: GitRunner;
  readonly fs: FsReader;
}

async function resolveEnclosingToplevel(
  runGit: GitRunner,
  sourceRoot: string,
): Promise<string | null> {
  const result = await runGit(
    [
      "-C",
      sourceRoot,
      "-c",
      "core.quotepath=false",
      "-c",
      "core.fsmonitor=false",
      "rev-parse",
      "--show-toplevel",
    ],
    { timeoutMs: 10_000 },
  );
  if (result.exitCode !== 0) return null;
  const toplevel = result.stdout.split("\n", 1)[0]?.trim() ?? "";
  return toplevel.length === 0 ? null : toplevel;
}

export async function resolveRepoAbsolutePath(
  deps: GitGraphHostDeps,
  sourceRoot: string,
  repoRelPath: string,
): Promise<string> {
  const formError = repoRelPathFormError(repoRelPath);
  if (formError !== null) {
    throw new Error(`Invalid repository path: ${formError}.`);
  }
  const resolved = repoAbsolutePath(sourceRoot, repoRelPath);
  if (repoRelPath.split("/").includes("..")) {
    const toplevel = await resolveEnclosingToplevel(deps.runGit, sourceRoot);
    if (
      toplevel === null ||
      path.resolve(toplevel) !== path.resolve(resolved)
    ) {
      throw new Error(
        `Repository "${repoRelPath}" does not match the enclosing repository of ${sourceRoot}.`,
      );
    }
    return path.resolve(resolved);
  }
  const dotGitStat = await deps.fs.stat(`${resolved}/.git`);
  if (dotGitStat === null) {
    throw new Error(
      `Repository "${repoRelPath}" was not found under ${sourceRoot}. Refresh repositories and try again.`,
    );
  }
  return path.resolve(resolved);
}

export function createGitGraphHostEntry(deps: GitGraphHostDeps) {
  const service: GitGraphService = createGitGraphService({
    runGit: deps.runGit,
    fs: deps.fs,
  });
  async function repoFor(input: {
    sourceRoot: string;
    repoRelPath: string;
  }): Promise<string> {
    return await resolveRepoAbsolutePath(
      deps,
      input.sourceRoot,
      input.repoRelPath,
    );
  }
  return experimental_defineHostEntry({
    contract: gitGraphHostContract,
    handlers: {
      async scanRepos({ sourceRoot }) {
        const scan = await service.scanProjectRepos(sourceRoot);
        return {
          repos: scan.repos,
          scanTruncated: scan.scanTruncated,
          scanError: scan.scanError,
        };
      },
      async repoStatus(input) {
        const repoAbsPath = await repoFor(input);
        return await service.repoStatus(repoAbsPath);
      },
      async history(input) {
        const repoAbsPath = await repoFor(input);
        return await service.history(repoAbsPath, {
          offset: input.offset,
          limit: input.limit,
          query: input.query,
          refs: input.refs,
          includeRemotes: input.includeRemotes,
        });
      },
      async commitDetail(input) {
        const repoAbsPath = await repoFor(input);
        return await service.commitDetail(repoAbsPath, input.hash);
      },
      async filePatch(input) {
        if (!isValidRelativeFilePath(input.path)) {
          throw new Error("Invalid repository file path.");
        }
        const repoAbsPath = await repoFor(input);
        return await service.filePatch(repoAbsPath, input.hash, input.path);
      },
    },
  });
}

export default createGitGraphHostEntry({
  runGit: lazyProbingGitRunner,
  fs: nodeFsReader,
});
