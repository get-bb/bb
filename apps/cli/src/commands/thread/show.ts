import { Command } from "commander";
import {
  formatThreadTimelineText,
  type ThreadTimelineTextFormat,
} from "@bb/thread-view";
import {
  resolveEnvironmentMergeBaseBranch,
  type Environment,
  type Thread,
  type ThreadGitDiffResponse,
  type ThreadTimelinePendingTodos,
  type WorkspaceStatus,
} from "@bb/domain";
import type { BbSdk } from "@bb/sdk";
import type {
  EnvironmentDiffQuery,
  ThreadTimelineResponse,
} from "@bb/server-contract";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import {
  outputJson,
  printContextLabel,
  requireThreadIdWithLabelOrSelf,
} from "../helpers.js";
import {
  type ThreadEnvironmentInfo,
  fetchEnvironmentInfo,
  printEnvironmentInfo,
} from "../environment-helpers.js";
import { statusText } from "./helpers.js";
import { fetchThreadPendingTodos, printPendingTodos } from "./pending-todos.js";

interface ThreadShowCommandOptions {
  self?: boolean;
  workStatus?: boolean;
  gitDiff?: boolean;
  diffTarget?: string;
  diffSha?: string;
  diffMergeBase?: string;
  mergeBaseBranches?: boolean;
  json?: boolean;
}

interface ThreadLogCommandOptions {
  self?: boolean;
  json?: boolean;
  format?: string;
  limit?: string;
  afterSeq?: string;
}

interface ThreadOutputCommandOptions {
  json?: boolean;
}

interface ThreadStatusPayload {
  thread: Thread;
}

interface ThreadShowJsonPayload extends ThreadStatusPayload {
  environment: Environment | null;
  pendingTodos: ThreadTimelinePendingTodos | null;
  workStatus?: WorkspaceStatus | null;
  gitDiff?: ThreadGitDiffResponse | null;
  mergeBaseBranches?: string[];
}

type FetchedWorkStatus =
  | { available: true; status: WorkspaceStatus }
  | { available: false; message: string };

type FetchedGitDiff =
  | { available: true; diff: ThreadGitDiffResponse }
  | { available: false; message: string };

type CliEnvironmentDiffQuery =
  | { target: "uncommitted" }
  | { mergeBaseBranch?: string; target: "branch_committed" }
  | { mergeBaseBranch?: string; target: "all" }
  | { sha: string; target: "commit" };

async function fetchWorkStatus(args: {
  environmentId: string;
  mergeBaseBranch: string;
  sdk: BbSdk;
}): Promise<FetchedWorkStatus> {
  const environmentStatus = await args.sdk.environments.status({
    environmentId: args.environmentId,
    mergeBaseBranch: args.mergeBaseBranch,
  });
  if (environmentStatus.outcome === "available") {
    return { available: true, status: environmentStatus.workspace };
  }
  if (environmentStatus.outcome === "not_applicable") {
    return { available: false, message: environmentStatus.message };
  }
  return { available: false, message: environmentStatus.failure.message };
}

async function fetchGitDiff(args: {
  environmentId: string;
  query: EnvironmentDiffQuery;
  sdk: BbSdk;
}): Promise<FetchedGitDiff> {
  const environmentDiff = await args.sdk.environments.diff({
    environmentId: args.environmentId,
    ...args.query,
  });
  if (environmentDiff.outcome === "available") {
    return { available: true, diff: environmentDiff.diff };
  }
  if (environmentDiff.outcome === "not_applicable") {
    return { available: false, message: environmentDiff.message };
  }
  return { available: false, message: environmentDiff.failure.message };
}

export function registerShowCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("show [id]")
    .description("Show thread details (defaults to BB_THREAD_ID)")
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .option("--work-status", "Include work status (git state) in output")
    .option("--git-diff", "Include git diff in output")
    .option(
      "--diff-target <type>",
      "Diff target: uncommitted, branch_committed, all, or commit (used with --git-diff)",
      "all",
    )
    .option("--diff-sha <sha>", "Commit SHA for --diff-target commit")
    .option(
      "--diff-merge-base <branch>",
      "Merge base branch for --diff-target branch_committed or all",
    )
    .option(
      "--merge-base-branches",
      "Include available merge-base branches in output",
    )
    .action(
      action(async (id: string | undefined, opts: ThreadShowCommandOptions) => {
        const resolved = requireThreadIdWithLabelOrSelf(id, opts);
        const sdk = createCliBbSdk(getUrl());
        const threadId = resolved.id;
        printContextLabel(resolved, "Thread", "BB_THREAD_ID", opts);
        const thread = await sdk.threads.get({ threadId });

        const statusPayload: ThreadStatusPayload = { thread };
        let environment: Environment | null | undefined;
        const getEnvironment = async () => {
          if (!thread.environmentId) {
            return null;
          }
          if (environment !== undefined) {
            return environment;
          }
          environment = await sdk.environments.get({
            environmentId: thread.environmentId,
          });
          return environment;
        };
        const requireMergeBaseBranch = async (override?: string) => {
          const environment = await getEnvironment();
          const mergeBaseBranch =
            override ?? resolveEnvironmentMergeBaseBranch(environment);
          if (!mergeBaseBranch) {
            throw new Error(
              "Thread environment does not have a merge base branch",
            );
          }
          return mergeBaseBranch;
        };

        let fetchedWorkStatus: FetchedWorkStatus | undefined;
        if (opts.workStatus && thread.environmentId) {
          const mergeBaseBranch = await requireMergeBaseBranch();
          fetchedWorkStatus = await fetchWorkStatus({
            environmentId: thread.environmentId,
            mergeBaseBranch,
            sdk,
          });
        }

        let fetchedGitDiff: FetchedGitDiff | undefined;
        if (opts.gitDiff && thread.environmentId) {
          const diffTarget = (opts.diffTarget ?? "all").trim();
          const query: CliEnvironmentDiffQuery = (() => {
            switch (diffTarget) {
              case "uncommitted":
                return { target: "uncommitted" };
              case "branch_committed":
                return {
                  target: "branch_committed",
                  mergeBaseBranch: opts.diffMergeBase,
                };
              case "all":
                return {
                  target: "all",
                  mergeBaseBranch: opts.diffMergeBase,
                };
              case "commit":
                if (!opts.diffSha) {
                  throw new Error(
                    "--diff-sha is required when --diff-target commit is used",
                  );
                }
                return {
                  target: "commit",
                  sha: opts.diffSha,
                };
              default:
                throw new Error(
                  "Unsupported --diff-target. Use uncommitted, branch_committed, all, or commit.",
                );
            }
          })();
          const resolvedQuery: EnvironmentDiffQuery =
            query.target === "branch_committed" || query.target === "all"
              ? {
                  target: query.target,
                  mergeBaseBranch: await requireMergeBaseBranch(
                    query.mergeBaseBranch,
                  ),
                }
              : query;
          fetchedGitDiff = await fetchGitDiff({
            environmentId: thread.environmentId,
            query: resolvedQuery,
            sdk,
          });
        }

        let mergeBaseBranches: string[] | undefined;
        if (opts.mergeBaseBranches && thread.environmentId) {
          const branchResponse = await sdk.environments.diffBranches({
            environmentId: thread.environmentId,
          });
          mergeBaseBranches = branchResponse.branches;
        }

        const environmentInfo = thread.environmentId
          ? await fetchEnvironmentInfo({
              environmentId: thread.environmentId,
              sdk,
            })
          : null;

        const pendingTodos = await fetchThreadPendingTodos({
          sdk,
          threadId,
        });

        if (opts.json) {
          const jsonPayload: ThreadShowJsonPayload = {
            ...statusPayload,
            environment: await getEnvironment(),
            pendingTodos,
          };
          if (fetchedWorkStatus !== undefined) {
            jsonPayload.workStatus = fetchedWorkStatus.available
              ? fetchedWorkStatus.status
              : null;
          }
          if (fetchedGitDiff !== undefined) {
            jsonPayload.gitDiff = fetchedGitDiff.available
              ? fetchedGitDiff.diff
              : null;
          }
          if (mergeBaseBranches !== undefined) {
            jsonPayload.mergeBaseBranches = mergeBaseBranches;
          }
          outputJson(opts, jsonPayload);
          return;
        }

        printThreadStatus(statusPayload, environmentInfo);

        printPendingTodos(pendingTodos);

        if (fetchedWorkStatus !== undefined) {
          if (fetchedWorkStatus.available) {
            const ws = fetchedWorkStatus.status;
            console.log("");
            console.log("Work status:");
            console.log(`  State:    ${ws.workingTree.state}`);
            if (ws.branch.currentBranch) {
              console.log(`  Branch:   ${ws.branch.currentBranch}`);
            }
            console.log(`  Changed files: ${ws.workingTree.files.length}`);
            console.log(`  Insertions:    +${ws.workingTree.insertions}`);
            console.log(`  Deletions:     -${ws.workingTree.deletions}`);
            if (ws.mergeBase) {
              console.log(`  Merge base:   ${ws.mergeBase.mergeBaseBranch}`);
              console.log(
                `  Ahead: ${ws.mergeBase.aheadCount}  Behind: ${ws.mergeBase.behindCount}`,
              );
            }
          } else {
            console.log("");
            console.log(`Work status: ${fetchedWorkStatus.message}`);
          }
        }

        if (fetchedGitDiff) {
          console.log("");
          if (fetchedGitDiff.available) {
            const gitDiff = fetchedGitDiff.diff;
            console.log("Git diff:");
            if (gitDiff.files.trim().length > 0) {
              console.log(`  Files:\n${gitDiff.files.trimEnd()}`);
            }
            if (gitDiff.shortstat.trim().length > 0) {
              console.log(`  Summary: ${gitDiff.shortstat.trim()}`);
            }
            if (gitDiff.diff) {
              console.log("");
              console.log(gitDiff.diff);
            }
            if (gitDiff.truncated) {
              console.log("  (diff truncated)");
            }
          } else {
            console.log(`Git diff: ${fetchedGitDiff.message}`);
          }
        }

        if (mergeBaseBranches !== undefined) {
          console.log("");
          if (mergeBaseBranches.length === 0) {
            console.log("Merge-base branches: none");
          } else {
            console.log("Merge-base branches:");
            for (const branch of mergeBaseBranches) {
              console.log(`  ${branch}`);
            }
          }
        }
      }),
    );

  parent
    .command("log [id]")
    .description("Show thread event log (defaults to BB_THREAD_ID)")
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option(
      "--json",
      "Print machine-readable JSON output (alias for --format json)",
    )
    .option(
      "--format <format>",
      "Output format: json (raw events), minimal (compact timeline), verbose (expanded timeline)",
      "minimal",
    )
    .option(
      "--limit <count>",
      "Maximum number of events to return; json format only (default 100)",
    )
    .option(
      "--after-seq <seq>",
      "Return events after this sequence number; json format only",
    )
    .action(
      action(async (id: string | undefined, opts: ThreadLogCommandOptions) => {
        const resolved = requireThreadIdWithLabelOrSelf(id, opts);
        const sdk = createCliBbSdk(getUrl());
        const threadId = resolved.id;
        printContextLabel(resolved, "Thread", "BB_THREAD_ID", opts);
        const format = resolveThreadTimelineTextFormat(opts);

        if (format !== "json" && (opts.limit || opts.afterSeq)) {
          throw new Error(
            "--limit and --after-seq are only supported with --format json",
          );
        }

        if (format === "json") {
          const events = await sdk.threads.events.list({
            threadId,
            limit: String(opts.limit ?? 100),
            ...(opts.afterSeq ? { afterSeq: opts.afterSeq } : {}),
          });
          console.log(JSON.stringify(events, null, 2));
          return;
        }

        const timeline: ThreadTimelineResponse = await sdk.threads.timeline({
          threadId,
          ...(format === "verbose" ? { includeNestedRows: "true" } : {}),
        });
        const color = process.stdout.isTTY === true && !process.env.NO_COLOR;
        const text = formatThreadTimelineText(timeline.rows, {
          verbose: format === "verbose",
          color,
        });
        console.log(text);
      }),
    );

  parent
    .command("output <id>")
    .description("Get the final output of a thread")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: ThreadOutputCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const result = await sdk.threads.output({ threadId: id });
        if (outputJson(opts, result)) return;
        if (result.output) {
          console.log(result.output);
        } else {
          console.log("(no output)");
        }
      }),
    );
}

function printThreadStatus(
  payload: ThreadStatusPayload,
  environmentInfo: ThreadEnvironmentInfo | null,
): void {
  const { thread } = payload;
  console.log(`Thread: ${thread.id}`);
  console.log(`  Type: ${thread.type}`);
  console.log(`  Status: ${statusText(thread.status)}`);
  if (thread.title) {
    console.log(`  Title: ${thread.title}`);
  }
  console.log(`  Project: ${thread.projectId}`);
  if (thread.parentThreadId) {
    console.log(`  Parent: ${thread.parentThreadId}`);
  }
  if (thread.archivedAt !== null) {
    console.log(`  Archived: ${new Date(thread.archivedAt).toLocaleString()}`);
  }
  if (thread.pinnedAt !== null) {
    console.log(`  Pinned: ${new Date(thread.pinnedAt).toLocaleString()}`);
  }
  if (environmentInfo) {
    printEnvironmentInfo(environmentInfo);
  } else if (thread.environmentId) {
    console.log(`  Environment: ${thread.environmentId}`);
  }
  console.log(`  Created: ${new Date(thread.createdAt).toLocaleString()}`);
  console.log(`  Updated: ${new Date(thread.updatedAt).toLocaleString()}`);
}

function resolveThreadTimelineTextFormat(
  opts: ThreadLogCommandOptions,
): ThreadTimelineTextFormat {
  if (opts.json) {
    return "json";
  }
  const normalized = (opts.format ?? "minimal").trim().toLowerCase();
  if (normalized === "json") {
    return "json";
  }
  if (normalized === "verbose") {
    return "verbose";
  }
  return "minimal";
}
