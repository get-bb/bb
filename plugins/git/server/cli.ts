import { isValidGitBranchName } from "@bb/domain";
import {
  cliCommand,
  defineCli,
  experimental_PluginRpcRefusal,
  PluginCliError,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import type { GitFileSideQuery, WorkspaceDiffTarget } from "../contract.js";
import type { GitReads } from "./reads.js";
import type { GitViewed } from "./viewed.js";
import { BRANCH_LIST_LIMIT_MAX } from "bb-environment-provider-host/git-types";

const JSON_OPTION = {
  type: "boolean",
  description: "Print machine-readable JSON output",
} as const;

const ENVIRONMENT_POSITIONAL = [
  {
    name: "environment-id",
    description: "Environment whose workspace to read",
    required: true,
  },
] as const;

const TARGET_OPTIONS = {
  target: {
    type: "enum",
    values: ["uncommitted", "branch_committed", "all", "commit"],
    required: true,
    description: "Diff target: uncommitted, branch_committed, all, or commit",
  },
  "merge-base-branch": {
    type: "string",
    description: "Branch-based target base",
  },
  sha: { type: "string", description: "Commit target SHA" },
} as const;

const DEFAULT_BRANCH_LIMIT = 50;

function print(...values: (string | null | undefined | false)[]) {
  return {
    exitCode: 0,
    stdout: values
      .filter((value): value is string => typeof value === "string")
      .map((value) => `${value}\n`)
      .join(""),
  };
}

function json(value: unknown) {
  return print(JSON.stringify(value, null, 2));
}

function fail(message: string): never {
  throw new PluginCliError(message, { code: "invalid_value" });
}

function branchName(value: string): string {
  if (!isValidGitBranchName(value)) fail(`Invalid git branch name: ${value}`);
  return value;
}

function withCoreErrors<Input extends { options: object }>(
  run: (input: Input) => Promise<PluginCliResult>,
) {
  return async (input: Input): Promise<PluginCliResult> => {
    try {
      return await run(input);
    } catch (error) {
      if (!(error instanceof PluginCliError)) throw error;
      const hint = error.hint === undefined ? {} : { hint: error.hint };
      const envelope = {
        ok: false,
        error: { code: error.code, message: error.message, ...hint },
      };
      const wantsJson = "json" in input.options && input.options.json === true;
      return {
        exitCode: error.exitCode,
        stderr: `Error: ${error.message}\n${error.hint === undefined ? "" : `${error.hint}\n`}`,
        ...(wantsJson
          ? { stdout: `${JSON.stringify(envelope, null, 2)}\n` }
          : {}),
      };
    }
  };
}

function buildTarget(options: {
  target: "uncommitted" | "branch_committed" | "all" | "commit";
  "merge-base-branch"?: string | undefined;
  sha?: string | undefined;
}): WorkspaceDiffTarget {
  const mergeBaseBranch = options["merge-base-branch"];
  switch (options.target) {
    case "uncommitted":
      if (mergeBaseBranch !== undefined || options.sha !== undefined) {
        fail(
          "--target uncommitted cannot be combined with --merge-base-branch or --sha.",
        );
      }
      return { type: "uncommitted" };
    case "branch_committed":
    case "all":
      if (!mergeBaseBranch) {
        fail(
          `--merge-base-branch is required when --target ${options.target} is used.`,
        );
      }
      if (options.sha !== undefined) {
        fail(`--target ${options.target} cannot be combined with --sha.`);
      }
      return {
        type: options.target,
        mergeBaseBranch: branchName(mergeBaseBranch),
      };
    case "commit":
      if (!options.sha) fail("--sha is required when --target commit is used.");
      if (mergeBaseBranch !== undefined) {
        fail("--target commit cannot be combined with --merge-base-branch.");
      }
      return { type: "commit", sha: options.sha };
  }
}

function buildFileSideQuery(options: {
  target: "uncommitted" | "branch_committed" | "all" | "commit";
  path: string;
  side: "old" | "new";
  "merge-base-ref"?: string | undefined;
  sha?: string | undefined;
}): GitFileSideQuery {
  const common = { path: options.path, side: options.side };
  const mergeBaseRef = options["merge-base-ref"];
  switch (options.target) {
    case "uncommitted":
      if (mergeBaseRef !== undefined || options.sha !== undefined) {
        fail(
          "--target uncommitted cannot be combined with --merge-base-ref or --sha.",
        );
      }
      return { ...common, target: "uncommitted" };
    case "branch_committed":
    case "all":
      if (!mergeBaseRef) {
        fail(
          `--merge-base-ref is required when --target ${options.target} is used.`,
        );
      }
      if (options.sha !== undefined) {
        fail(`--target ${options.target} cannot be combined with --sha.`);
      }
      return { ...common, target: options.target, mergeBaseRef };
    case "commit":
      if (!options.sha) fail("--sha is required when --target commit is used.");
      if (mergeBaseRef !== undefined) {
        fail("--target commit cannot be combined with --merge-base-ref.");
      }
      return { ...common, target: "commit", sha: options.sha };
  }
}

function unavailableMessage(
  result:
    | { outcome: "not_applicable"; message: string }
    | { outcome: "unavailable"; failure: { message: string } },
): string {
  return result.outcome === "not_applicable"
    ? result.message
    : result.failure.message;
}

const REFUSAL_CLI_ERRORS: Readonly<
  Partial<
    Record<
      experimental_PluginRpcRefusal["code"],
      { code: string; message: string }
    >
  >
> = {
  not_found: {
    code: "environment_not_found",
    message: "Environment not found",
  },
  conflict: {
    code: "environment_not_ready",
    message: "Environment unavailable",
  },
};

function httpErrorBody(
  error: unknown,
): { code: string; message: string } | null {
  if (typeof error !== "object" || error === null || !("body" in error)) {
    return null;
  }
  const body = error.body;
  return typeof body === "object" &&
    body !== null &&
    "code" in body &&
    typeof body.code === "string" &&
    "message" in body &&
    typeof body.message === "string"
    ? { code: body.code, message: body.message }
    : null;
}

function toCliError(error: unknown): never {
  if (error instanceof experimental_PluginRpcRefusal) {
    const mapped = REFUSAL_CLI_ERRORS[error.code];
    throw new PluginCliError(mapped?.message ?? error.message, {
      code: mapped?.code ?? error.code,
    });
  }
  const body = httpErrorBody(error);
  if (body !== null)
    throw new PluginCliError(body.message, { code: body.code });
  throw error;
}

function guarded<Args extends unknown[], Result>(
  read: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  return (...args) => read(...args).catch(toCliError);
}

export function createGitCli(gitReads: GitReads, gitViewed: GitViewed) {
  const reads = {
    status: guarded(gitReads.status),
    diff: guarded(gitReads.diff),
    files: guarded(gitReads.files),
    patches: guarded(gitReads.patches),
    fileSide: guarded(gitReads.fileSide),
    branches: guarded(gitReads.branches),
  };
  const viewed = {
    list: guarded(gitViewed.list),
    mark: guarded(gitViewed.mark),
    clear: guarded(gitViewed.clear),
  };
  async function currentRevision(
    environmentId: string,
    target: WorkspaceDiffTarget,
    path: string,
  ): Promise<string> {
    const result = await reads.files(environmentId, target, false, "bypass");
    if (result.outcome !== "available") {
      throw new PluginCliError(
        `Diff files unavailable: ${unavailableMessage(result)}`,
      );
    }
    const file = result.files.find((entry) => entry.path === path);
    if (file === undefined) {
      throw new PluginCliError(`${path} is not a changed file in this diff.`);
    }
    return file.revision;
  }

  return defineCli({
    name: "git",
    summary: "Read an environment's git status, changed files and diffs",
    description:
      "Runs git on the environment's machine. Mark files Viewed the way the Diff tab does.",
    commands: {
      status: cliCommand({
        summary: "Show an environment's workspace status",
        positionals: ENVIRONMENT_POSITIONAL,
        options: {
          "merge-base-branch": {
            type: "string",
            description: "Include merge-base status",
          },
          json: JSON_OPTION,
        },
        run: withCoreErrors(async ({ positionals, options }) => {
          const mergeBaseBranch = options["merge-base-branch"];
          const result = await reads.status(
            positionals["environment-id"],
            {
              kind: "explicit",
              ...(mergeBaseBranch === undefined
                ? {}
                : { branch: branchName(mergeBaseBranch) }),
            },
            "bypass",
          );
          if (options.json) return json(result);
          if (result.outcome !== "available") {
            return print(`Status unavailable: ${unavailableMessage(result)}`);
          }
          const status = result.workspace;
          const mergeBase = status.mergeBase;
          return print(
            `State: ${status.workingTree.state}`,
            `Branch: ${status.branch.currentBranch ?? "(detached)"}`,
            `Default branch: ${status.branch.defaultBranch}`,
            `Changed files: ${status.workingTree.fileCount}`,
            status.workingTree.lineStatsComplete
              ? `Insertions: +${status.workingTree.insertions}`
              : "Line stats: unavailable for untracked files",
            status.workingTree.lineStatsComplete &&
              `Deletions: -${status.workingTree.deletions}`,
            mergeBase && `Merge base: ${mergeBase.mergeBaseBranch}`,
            mergeBase &&
              !mergeBase.squashMergeCheckComplete &&
              "Squash-merge check incomplete; counts may include already-merged commits.",
            mergeBase && `Ahead: ${mergeBase.aheadCount}`,
            mergeBase && `Behind: ${mergeBase.behindCount}`,
          );
        }),
      }),
      branches: cliCommand({
        summary: "List branches available in an environment",
        positionals: ENVIRONMENT_POSITIONAL,
        options: {
          query: { type: "string", description: "Branch-name filter" },
          limit: {
            type: "integer",
            min: 1,
            max: BRANCH_LIST_LIMIT_MAX,
            description: "Maximum local and remote branches",
          },
          json: JSON_OPTION,
        },
        run: withCoreErrors(async ({ positionals, options }) => {
          const result = await reads.branches({
            environmentId: positionals["environment-id"],
            limit: options.limit ?? DEFAULT_BRANCH_LIMIT,
            ...(options.query === undefined ? {} : { query: options.query }),
          });
          if (options.json) return json(result);
          return print(
            "Local branches:",
            ...result.branches.map((branch) => `  ${branch}`),
            result.branches.length === 0 && "  (none)",
            result.branchesTruncated && "  (truncated)",
            "Remote branches:",
            ...result.remoteBranches.map((branch) => `  ${branch}`),
            result.remoteBranches.length === 0 && "  (none)",
            result.remoteBranchesTruncated && "  (truncated)",
          );
        }),
      }),
      diff: cliCommand({
        summary: "Show an environment's git diff",
        positionals: ENVIRONMENT_POSITIONAL,
        options: { ...TARGET_OPTIONS, json: JSON_OPTION },
        run: withCoreErrors(async ({ positionals, options }) => {
          const result = await reads.diff(
            positionals["environment-id"],
            buildTarget(options),
          );
          if (options.json) return json(result);
          if (result.outcome !== "available") {
            return print(`Diff unavailable: ${unavailableMessage(result)}`);
          }
          const { diff } = result;
          return print(
            diff.files.trim().length > 0 && diff.files.trimEnd(),
            diff.shortstat.trim().length > 0 && diff.shortstat.trim(),
            diff.diff.length > 0 && diff.diff,
            diff.truncated && "(diff truncated)",
          );
        }),
      }),
      files: cliCommand({
        summary: "List changed files in an environment",
        aliases: ["diff-files"],
        positionals: ENVIRONMENT_POSITIONAL,
        options: {
          ...TARGET_OPTIONS,
          "ignore-whitespace": {
            type: "boolean",
            description: "Hide whitespace-only changes (git -w)",
          },
          json: JSON_OPTION,
        },
        run: withCoreErrors(async ({ positionals, options }) => {
          const result = await reads.files(
            positionals["environment-id"],
            buildTarget(options),
            options["ignore-whitespace"],
            "bypass",
          );
          if (options.json) {
            return json(
              result.outcome === "available"
                ? {
                    outcome: result.outcome,
                    files: result.files,
                    shortstat: result.shortstat,
                    mergeBaseRef: result.mergeBaseRef,
                    initialPatches: result.initialPatches,
                    truncated: result.truncated,
                  }
                : result,
            );
          }
          if (result.outcome !== "available") {
            return print(
              `Diff files unavailable: ${unavailableMessage(result)}`,
            );
          }
          return print(
            ...result.files.map((file) => {
              const path = file.previousPath
                ? `${file.previousPath} -> ${file.path}`
                : file.path;
              const stats = file.binary
                ? "binary"
                : `+${file.additions} -${file.deletions}`;
              return `${file.changeKind}\t${stats}\t${file.origin}\t${file.loadMode}\t${path}`;
            }),
            result.shortstat.trim().length > 0 && result.shortstat.trim(),
            result.truncated && "(additional changed files omitted)",
          );
        }),
      }),
      file: cliCommand({
        summary: "Read one side of a changed environment file",
        aliases: ["diff-file"],
        positionals: ENVIRONMENT_POSITIONAL,
        options: {
          target: TARGET_OPTIONS.target,
          path: {
            type: "string",
            required: true,
            description: "Repository-relative file path",
          },
          side: {
            type: "enum",
            values: ["old", "new"],
            required: true,
            description: "File side: old or new",
          },
          "merge-base-ref": {
            type: "string",
            description: "Resolved merge-base SHA",
          },
          sha: TARGET_OPTIONS.sha,
          json: JSON_OPTION,
        },
        run: withCoreErrors(async ({ positionals, options }) => {
          const side = await reads.fileSide(
            positionals["environment-id"],
            buildFileSideQuery(options),
          );
          if (side.outcome === "unavailable") {
            throw new PluginCliError(side.message, { code: side.code });
          }
          const result = side.file;
          if (options.json) return json(result);
          if (result.contentEncoding === "base64") {
            return print(
              `Binary file: ${result.path}`,
              `Encoding: ${result.contentEncoding}`,
              `Size: ${result.sizeBytes} bytes`,
              result.mimeType && `MIME type: ${result.mimeType}`,
              result.content,
            );
          }
          return print(result.content);
        }),
      }),
      patch: cliCommand({
        summary: "Fetch patches for selected changed files",
        aliases: ["diff-patch"],
        positionals: ENVIRONMENT_POSITIONAL,
        options: {
          ...TARGET_OPTIONS,
          path: {
            type: "string",
            repeatable: true,
            description: "Changed file path (repeatable)",
          },
          "ignore-whitespace": {
            type: "boolean",
            description: "Hide whitespace-only changes (git -w)",
          },
          json: JSON_OPTION,
        },
        run: withCoreErrors(async ({ positionals, options }) => {
          if (options.path.length === 0) fail("Provide at least one --path.");
          const result = await reads.patches(
            positionals["environment-id"],
            buildTarget(options),
            options["ignore-whitespace"],
            options.path,
            "bypass",
          );
          if (options.json) return json(result);
          if (result.outcome !== "available") {
            return print(
              `Diff patches unavailable: ${unavailableMessage(result)}`,
            );
          }
          return print(
            ...result.patches.flatMap((patch) => [
              `File: ${patch.path}`,
              patch.patch,
              patch.truncated ? "(patch truncated)" : null,
            ]),
          );
        }),
      }),
      "viewed list": cliCommand({
        summary: "List files marked Viewed",
        aliases: ["diff-viewed list"],
        positionals: ENVIRONMENT_POSITIONAL,
        options: {
          ...TARGET_OPTIONS,
          path: {
            type: "string",
            repeatable: true,
            description: "Limit to a changed path; repeat up to 500 times",
          },
          json: JSON_OPTION,
        },
        run: withCoreErrors(async ({ positionals, options }) => {
          const result = await viewed.list(
            positionals["environment-id"],
            buildTarget(options),
            options.path.length > 0 ? options.path : undefined,
          );
          if (options.json) return json(result);
          if (result.files.length === 0)
            return print("No files marked Viewed.");
          return print(
            ...result.files.map((file) => `${file.revision}\t${file.path}`),
          );
        }),
      }),
      "viewed mark": cliCommand({
        summary: "Mark a changed file Viewed at its current revision",
        aliases: ["diff-viewed mark"],
        positionals: ENVIRONMENT_POSITIONAL,
        options: {
          ...TARGET_OPTIONS,
          path: {
            type: "string",
            required: true,
            description: "Changed file path",
          },
          revision: {
            type: "string",
            description:
              "Revision to mark (default: the file's current revision from files)",
          },
          json: JSON_OPTION,
        },
        run: withCoreErrors(async ({ positionals, options }) => {
          const environmentId = positionals["environment-id"];
          const target = buildTarget(options);
          const revision =
            options.revision ??
            (await currentRevision(environmentId, target, options.path));
          const result = await viewed.mark(
            environmentId,
            target,
            options.path,
            revision,
          );
          return options.json ? json(result) : print("Viewed state updated.");
        }),
      }),
      "viewed unmark": cliCommand({
        summary: "Clear Viewed for one file",
        aliases: ["diff-viewed unmark"],
        positionals: ENVIRONMENT_POSITIONAL,
        options: {
          ...TARGET_OPTIONS,
          path: {
            type: "string",
            required: true,
            description: "Changed file path",
          },
          json: JSON_OPTION,
        },
        run: withCoreErrors(async ({ positionals, options }) => {
          const result = await viewed.clear(
            positionals["environment-id"],
            buildTarget(options),
            options.path,
          );
          return options.json ? json(result) : print("Viewed state updated.");
        }),
      }),
      "viewed clear": cliCommand({
        summary: "Clear Viewed for every file in the diff target",
        aliases: ["diff-viewed clear"],
        positionals: ENVIRONMENT_POSITIONAL,
        options: { ...TARGET_OPTIONS, json: JSON_OPTION },
        run: withCoreErrors(async ({ positionals, options }) => {
          const result = await viewed.clear(
            positionals["environment-id"],
            buildTarget(options),
            undefined,
          );
          return options.json ? json(result) : print("Viewed state updated.");
        }),
      }),
    },
  });
}
