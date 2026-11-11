import { defineRpcContract } from "@get-bb/plugin-sdk";
import { experimental_useRpcKeyedQuery } from "@get-bb/plugin-sdk/app";
import { z } from "zod";

const GIT_PLUGIN_ID = "bb--git";
const PULL_REQUEST_PLUGIN_ID = "bb--github-pr-status";
const MAX_KEYS = 200;

const keysInput = z.object({ keys: z.array(z.string().min(1)) });

const changeTotalsSchema = z.looseObject({
  insertions: z.number(),
  deletions: z.number(),
});

const gitStatusRowSchema = z.looseObject({
  outcome: z.string(),
  workspace: z
    .looseObject({
      allChanges: changeTotalsSchema,
      branch: z.looseObject({ currentBranch: z.string().nullable() }),
    })
    .optional(),
});

const gitReadContract = defineRpcContract({
  status: {
    input: keysInput,
    output: z.record(z.string(), gitStatusRowSchema),
  },
});

const pullRequestRowSchema = z.looseObject({
  outcome: z.string(),
  pullRequest: z
    .looseObject({
      number: z.number(),
      title: z.string(),
      state: z.string(),
      url: z.string(),
      attention: z.string(),
    })
    .optional(),
});

const pullRequestReadContract = defineRpcContract({
  pullRequests: {
    input: keysInput,
    output: z.record(z.string(), pullRequestRowSchema),
  },
});

export interface WorkspaceChanges {
  insertions: number;
  deletions: number;
  branch: string | null;
}

export type PullRequestState = "open" | "draft" | "merged" | "closed";

export interface WorkspacePullRequest {
  number: number;
  title: string;
  url: string;
  state: PullRequestState;
  needsAttention: boolean;
}

function toPullRequestState(state: string): PullRequestState {
  const normalized = state.toLowerCase();
  if (normalized === "merged") return "merged";
  if (normalized === "closed") return "closed";
  if (normalized === "draft") return "draft";
  return "open";
}

const ATTENTION_STATES = new Set([
  "checks_failed",
  "changes_requested",
  "conflicts",
]);

export function useWorkspaceChanges(
  environmentIds: readonly string[],
): ReadonlyMap<string, WorkspaceChanges> {
  const keys = environmentIds.slice(0, MAX_KEYS);
  const query = experimental_useRpcKeyedQuery({
    pluginId: GIT_PLUGIN_ID,
    contract: gitReadContract,
    method: "status",
    keys,
    enabled: keys.length > 0,
  });
  const rows = new Map<string, WorkspaceChanges>();
  for (const [environmentId, row] of Object.entries(query.data ?? {})) {
    if (row.outcome !== "available" || row.workspace === undefined) continue;
    rows.set(environmentId, {
      insertions: row.workspace.allChanges.insertions,
      deletions: row.workspace.allChanges.deletions,
      branch: row.workspace.branch.currentBranch,
    });
  }
  return rows;
}

export function useWorkspacePullRequests(
  environmentIds: readonly string[],
): ReadonlyMap<string, WorkspacePullRequest> {
  const keys = environmentIds.slice(0, MAX_KEYS);
  const query = experimental_useRpcKeyedQuery({
    pluginId: PULL_REQUEST_PLUGIN_ID,
    contract: pullRequestReadContract,
    method: "pullRequests",
    keys,
    enabled: keys.length > 0,
  });
  const rows = new Map<string, WorkspacePullRequest>();
  for (const [environmentId, row] of Object.entries(query.data ?? {})) {
    if (row.outcome !== "available" || row.pullRequest === undefined) continue;
    const pullRequest = row.pullRequest;
    rows.set(environmentId, {
      number: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.url,
      state: toPullRequestState(pullRequest.state),
      needsAttention: ATTENTION_STATES.has(pullRequest.attention),
    });
  }
  return rows;
}
