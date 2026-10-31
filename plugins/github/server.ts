import { experimental_execHostFileCallback as execFile } from "@get-bb/plugin-sdk/process";
import {
  experimental_runVcsProcess as runVcsProcess,
  type ExperimentalVcsProcessPriority as VcsProcessPriority,
} from "@get-bb/plugin-sdk/host";
import {
  defineRpcContract,
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  AGENT_PRESETS,
  agentThreadTitle,
  issuePrompt,
  issueThreadTitle,
  presetLabel,
  presetPrompt,
} from "./agent-presets.js";
import {
  assemblePullStatus,
  inPullView,
  isFailedCheck,
  mergeBlockedReason,
  PULL_VIEWS,
  pullGroup,
  pullNextStep,
  pullPreset,
  pullStateCommands,
  type AgentPreset,
  type PullStateTarget,
  type PullStatus,
  type PullView,
} from "./pull-status.js";
import {
  nextMondayMorning,
  snoozeFor,
  snoozeLabel,
  snoozeWakes,
  tomorrowMorning,
  type Snooze,
  type SnoozeRule,
} from "./snooze.js";

const SYNC_INTERVAL_MS = 15 * 60_000;
const SYNC_RETRY_MAX_MS = 5 * 60_000;
const SYNC_RETRY_BASE_MS = 30_000;
const ISSUE_PAGE = 100;
const CLOSED_ISSUE_PAGE = 50;
const PR_PAGE = 50;
const CLOSED_PR_PAGE = 30;

const GH_HINT =
  "Install the GitHub CLI (https://cli.github.com) and run `gh auth login`, " +
  "then `bb plugin reload github`.";

const repoNameSchema = z.string().regex(/^[\w.-]+\/[\w.-]+$/);
const itemNumberSchema = z.number().int().positive();
const itemInputSchema = z
  .object({ repo: repoNameSchema, number: itemNumberSchema })
  .strict();
const nonBlankStringSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "must not be blank");
const repoInfoSchema = z
  .object({ repo: repoNameSchema, projectId: z.string().nullable() })
  .strict();
const pullStatusSchema = z
  .object({
    state: z.enum(["open", "draft", "merged", "closed"]),
    baseRefName: z.string(),
    headRefName: z.string(),
    headRefOid: z.string().nullable(),
    isCrossRepository: z.boolean(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    changedFiles: z.number().int().nonnegative(),
    mergedAt: z.string().nullable(),
    stack: z
      .object({
        number: z.number().int().positive(),
        size: z.number().int().nonnegative(),
        position: z.number().int().positive(),
      })
      .strict()
      .nullable(),
    headOwner: z.string().nullable(),
    checks: z
      .object({
        state: z.enum([
          "passing",
          "failing",
          "pending",
          "no_checks",
          "unknown",
        ]),
        passed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        pending: z.number().int().nonnegative(),
      })
      .strict(),
    review: z
      .object({
        state: z.enum([
          "approved",
          "changes_requested",
          "review_requested",
          "review_required",
          "none",
        ]),
        requested: z.array(z.string()),
      })
      .strict(),
    mergeability: z.enum(["conflicts", "draft", "mergeable", "unknown"]),
    attention: z.enum([
      "merged",
      "closed",
      "conflicts",
      "checks_failed",
      "changes_requested",
      "draft",
      "queued",
      "review_requested",
      "checks_pending",
      "ready_to_merge",
      "none",
    ]),
  })
  .strict() satisfies z.ZodType<PullStatus>;
const cachedItemSchema = z
  .object({
    repo: repoNameSchema,
    number: itemNumberSchema,
    kind: z.enum(["issue", "pr"]),
    title: z.string(),
    state: z.string(),
    author: z.string(),
    labels: z.array(z.string()),
    assignees: z.array(z.string()),
    url: z.string(),
    body: z.string(),
    updatedAt: z.string(),
    pr: pullStatusSchema.nullable(),
  })
  .strict();
const snoozeRuleSchema = z.enum([
  "checks",
  "push",
  "time",
]) satisfies z.ZodType<SnoozeRule>;
const itemSnoozeSchema = z
  .object({ rule: snoozeRuleSchema, until: z.string().nullable() })
  .strict();
const itemSchema = cachedItemSchema
  .extend({ snooze: itemSnoozeSchema.nullable() })
  .strict();
const storedViewerSchema = z.object({ login: z.string().min(1) }).strict();

const storedSnoozeSchema = z.object({
  rule: snoozeRuleSchema,
  until: z.string().nullable(),
  createdAt: z.string(),
  checks: z.string().nullable(),
  headRefOid: z.string().nullable(),
}) satisfies z.ZodType<Snooze>;
const mergeMethodSchema = z.enum(["squash", "merge", "rebase"]);
const repoSettingsSchema = z
  .object({
    viewerCanWrite: z.boolean(),
    mergeMethods: z.array(mergeMethodSchema),
    defaultMergeMethod: mergeMethodSchema,
    deleteBranchOnMerge: z.boolean(),
  })
  .strict();
type RepoSettings = z.infer<typeof repoSettingsSchema>;

const syncResultSchema = z
  .object({
    repos: z.number().int().nonnegative(),
    items: z.number().int().nonnegative(),
  })
  .strict();
const okResultSchema = z.object({ ok: z.literal(true) }).strict();
const commentSchema = z
  .object({ author: z.string(), body: z.string(), createdAt: z.string() })
  .strict();
const threadLinkSchema = z
  .object({
    kind: z.enum(["issue", "pr"]),
    repo: repoNameSchema,
    number: itemNumberSchema,
    threadId: z.string().min(1),
    createdAt: z.string(),
  })
  .strict();
const pullSchema = z
  .object({
    repo: repoNameSchema,
    number: itemNumberSchema,
    title: z.string(),
    state: z.string(),
    author: z.string(),
    body: z.string(),
    url: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    baseRefName: z.string(),
    headRefName: z.string(),
    additions: z.number().nonnegative(),
    deletions: z.number().nonnegative(),
    changedFiles: z.number().int().nonnegative(),
    labels: z.array(z.string()),
    assignees: z.array(z.string()),
    reviewDecision: z.string(),
    mergeStateStatus: z.string(),
    mergeable: z.string(),
    reviewRequests: z.array(z.string()),
    isDraft: z.boolean(),
    headRefOid: z.string(),
    isCrossRepository: z.boolean(),
    isInMergeQueue: z.boolean(),
    headCommittedAt: z.string().nullable(),
    closedAt: z.string().nullable(),
    mergedAt: z.string().nullable(),
    mergedBy: z.string().nullable(),
    viewerCanUpdate: z.boolean(),
    viewerCanClose: z.boolean(),
    viewerCanReopen: z.boolean(),
    viewerCanMerge: z.boolean(),
    viewerCanDeleteHeadRef: z.boolean(),
    isMergeQueueEnabled: z.boolean(),
    headRefExists: z.boolean(),
    checksVerdict: z.string().nullable(),
    mergeMethods: z.array(mergeMethodSchema),
    defaultMergeMethod: mergeMethodSchema,
    deleteBranchOnMerge: z.boolean(),
    reviewVerdicts: z.array(
      z.object({ author: z.string(), state: z.string() }).strict(),
    ),
    events: z.array(
      z
        .object({
          kind: z.enum([
            "ready",
            "draft",
            "closed",
            "reopened",
            "merged",
            "force_pushed",
            "commit",
            "base_changed",
            "head_deleted",
          ]),
          actor: z.string(),
          createdAt: z.string(),
          detail: z.string().nullable(),
        })
        .strict(),
    ),
    stack: z
      .object({
        number: z.number().int().positive(),
        baseRefName: z.string(),
        position: z.number().int().nonnegative(),
        entries: z.array(
          z
            .object({
              number: itemNumberSchema,
              title: z.string(),
              state: z.enum(["open", "draft", "merged", "closed"]),
              attention: z.enum([
                "conflicts",
                "checks_failed",
                "draft",
                "ready_to_merge",
                "none",
              ]),
            })
            .strict(),
        ),
      })
      .strict()
      .nullable(),
    checks: z.array(
      z
        .object({
          name: z.string(),
          workflow: z.string().nullable(),
          status: z.enum(["success", "failure", "pending", "skipped"]),
          url: z.string(),
          runId: z.number().int().positive().nullable(),
          completedAt: z.string().nullable(),
          required: z.boolean(),
        })
        .strict(),
    ),
    comments: z.array(commentSchema),
    reviews: z.array(
      z
        .object({
          author: z.string(),
          state: z.string(),
          body: z.string(),
          createdAt: z.string(),
        })
        .strict(),
    ),
    reviewThreads: z.array(
      z
        .object({
          path: z.string(),
          line: z.number().int().nonnegative().nullable(),
          diffHunk: z.string(),
          comments: z.array(commentSchema),
        })
        .strict(),
    ),
    files: z.array(
      z
        .object({
          path: z.string(),
          status: z.string(),
          additions: z.number().nonnegative(),
          deletions: z.number().nonnegative(),
          patch: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

const pullStateTargetSchema = z.enum([
  "open",
  "draft",
  "closed",
]) satisfies z.ZodType<PullStateTarget>;

export const githubRpcContract = defineRpcContract({
  status: {
    input: z.null(),
    output: z
      .object({
        ghOk: z.boolean(),
        ghState: z.enum(["ready", "needs_configuration", "unavailable"]),
        ghError: z.string().nullable(),
        repos: z.array(repoInfoSchema),
        defaultProjectId: z.string().nullable(),
        lastSyncedAt: z.string().nullable(),
        lastSyncError: z.string().nullable(),
      })
      .strict(),
  },
  refresh: { input: z.null(), output: syncResultSchema },
  listItems: {
    input: z
      .object({
        kind: z.enum(["issue", "pr"]).optional(),
        repo: repoNameSchema.optional(),
        query: z.string().optional(),
        state: z.enum(["open", "closed"]).optional(),
        mine: z.boolean().optional(),
      })
      .strict(),
    output: z.object({ items: z.array(itemSchema) }).strict(),
  },
  viewer: {
    input: z.null(),
    output: z.object({ login: z.string().min(1) }).strict(),
  },
  assignableUsers: {
    input: z.object({ repo: repoNameSchema }).strict(),
    output: z.object({ users: z.array(z.string().min(1)) }).strict(),
  },
  repositoryLabels: {
    input: z.object({ repo: repoNameSchema }).strict(),
    output: z.object({ labels: z.array(z.string().min(1)) }).strict(),
  },
  setIssueState: {
    input: itemInputSchema
      .extend({ state: z.enum(["open", "closed"]) })
      .strict(),
    output: okResultSchema,
  },
  setAssignees: {
    input: itemInputSchema
      .extend({ assignees: z.array(z.string().min(1)) })
      .strict(),
    output: z
      .object({ ok: z.literal(true), assignees: z.array(z.string().min(1)) })
      .strict(),
  },
  setLabels: {
    input: itemInputSchema.extend({ labels: z.array(z.string()) }).strict(),
    output: z
      .object({ ok: z.literal(true), labels: z.array(z.string().min(1)) })
      .strict(),
  },
  getIssue: {
    input: itemInputSchema,
    output: z
      .object({
        issue: z
          .object({
            repo: repoNameSchema,
            number: itemNumberSchema,
            title: z.string(),
            state: z.string(),
            author: z.string(),
            body: z.string(),
            labels: z.array(z.string()),
            assignees: z.array(z.string()),
            url: z.string(),
            updatedAt: z.string(),
            comments: z.array(commentSchema),
          })
          .strict(),
      })
      .strict(),
  },
  getPull: {
    input: itemInputSchema,
    output: z.object({ pull: pullSchema }).strict(),
  },
  setPullState: {
    input: itemInputSchema.extend({ state: pullStateTargetSchema }).strict(),
    output: z
      .object({ ok: z.literal(true), state: pullStateTargetSchema })
      .strict(),
  },
  mergePull: {
    input: itemInputSchema
      .extend({
        method: mergeMethodSchema,
        deleteBranch: z.boolean(),
        headRefOid: z.string().min(1).nullable(),
      })
      .strict(),
    output: z
      .object({
        ok: z.literal(true),
        method: mergeMethodSchema,
        deletedBranch: z.boolean(),
      })
      .strict(),
  },
  rerunFailedChecks: {
    input: itemInputSchema,
    output: z
      .object({
        ok: z.literal(true),
        runs: z.number().int().nonnegative(),
        checks: z.number().int().nonnegative(),
      })
      .strict(),
  },
  snoozePull: {
    input: itemInputSchema
      .extend({ rule: snoozeRuleSchema, until: z.string().nullable() })
      .strict(),
    output: z
      .object({ ok: z.literal(true), snooze: itemSnoozeSchema })
      .strict(),
  },
  unsnoozePull: {
    input: itemInputSchema,
    output: okResultSchema,
  },
  linkThread: {
    input: itemInputSchema
      .extend({
        kind: z.enum(["issue", "pr"]),
        threadId: z.string().min(1),
      })
      .strict(),
    output: okResultSchema,
  },
  repoSettings: {
    input: z.null(),
    output: z
      .object({ repos: z.record(z.string(), repoSettingsSchema) })
      .strict(),
  },
  commentPull: {
    input: itemInputSchema.extend({ body: nonBlankStringSchema }).strict(),
    output: okResultSchema,
  },
  pullForThread: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z
      .object({
        pull: z
          .object({
            repo: repoNameSchema,
            number: itemNumberSchema,
            environmentId: z.string().nullable(),
          })
          .strict()
          .nullable(),
      })
      .strict(),
  },
  commentIssue: {
    input: itemInputSchema.extend({ body: nonBlankStringSchema }).strict(),
    output: okResultSchema,
  },
  createIssue: {
    input: z
      .object({
        repo: repoNameSchema,
        title: nonBlankStringSchema,
        body: z.string().optional(),
      })
      .strict(),
    output: z
      .object({ number: itemNumberSchema.nullable(), url: z.string() })
      .strict(),
  },
  listLinks: {
    input: z.null(),
    output: z
      .object({ links: z.record(z.string(), z.array(threadLinkSchema)) })
      .strict(),
  },
});

type RepoInfo = z.infer<typeof repoInfoSchema>;
type CachedItem = z.infer<typeof cachedItemSchema>;
type ListedItem = z.infer<typeof itemSchema>;
type ThreadLink = z.infer<typeof threadLinkSchema>;

interface GhListEntry {
  number?: unknown;
  title?: unknown;
  state?: unknown;
  author?: { login?: unknown };
  labels?: Array<{ name?: unknown }>;
  assignees?: Array<{ login?: unknown }>;
  url?: unknown;
  body?: unknown;
  updatedAt?: unknown;
}

type GhRunner = (args: string[]) => Promise<string>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function needsConfiguration(message: string): Error {
  return Object.assign(new Error(message), {
    name: "NeedsConfigurationError",
  });
}

function isNeedsConfigurationError(error: unknown): error is Error {
  return error instanceof Error && error.name === "NeedsConfigurationError";
}

function ghUnavailable(message: string): Error {
  return Object.assign(new Error(message), { name: "GhUnavailableError" });
}

function isGhUnavailableError(error: unknown): error is Error {
  return error instanceof Error && error.name === "GhUnavailableError";
}

const GH_NO_CREDENTIALS = /no oauth token|not logged in/i;
const GH_HOST = "github.com";

function parseGithubRemote(url: string): string | null {
  const match = url
    .trim()
    .match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  if (match === null) return null;
  return `${match[1]}/${match[2]}`;
}

function isRepoName(value: unknown): value is string {
  return typeof value === "string" && /^[\w.-]+\/[\w.-]+$/.test(value);
}

export function parseExtraRepos(raw: string): {
  repos: string[];
  ignored: string[];
} {
  const repos: string[] = [];
  const ignored: string[] = [];
  for (const entry of raw.split(/[\s,]+/)) {
    if (entry === "") continue;
    if (isRepoName(entry)) {
      if (!repos.includes(entry)) repos.push(entry);
    } else if (!ignored.includes(entry)) {
      ignored.push(entry);
    }
  }
  return { repos, ignored };
}

function describeIgnoredExtraRepos(ignored: string[]): string {
  return (
    `ignoring ${ignored.length} extraRepos ${ignored.length === 1 ? "entry" : "entries"} ` +
    `that ${ignored.length === 1 ? "is" : "are"} not "owner/repo": ${ignored.join(", ")}`
  );
}

const environmentPullRequestUrlsSchema = z.record(
  z.string(),
  z.union([
    z.object({
      outcome: z.literal("available"),
      pullRequest: z.object({ url: z.string() }),
    }),
    z.object({ outcome: z.enum(["absent", "unavailable"]) }),
  ]),
);

function run(
  file: string,
  args: string[],
  timeoutMs = 30_000,
  priority: VcsProcessPriority = "background",
): Promise<{ stdout: string; stderr: string }> {
  return runVcsProcess(
    file === "git" ? "git" : "gh",
    args,
    () =>
      new Promise((resolve, reject) => {
        execFile(
          file,
          args,
          { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
          (error, stdout, stderr) => {
            if (error) {
              reject(
                new Error(
                  `${file} ${args.slice(0, 3).join(" ")} failed: ${
                    stderr.trim() || error.message
                  }`,
                ),
              );
            } else {
              resolve({ stdout, stderr });
            }
          },
        );
      }),
    { priority },
  );
}

export function parsePaginatedGhApi(raw: string): Record<string, unknown>[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("GitHub API pagination returned a non-array response");
  }
  const rows: Record<string, unknown>[] = [];
  for (const page of parsed) {
    if (!Array.isArray(page)) {
      throw new Error("GitHub API pagination returned a malformed page");
    }
    for (const row of page) {
      if (typeof row !== "object" || row === null || Array.isArray(row)) {
        throw new Error("GitHub API pagination returned a malformed row");
      }
      rows.push(row as Record<string, unknown>);
    }
  }
  return rows;
}

function requireRepoName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!isRepoName(value)) {
    throw new PluginCliError(
      `Invalid repository "${value}"; expected owner/repo.`,
      { code: "invalid_repository" },
    );
  }
  return value;
}

const listNodeSchema = z.object({
  number: itemNumberSchema,
  title: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  author: z.object({ login: z.string(), id: z.string().optional() }).nullable(),
  labels: z.object({ nodes: z.array(z.object({ name: z.string() })).max(100) }),
  assignees: z.object({
    nodes: z.array(z.object({ login: z.string() })).max(100),
  }),
  url: z.string(),
  body: z.string(),
  updatedAt: z.string(),
});
const stateCountsSchema = z
  .array(z.object({ state: z.string(), count: z.number().int().nonnegative() }))
  .nullable();
const pullChangeFields = {
  headRefOid: z.string(),
  isCrossRepository: z.boolean(),
  headRepositoryOwner: z.object({ login: z.string() }).nullable(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  changedFiles: z.number().int().nonnegative(),
  stack: z
    .object({
      number: z.number().int().positive(),
      size: z.number().int().nonnegative(),
    })
    .nullable()
    .optional(),
  stackEntry: z
    .object({ position: z.number().int().positive() })
    .nullable()
    .optional(),
};
const closedPullNodeSchema = listNodeSchema.extend({
  state: z.enum(["CLOSED", "MERGED"]),
  isDraft: z.boolean(),
  headRefName: z.string(),
  baseRefName: z.string(),
  mergedAt: z.string().nullable(),
  ...pullChangeFields,
});
const openPullNodeSchema = listNodeSchema.extend({
  state: z.literal("OPEN"),
  isDraft: z.boolean(),
  headRefName: z.string(),
  baseRefName: z.string(),
  ...pullChangeFields,
  mergeable: z.string(),
  reviewDecision: z.string().nullable(),
  isInMergeQueue: z.boolean(),
  reviewRequests: z.object({
    nodes: z.array(
      z.object({
        requestedReviewer: z
          .object({ login: z.string().optional(), slug: z.string().optional() })
          .nullable(),
      }),
    ),
  }),
  commits: z.object({
    nodes: z
      .array(
        z.object({
          commit: z.object({
            statusCheckRollup: z
              .object({
                contexts: z.object({
                  checkRunCountsByState: stateCountsSchema,
                  statusContextCountsByState: stateCountsSchema,
                }),
              })
              .nullable(),
            verdict: z.object({ state: z.string() }).nullable().optional(),
          }),
        }),
      )
      .max(1),
  }),
});
const repositoryListsSchema = z.object({
  data: z.object({
    repository: z.object({
      hasIssuesEnabled: z.boolean(),
      viewerPermission: z.string().nullable().optional(),
      viewerDefaultMergeMethod: z
        .enum(["SQUASH", "MERGE", "REBASE"])
        .optional(),
      squashMergeAllowed: z.boolean().optional(),
      mergeCommitAllowed: z.boolean().optional(),
      rebaseMergeAllowed: z.boolean().optional(),
      deleteBranchOnMerge: z.boolean().optional(),
      openIssues: z.object({
        nodes: z
          .array(listNodeSchema.extend({ state: z.literal("OPEN") }))
          .max(ISSUE_PAGE),
      }),
      closedIssues: z.object({
        nodes: z
          .array(listNodeSchema.extend({ state: z.literal("CLOSED") }))
          .max(CLOSED_ISSUE_PAGE),
      }),
      openPrs: z.object({
        nodes: z.array(openPullNodeSchema).max(PR_PAGE),
      }),
      closedPrs: z.object({
        nodes: z.array(closedPullNodeSchema).max(CLOSED_PR_PAGE),
      }),
    }),
  }),
  errors: z.array(z.unknown()).max(0).optional(),
});
const listFields = `
  number title state author { login ... on User { id } }
  labels(first: 100) { nodes { name } }
  assignees(first: 100) { nodes { login } }
  url body updatedAt
`;
const pullChangeQueryFields = `headRefOid isCrossRepository headRepositoryOwner { login } additions deletions changedFiles stack { number size } stackEntry { position }`;
const closedPullFields = `isDraft headRefName baseRefName mergedAt ${pullChangeQueryFields}`;
const openPullFields = `
  isDraft headRefName baseRefName mergeable reviewDecision isInMergeQueue
  ${pullChangeQueryFields}
  reviewRequests(first: 20) {
    nodes { requestedReviewer { ... on User { login } ... on Team { slug } } }
  }
  commits(last: 1) {
    nodes { commit {
      verdict: statusCheckRollup { state }
      statusCheckRollup { contexts(first: 1) {
        checkRunCountsByState { state count }
        statusContextCountsByState { state count }
      } }
    } }
  }
`;
const repositoryListsQuery = `query RepositoryLists($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    hasIssuesEnabled
    viewerPermission viewerDefaultMergeMethod
    squashMergeAllowed mergeCommitAllowed rebaseMergeAllowed deleteBranchOnMerge
    openIssues: issues(first: ${ISSUE_PAGE}, states: [OPEN], orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes { ${listFields} }
    }
    closedIssues: issues(first: ${CLOSED_ISSUE_PAGE}, states: [CLOSED], orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes { ${listFields} }
    }
    openPrs: pullRequests(first: ${PR_PAGE}, states: [OPEN], orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes { ${listFields} ${openPullFields} }
    }
    closedPrs: pullRequests(first: ${CLOSED_PR_PAGE}, states: [CLOSED, MERGED], orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes { ${listFields} ${closedPullFields} }
    }
  }
}`;

type PullEventKind =
  | "ready"
  | "draft"
  | "closed"
  | "reopened"
  | "merged"
  | "force_pushed"
  | "commit"
  | "base_changed"
  | "head_deleted";
const PULL_EVENT_TYPES: Record<string, PullEventKind> = {
  ReadyForReviewEvent: "ready",
  ConvertToDraftEvent: "draft",
  ClosedEvent: "closed",
  ReopenedEvent: "reopened",
  MergedEvent: "merged",
  HeadRefForcePushedEvent: "force_pushed",
  BaseRefChangedEvent: "base_changed",
  HeadRefDeletedEvent: "head_deleted",
  PullRequestCommit: "commit",
};
const pullDetailsQuery = `query PullDetails($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    viewerPermission viewerDefaultMergeMethod
    squashMergeAllowed mergeCommitAllowed rebaseMergeAllowed deleteBranchOnMerge
    pullRequest(number: $number) {
      state headRefName headRefOid isCrossRepository
      viewerCanUpdate viewerCanClose viewerCanReopen viewerCanDeleteHeadRef
      isInMergeQueue isMergeQueueEnabled
      headRef { name }
      stack { number size baseRefName entries(first: 20) { nodes { position pullRequest {
        number title state isDraft headRefName baseRefName mergeable
        commits(last: 1) { nodes { commit { verdict: statusCheckRollup { state } } } }
      } } } }
      stackEntry { position }
      commits(last: 1) { nodes { commit {
        oid committedDate
        verdict: statusCheckRollup { state }
        statusCheckRollup { contexts(first: 100) { nodes { __typename
          ... on CheckRun { name status conclusion startedAt completedAt detailsUrl
            isRequired(pullRequestNumber: $number)
            checkSuite { workflowRun { databaseId workflow { name } } } }
          ... on StatusContext { context state targetUrl createdAt isRequired(pullRequestNumber: $number) }
        } } }
      } } }
      latestOpinionatedReviews(first: 20, writersOnly: true) { nodes { author { login } state } }
      timelineItems(last: 100, itemTypes: [PULL_REQUEST_COMMIT, READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT, CLOSED_EVENT, REOPENED_EVENT, MERGED_EVENT, HEAD_REF_FORCE_PUSHED_EVENT, HEAD_REF_DELETED_EVENT, BASE_REF_CHANGED_EVENT]) {
        nodes { __typename
          ... on PullRequestCommit { commit { abbreviatedOid messageHeadline committedDate } }
          ... on ReadyForReviewEvent { actor { login } createdAt }
          ... on ConvertToDraftEvent { actor { login } createdAt }
          ... on ClosedEvent { actor { login } createdAt }
          ... on ReopenedEvent { actor { login } createdAt }
          ... on MergedEvent { actor { login } createdAt }
          ... on HeadRefForcePushedEvent { actor { login } createdAt beforeCommit { abbreviatedOid } afterCommit { abbreviatedOid } }
          ... on HeadRefDeletedEvent { actor { login } createdAt }
          ... on BaseRefChangedEvent { actor { login } createdAt previousRefName currentRefName }
        }
      }
    }
  }
}`;
const actorSchema = z.object({ login: z.string() }).nullable().optional();
const detailCheckSchema = z.object({
  __typename: z.string(),
  name: z.string().optional(),
  context: z.string().optional(),
  status: z.string().nullable().optional(),
  conclusion: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  detailsUrl: z.string().nullable().optional(),
  targetUrl: z.string().nullable().optional(),
  isRequired: z.boolean().optional(),
  checkSuite: z
    .object({
      workflowRun: z
        .object({
          databaseId: z.number().int().positive(),
          workflow: z.object({ name: z.string() }).nullable().optional(),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});
const pullDetailsSchema = z.object({
  data: z.object({
    repository: z.object({
      viewerPermission: z.string().nullable(),
      viewerDefaultMergeMethod: z.enum(["SQUASH", "MERGE", "REBASE"]),
      squashMergeAllowed: z.boolean(),
      mergeCommitAllowed: z.boolean(),
      rebaseMergeAllowed: z.boolean(),
      deleteBranchOnMerge: z.boolean(),
      pullRequest: z.object({
        state: z.enum(["OPEN", "CLOSED", "MERGED"]),
        headRefName: z.string(),
        headRefOid: z.string(),
        isCrossRepository: z.boolean(),
        viewerCanUpdate: z.boolean(),
        viewerCanClose: z.boolean(),
        viewerCanReopen: z.boolean(),
        viewerCanDeleteHeadRef: z.boolean(),
        isInMergeQueue: z.boolean(),
        isMergeQueueEnabled: z.boolean(),
        headRef: z.object({ name: z.string() }).nullable(),
        stack: z
          .object({
            number: z.number().int().positive(),
            size: z.number().int().nonnegative(),
            baseRefName: z.string(),
            entries: z.object({
              nodes: z.array(
                z.object({
                  position: z.number().int().positive(),
                  pullRequest: z.object({
                    number: z.number().int().positive(),
                    title: z.string(),
                    state: z.string(),
                    isDraft: z.boolean(),
                    headRefName: z.string(),
                    baseRefName: z.string(),
                    mergeable: z.string(),
                    commits: z.object({
                      nodes: z.array(
                        z.object({
                          commit: z.object({
                            verdict: z
                              .object({ state: z.string() })
                              .nullable()
                              .optional(),
                          }),
                        }),
                      ),
                    }),
                  }),
                }),
              ),
            }),
          })
          .nullable()
          .optional(),
        stackEntry: z
          .object({ position: z.number().int().positive() })
          .nullable()
          .optional(),
        commits: z.object({
          nodes: z
            .array(
              z.object({
                commit: z.object({
                  oid: z.string(),
                  committedDate: z.string(),
                  verdict: z
                    .object({ state: z.string() })
                    .nullable()
                    .optional(),
                  statusCheckRollup: z
                    .object({
                      contexts: z.object({ nodes: z.array(detailCheckSchema) }),
                    })
                    .nullable(),
                }),
              }),
            )
            .max(1),
        }),
        latestOpinionatedReviews: z.object({
          nodes: z.array(z.object({ author: actorSchema, state: z.string() })),
        }),
        timelineItems: z.object({
          nodes: z.array(
            z.object({
              __typename: z.string(),
              createdAt: z.string().optional(),
              actor: actorSchema,
              commit: z
                .object({
                  abbreviatedOid: z.string(),
                  messageHeadline: z.string(),
                  committedDate: z.string(),
                })
                .optional(),
              beforeCommit: z
                .object({ abbreviatedOid: z.string() })
                .nullable()
                .optional(),
              afterCommit: z
                .object({ abbreviatedOid: z.string() })
                .nullable()
                .optional(),
              previousRefName: z.string().optional(),
              currentRefName: z.string().optional(),
            }),
          ),
        }),
      }),
    }),
  }),
});
type MergeMethod = z.infer<typeof mergeMethodSchema>;
type DetailCheck = PullCheckView;
interface PullCheckView {
  name: string;
  workflow: string | null;
  status: "success" | "failure" | "pending" | "skipped";
  url: string;
  runId: number | null;
  completedAt: string | null;
  required: boolean;
}
interface PullEvent {
  kind: PullEventKind;
  actor: string;
  createdAt: string;
  detail: string | null;
}
interface PullStackView {
  number: number;
  baseRefName: string;
  position: number;
  entries: Array<{
    number: number;
    title: string;
    state: "open" | "draft" | "merged" | "closed";
    attention:
      | "conflicts"
      | "checks_failed"
      | "draft"
      | "ready_to_merge"
      | "none";
  }>;
}
interface PullDetails {
  known: boolean;
  state: "OPEN" | "CLOSED" | "MERGED" | null;
  headRefName: string | null;
  headRefOid: string | null;
  isCrossRepository: boolean;
  viewerCanUpdate: boolean;
  viewerCanClose: boolean;
  viewerCanReopen: boolean;
  viewerCanMerge: boolean;
  viewerCanDeleteHeadRef: boolean;
  isInMergeQueue: boolean;
  isMergeQueueEnabled: boolean;
  headRefExists: boolean;
  headCommittedAt: string | null;
  checksVerdict: string | null;
  checks: DetailCheck[] | null;
  mergeMethods: MergeMethod[];
  defaultMergeMethod: MergeMethod;
  deleteBranchOnMerge: boolean;
  reviewVerdicts: Array<{ author: string; state: string }>;
  events: PullEvent[];
  stack: PullStackView | null;
}
const UNKNOWN_PULL_DETAILS: PullDetails = {
  known: false,
  state: null,
  headRefName: null,
  headRefOid: null,
  isCrossRepository: false,
  viewerCanUpdate: false,
  viewerCanClose: false,
  viewerCanReopen: false,
  viewerCanMerge: false,
  viewerCanDeleteHeadRef: false,
  isInMergeQueue: false,
  isMergeQueueEnabled: false,
  headRefExists: true,
  headCommittedAt: null,
  checksVerdict: null,
  checks: null,
  mergeMethods: ["squash", "merge", "rebase"],
  defaultMergeMethod: "squash",
  deleteBranchOnMerge: false,
  reviewVerdicts: [],
  events: [],
  stack: null,
};
const WRITE_PERMISSIONS = new Set(["WRITE", "MAINTAIN", "ADMIN"]);
const pullStateViewSchema = z.object({
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  isDraft: z.boolean(),
});
const PULL_STATE_PHRASES: Record<PullStateTarget, string> = {
  open: "open and ready for review",
  draft: "a draft",
  closed: "closed",
};

export function checkStatus(
  status: string | null | undefined,
  conclusion: string | null | undefined,
): PullCheckView["status"] {
  const result = (conclusion ?? "").toUpperCase();
  if (result === "") {
    return (status ?? "").toUpperCase() === "COMPLETED" ? "skipped" : "pending";
  }
  if (result === "SUCCESS") return "success";
  if (isFailedCheck(result)) return "failure";
  if (result === "PENDING" || result === "EXPECTED") return "pending";
  return "skipped";
}

export function latestChecks<
  T extends { name: string; workflow: string | null; startedAt: string },
>(checks: readonly T[]): T[] {
  const byKey = new Map<string, T>();
  for (const check of checks) {
    const key = `${check.workflow ?? ""}/${check.name}`;
    const kept = byKey.get(key);
    if (kept === undefined || check.startedAt > kept.startedAt) {
      byKey.set(key, check);
    }
  }
  return [...byKey.values()];
}

function detailChecks(
  nodes: ReadonlyArray<z.infer<typeof detailCheckSchema>>,
): DetailCheck[] {
  const checks = nodes.map((node) => {
    const isRun = node.__typename === "CheckRun";
    const url = (isRun ? node.detailsUrl : node.targetUrl) ?? "";
    const run = node.checkSuite?.workflowRun ?? null;
    return {
      name: (isRun ? node.name : node.context) ?? "check",
      workflow: run?.workflow?.name ?? null,
      status: isRun
        ? checkStatus(node.status, node.conclusion)
        : checkStatus(null, node.state),
      url,
      runId: run?.databaseId ?? actionsRunId(url),
      completedAt: isRun ? (node.completedAt ?? null) : null,
      required: node.isRequired === true,
      startedAt: (isRun ? node.startedAt : node.createdAt) ?? "",
    };
  });
  return latestChecks(checks).map(
    ({ startedAt: _startedAt, ...check }) => check,
  );
}

function stackAttention(entry: {
  state: string;
  isDraft: boolean;
  mergeable: string;
  verdict: string | null;
}): PullStackView["entries"][number]["attention"] {
  if (entry.mergeable === "CONFLICTING") return "conflicts";
  if (entry.verdict === "FAILURE" || entry.verdict === "ERROR")
    return "checks_failed";
  if (entry.isDraft) return "draft";
  if (entry.mergeable === "MERGEABLE" && entry.verdict === "SUCCESS") {
    return "ready_to_merge";
  }
  return "none";
}

function parsePullDetails(raw: string | null): PullDetails {
  if (raw === null) return UNKNOWN_PULL_DETAILS;
  let parsed: z.infer<typeof pullDetailsSchema>;
  try {
    const result = pullDetailsSchema.safeParse(JSON.parse(raw));
    if (!result.success) return UNKNOWN_PULL_DETAILS;
    parsed = result.data;
  } catch {
    return UNKNOWN_PULL_DETAILS;
  }
  const { repository } = parsed.data;
  const pull = repository.pullRequest;
  const mergeMethods: MergeMethod[] = [
    ...(repository.squashMergeAllowed ? (["squash"] as const) : []),
    ...(repository.mergeCommitAllowed ? (["merge"] as const) : []),
    ...(repository.rebaseMergeAllowed ? (["rebase"] as const) : []),
  ];
  const preferred = repository.viewerDefaultMergeMethod.toLowerCase();
  const defaultMergeMethod =
    mergeMethods.find((method) => method === preferred) ??
    mergeMethods[0] ??
    "squash";
  const head = pull.commits.nodes[0]?.commit ?? null;
  const stack = pull.stack ?? null;
  return {
    known: true,
    state: pull.state,
    headRefName: pull.headRefName,
    headRefOid: pull.headRefOid,
    isCrossRepository: pull.isCrossRepository,
    viewerCanUpdate: pull.viewerCanUpdate,
    viewerCanClose: pull.viewerCanClose,
    viewerCanReopen: pull.viewerCanReopen,
    viewerCanMerge: WRITE_PERMISSIONS.has(repository.viewerPermission ?? ""),
    viewerCanDeleteHeadRef: pull.viewerCanDeleteHeadRef,
    isInMergeQueue: pull.isInMergeQueue,
    isMergeQueueEnabled: pull.isMergeQueueEnabled,
    headRefExists: pull.headRef !== null,
    headCommittedAt: head?.committedDate ?? null,
    checksVerdict: head?.verdict?.state ?? null,
    checks:
      head?.statusCheckRollup == null
        ? head === null
          ? null
          : []
        : detailChecks(head.statusCheckRollup.contexts.nodes),
    mergeMethods,
    defaultMergeMethod,
    deleteBranchOnMerge: repository.deleteBranchOnMerge,
    reviewVerdicts: pull.latestOpinionatedReviews.nodes.flatMap((review) =>
      review.author == null
        ? []
        : [{ author: review.author.login, state: review.state }],
    ),
    events: pull.timelineItems.nodes.flatMap((node): PullEvent[] => {
      const kind = PULL_EVENT_TYPES[node.__typename];
      if (kind === undefined) return [];
      if (kind === "commit") {
        return node.commit === undefined
          ? []
          : [
              {
                kind,
                actor: "",
                createdAt: node.commit.committedDate,
                detail: `${node.commit.abbreviatedOid} ${node.commit.messageHeadline}`,
              },
            ];
      }
      if (node.createdAt === undefined) return [];
      const detail =
        kind === "force_pushed"
          ? `${node.beforeCommit?.abbreviatedOid ?? "?"} → ${node.afterCommit?.abbreviatedOid ?? "?"}`
          : kind === "base_changed"
            ? `${node.previousRefName ?? "?"} → ${node.currentRefName ?? "?"}`
            : null;
      return [
        {
          kind,
          actor: node.actor?.login ?? "",
          createdAt: node.createdAt,
          detail,
        },
      ];
    }),
    stack:
      stack === null
        ? null
        : {
            number: stack.number,
            baseRefName: stack.baseRefName,
            position: pull.stackEntry?.position ?? 0,
            entries: [...stack.entries.nodes]
              .sort((a, b) => a.position - b.position)
              .map(({ pullRequest: entry }) => {
                const verdict =
                  entry.commits.nodes[0]?.commit.verdict?.state ?? null;
                return {
                  number: entry.number,
                  title: entry.title,
                  state:
                    entry.state === "MERGED"
                      ? ("merged" as const)
                      : entry.state === "CLOSED"
                        ? ("closed" as const)
                        : entry.isDraft
                          ? ("draft" as const)
                          : ("open" as const),
                  attention: stackAttention({ ...entry, verdict }),
                };
              }),
          },
  };
}

const ACTIONS_RUN_URL = /\/actions\/runs\/(\d+)/;

export function actionsRunId(url: string): number | null {
  const match = ACTIONS_RUN_URL.exec(url);
  return match?.[1] === undefined ? null : Number(match[1]);
}

function nativeStack(entry: {
  stack?: { number: number; size: number } | null;
  stackEntry?: { position: number } | null;
}): PullStatus["stack"] {
  return entry.stack != null && entry.stackEntry != null
    ? {
        number: entry.stack.number,
        size: entry.stack.size,
        position: entry.stackEntry.position,
      }
    : null;
}

function mergeSettingsOf(repository: {
  viewerPermission?: string | null;
  viewerDefaultMergeMethod?: "SQUASH" | "MERGE" | "REBASE";
  squashMergeAllowed?: boolean;
  mergeCommitAllowed?: boolean;
  rebaseMergeAllowed?: boolean;
  deleteBranchOnMerge?: boolean;
}): RepoSettings | null {
  if (
    repository.viewerDefaultMergeMethod === undefined ||
    repository.squashMergeAllowed === undefined
  ) {
    return null;
  }
  const mergeMethods: MergeMethod[] = [
    ...(repository.squashMergeAllowed ? (["squash"] as const) : []),
    ...(repository.mergeCommitAllowed === true ? (["merge"] as const) : []),
    ...(repository.rebaseMergeAllowed === true ? (["rebase"] as const) : []),
  ];
  const preferred = repository.viewerDefaultMergeMethod.toLowerCase();
  return {
    viewerCanWrite: WRITE_PERMISSIONS.has(repository.viewerPermission ?? ""),
    mergeMethods,
    defaultMergeMethod:
      mergeMethods.find((method) => method === preferred) ??
      mergeMethods[0] ??
      "squash",
    deleteBranchOnMerge: repository.deleteBranchOnMerge === true,
  };
}

async function fetchRepoItems(
  gh: GhRunner,
  repo: string,
  onSettings: (settings: RepoSettings) => void = () => {},
): Promise<CachedItem[]> {
  const [owner, name] = repoNameSchema.parse(repo).split("/");
  const raw = await gh([
    "api",
    "graphql",
    "--hostname",
    GH_HOST,
    "-f",
    `query=${repositoryListsQuery}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${name}`,
  ]);
  const {
    data: { repository },
  } = repositoryListsSchema.parse(JSON.parse(raw));
  const settings = mergeSettingsOf(repository);
  if (settings !== null) onSettings(settings);
  const toItem = (
    entry: z.infer<typeof listNodeSchema>,
    kind: "issue" | "pr",
    pr: PullStatus | null,
  ): CachedItem => ({
    repo,
    number: entry.number,
    kind,
    title: entry.title,
    state: entry.state,
    author: entry.author?.id
      ? entry.author.login
      : `app/${entry.author?.login ?? ""}`,
    labels: entry.labels.nodes.map((label) => label.name),
    assignees: entry.assignees.nodes.map((user) => user.login),
    url: entry.url,
    body: entry.body,
    updatedAt: entry.updatedAt,
    pr,
  });
  const toOpenPullItem = (
    entry: z.infer<typeof openPullNodeSchema>,
  ): CachedItem => {
    const commit = entry.commits.nodes[0]?.commit;
    const contexts = commit?.statusCheckRollup?.contexts ?? null;
    return toItem(
      entry,
      "pr",
      assemblePullStatus({
        state: entry.state,
        isDraft: entry.isDraft,
        baseRefName: entry.baseRefName,
        headRefName: entry.headRefName,
        headRefOid: entry.headRefOid,
        isCrossRepository: entry.isCrossRepository,
        additions: entry.additions,
        deletions: entry.deletions,
        changedFiles: entry.changedFiles,
        mergedAt: null,
        mergeable: entry.mergeable,
        reviewDecision: entry.reviewDecision,
        isInMergeQueue: entry.isInMergeQueue,
        requestedReviewers: entry.reviewRequests.nodes.flatMap((request) => {
          const name =
            request.requestedReviewer?.login ?? request.requestedReviewer?.slug;
          return name === undefined ? [] : [name];
        }),
        checkRunCounts: contexts?.checkRunCountsByState ?? [],
        statusContextCounts: contexts?.statusContextCountsByState ?? [],
        checksVerdict: commit?.verdict?.state ?? null,
        stack: nativeStack(entry),
        headOwner: entry.headRepositoryOwner?.login ?? null,
      }),
    );
  };
  const toClosedPullItem = (
    entry: z.infer<typeof closedPullNodeSchema>,
  ): CachedItem =>
    toItem(
      entry,
      "pr",
      assemblePullStatus({
        state: entry.state,
        isDraft: entry.isDraft,
        baseRefName: entry.baseRefName,
        headRefName: entry.headRefName,
        headRefOid: entry.headRefOid,
        isCrossRepository: entry.isCrossRepository,
        additions: entry.additions,
        deletions: entry.deletions,
        changedFiles: entry.changedFiles,
        mergedAt: entry.mergedAt,
        mergeable: "UNKNOWN",
        reviewDecision: null,
        isInMergeQueue: false,
        requestedReviewers: [],
        checkRunCounts: [],
        statusContextCounts: [],
        checksVerdict: null,
        stack: nativeStack(entry),
        headOwner: entry.headRepositoryOwner?.login ?? null,
      }),
    );
  return [
    ...(repository.hasIssuesEnabled
      ? [
          ...repository.openIssues.nodes.map((entry) =>
            toItem(entry, "issue", null),
          ),
          ...repository.closedIssues.nodes.map((entry) =>
            toItem(entry, "issue", null),
          ),
        ]
      : []),
    ...repository.openPrs.nodes.map(toOpenPullItem),
    ...repository.closedPrs.nodes.map(toClosedPullItem),
  ];
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    extraRepos: {
      type: "string",
      label: "Extra repositories",
      description:
        'Comma-separated "owner/repo" list to track in addition to repos discovered from BB projects.',
      experimental_schema: z.string().superRefine((value, context) => {
        const { ignored } = parseExtraRepos(value);
        if (ignored.length > 0) {
          context.addIssue({
            code: "custom",
            message: `Use "owner/repo" for every entry. Invalid: ${ignored.join(", ")}`,
          });
        }
      }),
      default: "",
    },
    defaultProject: {
      type: "project",
      label: "Default BB project",
      description:
        "Where agent threads spawn for repos that are not attached to a BB project.",
    },
  });

  let ghPath: string | null = null;
  type GhState = "ready" | "needs_configuration" | "unavailable";
  let ghState: GhState = "unavailable";
  let ghAuthError: string | null = "checking gh…";

  async function resolveGh(): Promise<string> {
    if (ghPath !== null) return ghPath;
    const candidates = ["gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh"];
    for (const candidate of candidates) {
      try {
        await run(candidate, ["--version"], 5_000);
        ghPath = candidate;
        return candidate;
      } catch {}
    }
    throw needsConfiguration(`GitHub CLI not found. ${GH_HINT}`);
  }

  async function gh(
    args: string[],
    timeoutMs?: number,
    priority: VcsProcessPriority = "interactive",
  ): Promise<string> {
    const file = await resolveGh();
    const { stdout } = await run(file, args, timeoutMs, priority);
    return stdout;
  }

  async function probeAuth(): Promise<void> {
    try {
      await gh(
        ["auth", "status", "--hostname", GH_HOST, "--active"],
        10_000,
        "background",
      );
      ghState = "ready";
      ghAuthError = null;
      return;
    } catch (error) {
      ghAuthError = errorMessage(error);
      if (isNeedsConfigurationError(error)) {
        ghState = "needs_configuration";
        throw error;
      }
    }
    let hasCredentials = true;
    try {
      await gh(["auth", "token", "--hostname", GH_HOST], 5_000, "background");
    } catch (error) {
      const message = errorMessage(error);
      hasCredentials = !GH_NO_CREDENTIALS.test(message);
    }
    if (!hasCredentials) {
      ghState = "needs_configuration";
      throw needsConfiguration(`GitHub CLI is not authenticated. ${GH_HINT}`);
    }
    ghState = "unavailable";
    throw ghUnavailable(
      `gh auth status failed; gh has credentials, so this is probably transient and will be retried: ${ghAuthError}`,
    );
  }

  let authProbe: Promise<void> | null = null;
  function checkAuth(): Promise<void> {
    if (authProbe === null) {
      authProbe = probeAuth().finally(() => {
        authProbe = null;
      });
    }
    return authProbe;
  }

  let repoCache: { repos: RepoInfo[]; fetchedAt: number } | null = null;

  let ignoredExtraRepos: string[] = [];
  let lastIgnoredExtraReposKey: string | null = null;

  async function discoverRepos(force = false): Promise<RepoInfo[]> {
    if (
      !force &&
      repoCache !== null &&
      Date.now() - repoCache.fetchedAt < 60_000
    ) {
      return repoCache.repos;
    }
    const byRepo = new Map<string, RepoInfo>();
    try {
      const projects = await bb.sdk.projects.list();
      for (const project of projects) {
        for (const source of project.sources ?? []) {
          if (source.type !== "local_path") continue;
          try {
            const { stdout } = await run(
              "git",
              ["-C", source.path, "remote", "get-url", "origin"],
              5_000,
            );
            const repo = parseGithubRemote(stdout);
            if (repo !== null && !byRepo.has(repo)) {
              byRepo.set(repo, { repo, projectId: project.id });
            }
          } catch {}
        }
      }
    } catch (error) {
      bb.log.warn(`project discovery failed: ${errorMessage(error)}`);
    }
    const { extraRepos } = await settings.get();
    const parsed = parseExtraRepos(extraRepos);
    for (const raw of parsed.repos) {
      if (!byRepo.has(raw)) {
        byRepo.set(raw, { repo: raw, projectId: null });
      }
    }
    const ignoredKey = parsed.ignored.join(",");
    if (ignoredKey !== lastIgnoredExtraReposKey) {
      lastIgnoredExtraReposKey = ignoredKey;
      if (parsed.ignored.length > 0) {
        bb.log.warn(describeIgnoredExtraRepos(parsed.ignored));
      }
    }
    ignoredExtraRepos = parsed.ignored;
    const repos = [...byRepo.values()];
    repoCache = { repos, fetchedAt: Date.now() };
    return repos;
  }

  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS items (
       repo TEXT NOT NULL,
       number INTEGER NOT NULL,
       kind TEXT NOT NULL,
       title TEXT NOT NULL,
       state TEXT NOT NULL,
       author TEXT NOT NULL,
       labels TEXT NOT NULL,
       url TEXT NOT NULL,
       body TEXT NOT NULL,
       updated_at TEXT NOT NULL,
       PRIMARY KEY (repo, kind, number)
     )`,
    `ALTER TABLE items ADD COLUMN assignees TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE items ADD COLUMN pr TEXT`,
  ]);

  function parseStringArray(raw: unknown): string[] {
    try {
      const parsed = JSON.parse(String(raw));
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {}
    return [];
  }

  function parsePullStatus(raw: unknown): PullStatus | null {
    if (typeof raw !== "string") return null;
    try {
      const parsed = pullStatusSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  function rowToItem(row: Record<string, unknown>): CachedItem {
    return {
      repo: String(row.repo),
      number: Number(row.number),
      kind: row.kind === "pr" ? "pr" : "issue",
      title: String(row.title),
      state: String(row.state),
      author: String(row.author),
      labels: parseStringArray(row.labels),
      assignees: parseStringArray(row.assignees),
      url: String(row.url),
      body: String(row.body),
      updatedAt: String(row.updated_at),
      pr: row.kind === "pr" ? parsePullStatus(row.pr) : null,
    };
  }

  function listCachedItems(options: {
    kind?: "issue" | "pr";
    repo?: string;
    query?: string;
    state?: "open" | "closed";
    assignee?: string;
  }): CachedItem[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options.kind !== undefined) {
      clauses.push("kind = ?");
      params.push(options.kind);
    }
    if (options.repo !== undefined) {
      clauses.push("repo = ?");
      params.push(options.repo);
    }
    if (options.state === "open") {
      clauses.push("state = 'OPEN'");
    } else if (options.state === "closed") {
      clauses.push("state != 'OPEN'");
    }
    if (options.assignee !== undefined) {
      clauses.push("assignees LIKE ?");
      params.push(`%${JSON.stringify(options.assignee)}%`);
    }
    const query = options.query?.trim() ?? "";
    if (query.length > 0) {
      clauses.push(
        "(title LIKE ? OR CAST(number AS TEXT) LIKE ? OR repo LIKE ?)",
      );
      const like = `%${query.replace(/^#/, "")}%`;
      params.push(like, like, like);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db
      .prepare(`SELECT * FROM items ${where} ORDER BY updated_at DESC`)
      .all(...params) as Record<string, unknown>[];
    return rows.map(rowToItem);
  }

  function getCachedItem(
    kind: "issue" | "pr",
    repo: string,
    number: number,
  ): CachedItem | null {
    const row = db
      .prepare("SELECT * FROM items WHERE repo = ? AND kind = ? AND number = ?")
      .get(repo, kind, number) as Record<string, unknown> | undefined;
    return row === undefined ? null : rowToItem(row);
  }

  function replaceRepoRows(repo: string, items: CachedItem[]): void {
    const insert = db.prepare(
      `INSERT INTO items (repo, number, kind, title, state, author, labels, assignees, url, body, updated_at, pr)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    db.transaction(() => {
      db.prepare("DELETE FROM items WHERE repo = ?").run(repo);
      for (const item of items) {
        insert.run(
          item.repo,
          item.number,
          item.kind,
          item.title,
          item.state,
          item.author,
          JSON.stringify(item.labels),
          JSON.stringify(item.assignees),
          item.url,
          item.body,
          item.updatedAt,
          item.pr === null ? null : JSON.stringify(item.pr),
        );
      }
    })();
  }

  function patchCachedItem(
    repo: string,
    number: number,
    patch: { state?: string; assignees?: string[]; labels?: string[] },
  ): void {
    if (patch.state !== undefined) {
      db.prepare(
        "UPDATE items SET state = ? WHERE repo = ? AND kind = 'issue' AND number = ?",
      ).run(patch.state, repo, number);
    }
    if (patch.assignees !== undefined) {
      db.prepare(
        "UPDATE items SET assignees = ? WHERE repo = ? AND kind = 'issue' AND number = ?",
      ).run(JSON.stringify(patch.assignees), repo, number);
    }
    if (patch.labels !== undefined) {
      db.prepare(
        "UPDATE items SET labels = ? WHERE repo = ? AND kind = 'issue' AND number = ?",
      ).run(JSON.stringify(patch.labels), repo, number);
    }
    bb.realtime.publish("data-changed", {});
  }

  let lastSyncError: string | null = null;
  const repoSettings = new Map<string, RepoSettings>();

  function setSyncError(next: string | null): void {
    if (next === lastSyncError) return;
    lastSyncError = next;
    bb.realtime.publish("data-changed", {});
  }

  async function syncAll(
    force = false,
  ): Promise<{ repos: number; items: number }> {
    try {
      return await syncTrackedRepos(force);
    } catch (error) {
      setSyncError(errorMessage(error));
      throw error;
    }
  }

  async function syncTrackedRepos(
    force: boolean,
  ): Promise<{ repos: number; items: number }> {
    await checkAuth();
    const repos = await discoverRepos(force);
    const before = JSON.stringify(
      db
        .prepare(
          "SELECT repo, kind, number, updated_at, pr FROM items ORDER BY repo, kind, number",
        )
        .all(),
    );
    let total = 0;
    const failedRepos: string[] = [];
    let lastFailure = "";
    for (const { repo } of repos) {
      try {
        const items = await fetchRepoItems(
          (args) => gh(args, undefined, "background"),
          repo,
          (settings) => repoSettings.set(repo, settings),
        );
        replaceRepoRows(repo, items);
        total += items.length;
      } catch (error) {
        failedRepos.push(repo);
        lastFailure = errorMessage(error);
        bb.log.warn(`sync failed for ${repo}: ${lastFailure}`);
      }
    }
    const failed = failedRepos.length;
    if (repos.length > 0 && failed === repos.length) {
      throw ghUnavailable(
        `sync failed for all ${repos.length} repo(s); last error: ${lastFailure}`,
      );
    }
    const after = JSON.stringify(
      db
        .prepare(
          "SELECT repo, kind, number, updated_at, pr FROM items ORDER BY repo, kind, number",
        )
        .all(),
    );
    await bb.storage.kv.set("sync-cursor", {
      lastSyncedAt: new Date().toISOString(),
    });
    setSyncError(
      failed > 0
        ? `Couldn't sync ${failedRepos.join(", ")}: ${lastFailure}`
        : null,
    );
    if (before !== after) {
      bb.realtime.publish("data-changed", { items: total });
    }
    bb.log.info(`synced ${total} item(s) across ${repos.length} repo(s)`);
    return { repos: repos.length, items: total };
  }

  async function refreshTrackedRepo(repo: string): Promise<void> {
    const repos = await discoverRepos();
    if (!repos.some((info) => info.repo === repo)) return;
    const items = await fetchRepoItems(
      (args) => gh(args, undefined, "background"),
      repo,
      (settings) => repoSettings.set(repo, settings),
    );
    replaceRepoRows(repo, items);
    bb.realtime.publish("data-changed", { items: items.length });
  }

  async function changePullState(
    repo: string,
    number: number,
    target: PullStateTarget,
  ): Promise<void> {
    try {
      const current = pullStateViewSchema.parse(
        JSON.parse(
          await gh(
            [
              "pr",
              "view",
              String(number),
              "-R",
              repo,
              "--json",
              "state,isDraft",
            ],
            15_000,
          ),
        ),
      );
      for (const [verb, ...flags] of pullStateCommands(current, target)) {
        await gh(["pr", verb, String(number), "-R", repo, ...flags]);
      }
    } finally {
      refreshTrackedRepo(repo).catch((error: unknown) => {
        bb.log.warn(
          `refresh after a state change failed for ${repo}: ${errorMessage(error)}`,
        );
      });
    }
  }

  function snoozeKey(repo: string, number: number): string {
    return `snooze:${repo}#${number}`;
  }

  async function readSnoozes(): Promise<Map<string, Snooze>> {
    const result = new Map<string, Snooze>();
    for (const key of await bb.storage.kv.list("snooze:")) {
      const parsed = storedSnoozeSchema.safeParse(await bb.storage.kv.get(key));
      if (parsed.success) result.set(key.slice("snooze:".length), parsed.data);
    }
    return result;
  }

  async function withSnoozes(items: CachedItem[]): Promise<ListedItem[]> {
    const snoozes = await readSnoozes();
    const now = new Date();
    const listed: ListedItem[] = [];
    for (const item of items) {
      const snooze =
        item.kind === "pr"
          ? snoozes.get(`${item.repo}#${item.number}`)
          : undefined;
      if (snooze === undefined) {
        listed.push({ ...item, snooze: null });
        continue;
      }
      if (snoozeWakes(snooze, { pr: item.pr }, now)) {
        await bb.storage.kv.delete(snoozeKey(item.repo, item.number));
        listed.push({ ...item, snooze: null });
      } else {
        listed.push({
          ...item,
          snooze: { rule: snooze.rule, until: snooze.until },
        });
      }
    }
    return listed;
  }

  async function snoozePull(
    repo: string,
    number: number,
    rule: SnoozeRule,
    until: string | null,
  ): Promise<{ rule: SnoozeRule; until: string | null }> {
    const item = getCachedItem("pr", repo, number);
    if (item?.pr == null) {
      throw new Error(
        `${repo}#${number} is not a cached pull request. Run \`bb github sync\` first.`,
      );
    }
    if (item.pr.state === "merged" || item.pr.state === "closed") {
      throw new Error(
        `${repo}#${number} is ${item.pr.state}; only open pull requests can be snoozed.`,
      );
    }
    const now = new Date();
    if (rule === "time") {
      const at = until === null ? Number.NaN : Date.parse(until);
      if (!Number.isFinite(at) || at <= now.getTime()) {
        throw new Error("A timed snooze needs a moment in the future.");
      }
    }
    const snooze = snoozeFor(
      rule,
      rule === "time" && until !== null ? new Date(until).toISOString() : null,
      { pr: item.pr },
      now,
    );
    await bb.storage.kv.set(snoozeKey(repo, number), snooze);
    bb.realtime.publish("data-changed", {});
    return { rule: snooze.rule, until: snooze.until };
  }

  async function unsnoozePull(repo: string, number: number): Promise<void> {
    await bb.storage.kv.delete(snoozeKey(repo, number));
    bb.realtime.publish("data-changed", {});
  }

  async function rollupOf(
    repo: string,
    number: number,
  ): Promise<Array<{ name: string; conclusion: string; url: string }>> {
    const raw = await gh(
      ["pr", "view", String(number), "-R", repo, "--json", "statusCheckRollup"],
      15_000,
    );
    const view = JSON.parse(raw) as {
      statusCheckRollup?: Array<{
        name?: unknown;
        context?: unknown;
        workflowName?: unknown;
        conclusion?: unknown;
        state?: unknown;
        detailsUrl?: unknown;
        targetUrl?: unknown;
        startedAt?: unknown;
      }>;
    };
    return latestChecks(
      (view.statusCheckRollup ?? []).map((entry) => ({
        name: String(entry.name ?? entry.context ?? "check"),
        workflow:
          typeof entry.workflowName === "string" &&
          entry.workflowName.length > 0
            ? entry.workflowName
            : null,
        conclusion: String(entry.conclusion ?? entry.state ?? ""),
        url: String(entry.detailsUrl ?? entry.targetUrl ?? ""),
        startedAt: typeof entry.startedAt === "string" ? entry.startedAt : "",
      })),
    ).map(({ name, conclusion, url }) => ({ name, conclusion, url }));
  }

  async function rerunFailedChecks(
    repo: string,
    number: number,
  ): Promise<{ runs: number; checks: number }> {
    const failed = (await rollupOf(repo, number)).filter((check) =>
      isFailedCheck(check.conclusion),
    );
    if (failed.length === 0) {
      throw new Error(`${repo}#${number} has no failed checks.`);
    }
    const onActions = failed.flatMap((check) => {
      const id = actionsRunId(check.url);
      return id === null ? [] : [id];
    });
    const runIds = [...new Set(onActions)];
    if (runIds.length === 0) {
      throw new Error(
        `The failed checks on ${repo}#${number} don't run on GitHub Actions, so they can't be re-run from bb.`,
      );
    }
    try {
      for (const id of runIds) {
        await gh(["run", "rerun", String(id), "--failed", "-R", repo], 30_000);
      }
    } finally {
      refreshTrackedRepo(repo).catch((error: unknown) => {
        bb.log.warn(
          `refresh after a re-run failed for ${repo}: ${errorMessage(error)}`,
        );
      });
    }
    return { runs: runIds.length, checks: onActions.length };
  }

  async function pullDetailsOf(
    repo: string,
    number: number,
  ): Promise<PullDetails> {
    const [owner, name] = repo.split("/");
    return parsePullDetails(
      await gh(
        [
          "api",
          "graphql",
          "--hostname",
          GH_HOST,
          "-f",
          `query=${pullDetailsQuery}`,
          "-f",
          `owner=${owner}`,
          "-f",
          `name=${name}`,
          "-F",
          `number=${number}`,
        ],
        30_000,
      ),
    );
  }

  async function mergePull(
    repo: string,
    number: number,
    requested: MergeMethod | null,
    deleteBranch: boolean,
    headRefOid: string | null,
  ): Promise<{ method: MergeMethod; deletedBranch: boolean }> {
    const ref = `${repo}#${number}`;
    const facts = await pullDetailsOf(repo, number);
    const cached = getCachedItem("pr", repo, number);
    if (facts.isInMergeQueue || cached?.pr?.attention === "queued") {
      throw new Error(
        `${ref} is queued to merge; GitHub merges it when its turn comes.`,
      );
    }
    if (facts.known && facts.state !== "OPEN") {
      throw new Error(`${ref} is ${facts.state?.toLowerCase()}.`);
    }
    if (facts.known && !facts.viewerCanMerge) {
      throw new Error(
        `You don't have write access to ${repo}, so you can't merge ${ref}.`,
      );
    }
    const method = requested ?? facts.defaultMergeMethod;
    if (facts.known && !facts.mergeMethods.includes(method)) {
      throw new Error(
        `${repo} doesn't allow ${method} merges. Allowed: ${facts.mergeMethods.join(", ") || "none"}.`,
      );
    }
    const head = headRefOid ?? facts.headRefOid;
    const args = ["pr", "merge", String(number), "-R", repo, `--${method}`];
    if (head !== null) args.push("--match-head-commit", head);
    let deletedBranch = false;
    try {
      await gh(args, 60_000);
      if (
        deleteBranch &&
        !facts.deleteBranchOnMerge &&
        facts.viewerCanDeleteHeadRef &&
        !facts.isCrossRepository &&
        facts.headRefName !== null
      ) {
        try {
          await gh(
            [
              "api",
              "-X",
              "DELETE",
              `repos/${repo}/git/refs/heads/${facts.headRefName
                .split("/")
                .map(encodeURIComponent)
                .join("/")}`,
            ],
            15_000,
          );
          deletedBranch = true;
        } catch (error) {
          bb.log.warn(
            `merged ${ref} but could not delete ${facts.headRefName}: ${errorMessage(error)}`,
          );
        }
      }
    } finally {
      refreshTrackedRepo(repo).catch((error: unknown) => {
        bb.log.warn(
          `refresh after a merge failed for ${repo}: ${errorMessage(error)}`,
        );
      });
    }
    return {
      method,
      deletedBranch:
        deletedBranch ||
        (facts.deleteBranchOnMerge && !facts.isCrossRepository),
    };
  }

  bb.background.service("sync", {
    async start(signal) {
      let failures = 0;
      while (!signal.aborted) {
        let delayMs = SYNC_INTERVAL_MS;
        try {
          await syncAll();
          failures = 0;
        } catch (error) {
          if (!isGhUnavailableError(error)) throw error;
          failures += 1;
          delayMs = Math.min(
            SYNC_RETRY_BASE_MS * 2 ** (failures - 1),
            SYNC_RETRY_MAX_MS,
          );
          bb.log.warn(
            `sync failed (retry in ${Math.round(delayMs / 1000)}s): ${errorMessage(
              error,
            )}`,
          );
        }
        if (signal.aborted) break;
        await new Promise<void>((resolve) => {
          const onAbort = () => {
            clearTimeout(timer);
            resolve();
          };
          const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          }, delayMs);
          signal.addEventListener("abort", onAbort, { once: true });
        });
      }
    },
  });

  try {
    await checkAuth();
  } catch (error) {
    if (isNeedsConfigurationError(error)) {
      bb.status.needsConfiguration(error.message);
    } else if (isGhUnavailableError(error)) {
      bb.log.warn(error.message);
    } else {
      throw error;
    }
  }

  function linkKey(kind: "issue" | "pr", repo: string, number: number): string {
    return `link:${kind}:${repo}#${number}`;
  }

  async function addLink(link: ThreadLink): Promise<void> {
    const key = linkKey(link.kind, link.repo, link.number);
    const existing = (await bb.storage.kv.get<ThreadLink[]>(key)) ?? [];
    if (existing.some((entry) => entry.threadId === link.threadId)) return;
    await bb.storage.kv.set(key, [...existing, link]);
    bb.realtime.publish("links-changed", { key });
  }

  const storedLinkSchema = z.object(threadLinkSchema.shape);

  async function listAllLinks(): Promise<Record<string, ThreadLink[]>> {
    const keys = await bb.storage.kv.list("link:");
    const result: Record<string, ThreadLink[]> = {};
    for (const key of keys) {
      const parsed = z
        .array(storedLinkSchema)
        .safeParse((await bb.storage.kv.get(key)) ?? []);
      if (parsed.success && parsed.data.length > 0) {
        result[key.slice("link:".length)] = parsed.data;
      }
    }
    return result;
  }

  async function resolveProjectId(repo: string): Promise<string> {
    const repos = await discoverRepos();
    const info = repos.find((entry) => entry.repo === repo);
    if (info?.projectId != null) return info.projectId;
    const { defaultProject } = await settings.get();
    if (defaultProject) return defaultProject;
    throw new Error(
      `No BB project is attached to ${repo}. Create a project whose checkout has ` +
        "that origin remote, or set the defaultProject plugin setting.",
    );
  }

  async function spawnOnPull(
    repo: string,
    number: number,
    preset: AgentPreset,
    prompt: string | null,
  ): Promise<{ threadId: string }> {
    const item = getCachedItem("pr", repo, number);
    if (item?.pr == null) {
      throw new Error(
        `${repo}#${number} is not a cached pull request. Run \`bb github sync\` first.`,
      );
    }
    const projectId = await resolveProjectId(repo);
    const pull = {
      repo,
      number,
      title: item.title,
      headRefName: item.pr.headRefName,
      baseRefName: item.pr.baseRefName,
      branchCheckout: "checkout" as const,
    };
    const thread = await bb.sdk.threads.spawn({
      projectId,
      environment: { type: "project-default" },
      title: agentThreadTitle(preset, pull),
      prompt: prompt ?? presetPrompt(preset, pull),
    });
    await addLink({
      kind: "pr",
      repo,
      number,
      threadId: thread.id,
      createdAt: new Date().toISOString(),
    });
    bb.log.info(
      `spawned thread ${thread.id} (${preset}) for ${repo}#${number}`,
    );
    return { threadId: thread.id };
  }

  async function spawnOnIssue(
    repo: string,
    number: number,
    title: string,
    prompt: string | null,
  ): Promise<{ threadId: string }> {
    const issue = { repo, number, title };
    const projectId = await resolveProjectId(repo);
    const thread = await bb.sdk.threads.spawn({
      projectId,
      environment: { type: "project-default" },
      title: issueThreadTitle(issue),
      prompt: prompt ?? issuePrompt(issue),
    });
    await addLink({
      kind: "issue",
      repo,
      number,
      threadId: thread.id,
      createdAt: new Date().toISOString(),
    });
    bb.log.info(`spawned thread ${thread.id} for issue ${repo}#${number}`);
    return { threadId: thread.id };
  }

  let viewerCache: { login: string; fetchedAt: number } | null = null;

  async function getViewer(): Promise<string> {
    if (
      viewerCache !== null &&
      Date.now() - viewerCache.fetchedAt < 60 * 60_000
    ) {
      return viewerCache.login;
    }
    try {
      const raw = await gh(["api", "user"], 15_000);
      const login = String(
        (JSON.parse(raw) as { login?: unknown })?.login ?? "",
      );
      if (login.length === 0)
        throw new Error("could not resolve the gh viewer login");
      viewerCache = { login, fetchedAt: Date.now() };
      await bb.storage.kv.set("viewer", { login });
      return login;
    } catch (error) {
      const stored = storedViewerSchema.safeParse(
        await bb.storage.kv.get("viewer"),
      );
      if (stored.success) return stored.data.login;
      throw error;
    }
  }

  const assignableCache = new Map<
    string,
    { users: string[]; fetchedAt: number }
  >();
  const labelsCache = new Map<
    string,
    { labels: string[]; fetchedAt: number }
  >();

  async function getAssignableUsers(repo: string): Promise<string[]> {
    const cached = assignableCache.get(repo);
    if (cached !== undefined && Date.now() - cached.fetchedAt < 10 * 60_000) {
      return cached.users;
    }
    const raw = await gh(
      ["api", `repos/${repo}/assignees?per_page=100`],
      15_000,
    );
    const entries = JSON.parse(raw) as Array<{ login?: unknown }>;
    const users = entries
      .map((entry) => String(entry?.login ?? ""))
      .filter((login) => login.length > 0)
      .sort((a, b) => a.localeCompare(b));
    assignableCache.set(repo, { users, fetchedAt: Date.now() });
    return users;
  }

  async function getRepoLabels(repo: string): Promise<string[]> {
    const cached = labelsCache.get(repo);
    if (cached !== undefined && Date.now() - cached.fetchedAt < 10 * 60_000) {
      return cached.labels;
    }
    const raw = await gh(["api", `repos/${repo}/labels?per_page=100`], 15_000);
    const entries = JSON.parse(raw) as Array<{ name?: unknown }>;
    const labels = entries
      .map((entry) => String(entry?.name ?? "").trim())
      .filter((name) => name.length > 0)
      .sort((a, b) => a.localeCompare(b));
    labelsCache.set(repo, { labels, fetchedAt: Date.now() });
    return labels;
  }

  bb.rpc.register(githubRpcContract, {
    async status() {
      if (ghState !== "ready") {
        try {
          await checkAuth();
        } catch {}
      }
      const cursor = await bb.storage.kv.get<{
        lastSyncedAt: string;
      }>("sync-cursor");
      const repos = await discoverRepos();
      const { defaultProject } = await settings.get();
      return {
        ghOk: ghState === "ready",
        ghState,
        ghError: ghAuthError,
        repos,
        defaultProjectId:
          typeof defaultProject === "string" && defaultProject.length > 0
            ? defaultProject
            : null,
        lastSyncedAt: cursor?.lastSyncedAt ?? null,
        lastSyncError,
      };
    },

    async refresh() {
      return await syncAll(true);
    },

    async listItems(input) {
      return {
        items: await withSnoozes(
          listCachedItems({
            kind: input.kind,
            repo: input.repo,
            query: input.query,
            state: input.state,
            assignee: input.mine === true ? await getViewer() : undefined,
          }),
        ),
      };
    },

    async viewer() {
      return { login: await getViewer() };
    },

    async assignableUsers(input) {
      return { users: await getAssignableUsers(input.repo) };
    },

    async repositoryLabels(input) {
      return { labels: await getRepoLabels(input.repo) };
    },

    async setIssueState({ repo, number, state }): Promise<{ ok: true }> {
      await gh([
        "issue",
        state === "closed" ? "close" : "reopen",
        String(number),
        "-R",
        repo,
      ]);
      patchCachedItem(repo, number, {
        state: state === "closed" ? "CLOSED" : "OPEN",
      });
      return { ok: true };
    },

    async setAssignees({
      repo,
      number,
      assignees,
    }): Promise<{ ok: true; assignees: string[] }> {
      const next = [...new Set(assignees)];
      const current = getCachedItem("issue", repo, number)?.assignees ?? [];
      const add = next.filter((login) => !current.includes(login));
      const remove = current.filter((login) => !next.includes(login));
      if (add.length === 0 && remove.length === 0)
        return { ok: true, assignees: next };
      const args = ["issue", "edit", String(number), "-R", repo];
      if (add.length > 0) args.push("--add-assignee", add.join(","));
      if (remove.length > 0) args.push("--remove-assignee", remove.join(","));
      await gh(args);
      patchCachedItem(repo, number, { assignees: next });
      return { ok: true, assignees: next };
    },

    async setLabels({
      repo,
      number,
      labels,
    }): Promise<{ ok: true; labels: string[] }> {
      const next = [
        ...new Set(labels.map((label) => label.trim()).filter(Boolean)),
      ];
      const currentRaw = await gh(
        ["issue", "view", String(number), "-R", repo, "--json", "labels"],
        15_000,
      );
      const currentDetail = JSON.parse(currentRaw) as {
        labels?: Array<{ name?: unknown }>;
      };
      const current = (currentDetail.labels ?? [])
        .map((label) => String(label?.name ?? "").trim())
        .filter((label) => label.length > 0);
      const add = next.filter((label) => !current.includes(label));
      const remove = current.filter((label) => !next.includes(label));
      if (add.length === 0 && remove.length === 0)
        return { ok: true, labels: next };
      const args = ["issue", "edit", String(number), "-R", repo];
      for (const label of add) args.push("--add-label", label);
      for (const label of remove) args.push("--remove-label", label);
      await gh(args);
      patchCachedItem(repo, number, { labels: next });
      return { ok: true, labels: next };
    },

    async getIssue({ repo, number }) {
      const raw = await gh([
        "issue",
        "view",
        String(number),
        "-R",
        repo,
        "--json",
        "number,title,body,state,author,createdAt,updatedAt,labels,assignees,url,comments",
      ]);
      const detail = JSON.parse(raw) as {
        comments?: Array<{
          author?: { login?: unknown };
          body?: unknown;
          createdAt?: unknown;
        }>;
      } & GhListEntry;
      return {
        issue: {
          repo,
          number,
          title: String(detail.title ?? ""),
          state: String(detail.state ?? ""),
          author: String(detail.author?.login ?? ""),
          body: typeof detail.body === "string" ? detail.body : "",
          labels: (detail.labels ?? []).map((label) =>
            String(label?.name ?? ""),
          ),
          assignees: (detail.assignees ?? []).map((user) =>
            String(user?.login ?? ""),
          ),
          url: String(detail.url ?? ""),
          updatedAt: String(detail.updatedAt ?? ""),
          comments: (detail.comments ?? []).map((comment) => ({
            author: String(comment.author?.login ?? ""),
            body: typeof comment.body === "string" ? comment.body : "",
            createdAt: String(comment.createdAt ?? ""),
          })),
        },
      };
    },

    async getPull({ repo, number }) {
      const prFields =
        "number,title,body,state,isDraft,author,createdAt,updatedAt,labels," +
        "assignees,url,baseRefName,headRefName,additions,deletions," +
        "changedFiles,reviewDecision,mergeStateStatus,statusCheckRollup," +
        "comments,reviews,reviewRequests,mergeable,headRefOid," +
        "isCrossRepository,closedAt,mergedAt,mergedBy";
      const [repoOwner, repoName] = repo.split("/");
      const [viewRaw, reviewCommentsRaw, filesRaw, detailsRaw] =
        await Promise.all([
          gh(
            ["pr", "view", String(number), "-R", repo, "--json", prFields],
            30_000,
          ),
          gh(
            [
              "api",
              "--paginate",
              "--slurp",
              `repos/${repo}/pulls/${number}/comments?per_page=100`,
            ],
            30_000,
          ),
          gh(
            [
              "api",
              "--paginate",
              "--slurp",
              `repos/${repo}/pulls/${number}/files?per_page=100`,
            ],
            30_000,
          ),
          gh(
            [
              "api",
              "graphql",
              "--hostname",
              GH_HOST,
              "-f",
              `query=${pullDetailsQuery}`,
              "-f",
              `owner=${repoOwner}`,
              "-f",
              `name=${repoName}`,
              "-F",
              `number=${number}`,
            ],
            30_000,
          ).catch((error: unknown) => {
            bb.log.warn(
              `could not read permissions and merge settings for ${repo}#${number}: ${errorMessage(error)}`,
            );
            return null;
          }),
        ]);

      interface GhPullView extends GhListEntry {
        isDraft?: unknown;
        createdAt?: unknown;
        baseRefName?: unknown;
        headRefName?: unknown;
        additions?: unknown;
        deletions?: unknown;
        changedFiles?: unknown;
        reviewDecision?: unknown;
        mergeStateStatus?: unknown;
        mergeable?: unknown;
        headRefOid?: unknown;
        isCrossRepository?: unknown;
        closedAt?: unknown;
        mergedAt?: unknown;
        mergedBy?: { login?: unknown } | null;
        statusCheckRollup?: Array<{
          __typename?: unknown;
          name?: unknown;
          context?: unknown;
          workflowName?: unknown;
          status?: unknown;
          conclusion?: unknown;
          state?: unknown;
          detailsUrl?: unknown;
          targetUrl?: unknown;
          completedAt?: unknown;
          startedAt?: unknown;
        }>;
        comments?: Array<{
          author?: { login?: unknown };
          body?: unknown;
          createdAt?: unknown;
        }>;
        reviews?: Array<{
          author?: { login?: unknown };
          state?: unknown;
          body?: unknown;
          submittedAt?: unknown;
        }>;
        reviewRequests?: Array<{
          login?: unknown;
          name?: unknown;
          slug?: unknown;
        }>;
      }
      const view = JSON.parse(viewRaw) as GhPullView;

      const details = parsePullDetails(detailsRaw);
      const rollupChecks = latestChecks(
        (view.statusCheckRollup ?? []).map((entry) => {
          const url = String(entry.detailsUrl ?? entry.targetUrl ?? "");
          return {
            name: String(entry.name ?? entry.context ?? "check"),
            workflow:
              typeof entry.workflowName === "string" &&
              entry.workflowName.length > 0
                ? entry.workflowName
                : null,
            status: checkStatus(
              typeof entry.status === "string" ? entry.status : null,
              typeof entry.conclusion === "string" && entry.conclusion !== ""
                ? entry.conclusion
                : typeof entry.state === "string"
                  ? entry.state
                  : null,
            ),
            url,
            runId: actionsRunId(url),
            completedAt:
              typeof entry.completedAt === "string" &&
              !entry.completedAt.startsWith("0001-")
                ? entry.completedAt
                : null,
            required: false,
            startedAt:
              typeof entry.startedAt === "string" ? entry.startedAt : "",
          };
        }),
      ).map(({ startedAt: _startedAt, ...check }) => check);
      const checks = details.checks ?? rollupChecks;
      const optionalString = (value: unknown): string | null =>
        typeof value === "string" && value.length > 0 ? value : null;

      interface GhReviewComment {
        id?: unknown;
        in_reply_to_id?: unknown;
        path?: unknown;
        line?: unknown;
        original_line?: unknown;
        diff_hunk?: unknown;
        body?: unknown;
        created_at?: unknown;
        user?: { login?: unknown };
      }
      const reviewComments = parsePaginatedGhApi(
        reviewCommentsRaw,
      ) as GhReviewComment[];
      interface ReviewThread {
        path: string;
        line: number | null;
        diffHunk: string;
        comments: Array<{ author: string; body: string; createdAt: string }>;
      }
      const threadByRootId = new Map<number, ReviewThread>();
      for (const comment of reviewComments) {
        const id = Number(comment.id ?? NaN);
        const replyTo = Number(comment.in_reply_to_id ?? NaN);
        const entry = {
          author: String(comment.user?.login ?? ""),
          body: typeof comment.body === "string" ? comment.body : "",
          createdAt: String(comment.created_at ?? ""),
        };
        const rootThread = Number.isFinite(replyTo)
          ? threadByRootId.get(replyTo)
          : undefined;
        if (rootThread !== undefined) {
          rootThread.comments.push(entry);
          if (Number.isFinite(id)) threadByRootId.set(id, rootThread);
          continue;
        }
        const line = Number(comment.line ?? comment.original_line ?? NaN);
        const thread: ReviewThread = {
          path: String(comment.path ?? ""),
          line: Number.isFinite(line) ? line : null,
          diffHunk:
            typeof comment.diff_hunk === "string" ? comment.diff_hunk : "",
          comments: [entry],
        };
        if (Number.isFinite(id)) threadByRootId.set(id, thread);
      }
      const reviewThreads = [...new Set(threadByRootId.values())];

      interface GhPullFile {
        filename?: unknown;
        status?: unknown;
        additions?: unknown;
        deletions?: unknown;
        patch?: unknown;
      }
      const files = (parsePaginatedGhApi(filesRaw) as GhPullFile[]).map(
        (file) => {
          const patch = typeof file.patch === "string" ? file.patch : null;
          return {
            path: String(file.filename ?? ""),
            status: String(file.status ?? "modified"),
            additions: Number(file.additions ?? 0),
            deletions: Number(file.deletions ?? 0),
            patch: patch !== null && patch.length <= 20_000 ? patch : null,
          };
        },
      );

      return {
        pull: {
          repo,
          number,
          title: String(view.title ?? ""),
          state:
            view.isDraft === true && String(view.state ?? "") === "OPEN"
              ? "DRAFT"
              : String(view.state ?? ""),
          author: String(view.author?.login ?? ""),
          body: typeof view.body === "string" ? view.body : "",
          url: String(view.url ?? ""),
          createdAt: String(view.createdAt ?? ""),
          updatedAt: String(view.updatedAt ?? ""),
          baseRefName: String(view.baseRefName ?? ""),
          headRefName: String(view.headRefName ?? ""),
          additions: Number(view.additions ?? 0),
          deletions: Number(view.deletions ?? 0),
          changedFiles: Number(view.changedFiles ?? files.length),
          labels: (view.labels ?? []).map((label) => String(label?.name ?? "")),
          assignees: (view.assignees ?? []).map((user) =>
            String(user?.login ?? ""),
          ),
          reviewDecision: String(view.reviewDecision ?? ""),
          mergeStateStatus: String(view.mergeStateStatus ?? ""),
          mergeable: String(view.mergeable ?? "UNKNOWN"),
          reviewRequests: (view.reviewRequests ?? [])
            .map((entry) =>
              String(entry.login ?? entry.name ?? entry.slug ?? ""),
            )
            .filter((name) => name.length > 0),
          isDraft: view.isDraft === true,
          headRefOid: String(view.headRefOid ?? ""),
          isCrossRepository: view.isCrossRepository === true,
          isInMergeQueue: details.isInMergeQueue,
          headCommittedAt: details.headCommittedAt,
          closedAt: optionalString(view.closedAt),
          mergedAt: optionalString(view.mergedAt),
          mergedBy: optionalString(view.mergedBy?.login),
          viewerCanUpdate: details.viewerCanUpdate,
          viewerCanClose: details.viewerCanClose,
          viewerCanReopen: details.viewerCanReopen,
          viewerCanMerge: details.viewerCanMerge,
          viewerCanDeleteHeadRef: details.viewerCanDeleteHeadRef,
          isMergeQueueEnabled: details.isMergeQueueEnabled,
          headRefExists: details.headRefExists,
          checksVerdict: details.checksVerdict,
          mergeMethods: details.mergeMethods,
          defaultMergeMethod: details.defaultMergeMethod,
          deleteBranchOnMerge: details.deleteBranchOnMerge,
          reviewVerdicts: details.reviewVerdicts,
          events: details.events,
          stack: details.stack,
          checks,
          comments: (view.comments ?? []).map((comment) => ({
            author: String(comment.author?.login ?? ""),
            body: typeof comment.body === "string" ? comment.body : "",
            createdAt: String(comment.createdAt ?? ""),
          })),
          reviews: (view.reviews ?? []).map((review) => ({
            author: String(review.author?.login ?? ""),
            state: String(review.state ?? ""),
            body: typeof review.body === "string" ? review.body : "",
            createdAt: String(review.submittedAt ?? ""),
          })),
          reviewThreads,
          files,
        },
      };
    },

    async setPullState({
      repo,
      number,
      state,
    }): Promise<{ ok: true; state: PullStateTarget }> {
      await changePullState(repo, number, state);
      return { ok: true, state };
    },

    async mergePull({ repo, number, method, deleteBranch, headRefOid }) {
      return {
        ok: true as const,
        ...(await mergePull(repo, number, method, deleteBranch, headRefOid)),
      };
    },

    async rerunFailedChecks({ repo, number }) {
      return { ok: true as const, ...(await rerunFailedChecks(repo, number)) };
    },

    async snoozePull({ repo, number, rule, until }) {
      return {
        ok: true as const,
        snooze: await snoozePull(repo, number, rule, until),
      };
    },

    async unsnoozePull({ repo, number }): Promise<{ ok: true }> {
      await unsnoozePull(repo, number);
      return { ok: true };
    },

    async linkThread({ kind, repo, number, threadId }) {
      await addLink({
        kind,
        repo,
        number,
        threadId,
        createdAt: new Date().toISOString(),
      });
      return { ok: true as const };
    },

    async repoSettings() {
      return { repos: Object.fromEntries(repoSettings) };
    },

    async commentPull({ repo, number, body }): Promise<{ ok: true }> {
      await gh(["pr", "comment", String(number), "-R", repo, "--body", body]);
      return { ok: true };
    },

    async pullForThread({ threadId }) {
      let environmentId: string | null = null;
      try {
        const thread = await bb.sdk.threads.get({ threadId });
        if (thread?.environmentId) {
          environmentId = thread.environmentId;
          const rows = await bb.sdk.plugins.callRpc({
            pluginId: "bb--github-pr-status",
            method: "pullRequests",
            input: { keys: [thread.environmentId] },
            outputSchema: environmentPullRequestUrlsSchema,
          });
          const result = rows[thread.environmentId];
          const url =
            result?.outcome === "available" ? result.pullRequest.url : null;
          const match =
            typeof url === "string"
              ? url.match(/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/)
              : null;
          if (match !== null) {
            return {
              pull: {
                repo: match[1],
                number: Number(match[2]),
                environmentId,
              },
            };
          }
        }
      } catch {}
      const links = await listAllLinks();
      for (const [key, threadLinks] of Object.entries(links)) {
        const match = key.match(/^pr:([\w.-]+\/[\w.-]+)#(\d+)$/);
        if (match === null) continue;
        if (threadLinks.some((link) => link.threadId === threadId)) {
          return {
            pull: {
              repo: match[1],
              number: Number(match[2]),
              environmentId,
            },
          };
        }
      }
      return { pull: null };
    },

    async commentIssue({ repo, number, body }): Promise<{ ok: true }> {
      await gh([
        "issue",
        "comment",
        String(number),
        "-R",
        repo,
        "--body",
        body,
      ]);
      return { ok: true };
    },

    async createIssue(input) {
      const body = input.body ?? "";
      const stdout = await gh([
        "issue",
        "create",
        "-R",
        input.repo,
        "--title",
        input.title,
        "--body",
        body,
      ]);
      const match = stdout.trim().match(/\/issues\/(\d+)\s*$/);
      const number = match !== null ? Number(match[1]) : null;
      try {
        replaceRepoRows(
          input.repo,
          await fetchRepoItems(gh, input.repo, (settings) =>
            repoSettings.set(input.repo, settings),
          ),
        );
        bb.realtime.publish("data-changed", {});
      } catch {}
      return { number, url: stdout.trim() };
    },

    async listLinks() {
      return { links: await listAllLinks() };
    },
  });

  function mentionItems(kind: "issue" | "pr", query: string) {
    return listCachedItems({ kind, query, state: "open" })
      .slice(0, 8)
      .map((item) => ({
        id: `${item.repo}#${item.number}`,
        title: `#${item.number} ${item.title}`,
        subtitle: item.repo,
      }));
  }

  function parseMentionId(itemId: string): { repo: string; number: number } {
    const match = itemId.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/);
    if (match === null) throw new Error(`malformed mention id "${itemId}"`);
    return { repo: match[1], number: Number(match[2]) };
  }

  async function mentionContext(
    kind: "issue" | "pr",
    itemId: string,
  ): Promise<{ context: string }> {
    const { repo, number } = parseMentionId(itemId);
    const noun = kind === "pr" ? "pull request" : "issue";
    try {
      const raw = await gh(
        kind === "pr"
          ? [
              "pr",
              "view",
              String(number),
              "-R",
              repo,
              "--json",
              "number,title,body,state,author,url",
            ]
          : [
              "issue",
              "view",
              String(number),
              "-R",
              repo,
              "--json",
              "number,title,body,state,author,url",
            ],
        15_000,
      );
      const detail = JSON.parse(raw) as GhListEntry;
      return {
        context: [
          `# GitHub ${noun} ${repo}#${number}: ${String(detail.title ?? "")}`,
          "",
          `State: ${String(detail.state ?? "")} · Author: ${String(detail.author?.login ?? "")}`,
          `URL: ${String(detail.url ?? "")}`,
          "",
          typeof detail.body === "string" && detail.body.length > 0
            ? detail.body
            : "(no description)",
          "",
          `For full comments/diff run: gh ${kind === "pr" ? "pr" : "issue"} view ${number} -R ${repo} --comments`,
        ].join("\n"),
      };
    } catch (error) {
      const cached = getCachedItem(kind, repo, number);
      if (cached === null)
        throw error instanceof Error ? error : new Error(String(error));
      return {
        context: [
          `# GitHub ${noun} ${repo}#${number}: ${cached.title}`,
          "",
          `State: ${cached.state} · Author: ${cached.author}`,
          `URL: ${cached.url}`,
          "",
          cached.body.length > 0 ? cached.body : "(no description)",
        ].join("\n"),
      };
    }
  }

  bb.ui.registerMentionProvider({
    id: "issue",
    label: "GitHub issues",
    triggers: ["@", "#"],
    search({ query }) {
      return mentionItems("issue", query);
    },
    resolve(itemId) {
      return mentionContext("issue", itemId);
    },
  });

  bb.ui.registerMentionProvider({
    id: "pr",
    label: "GitHub pull requests",
    triggers: ["@", "#"],
    search({ query }) {
      return mentionItems("pr", query);
    },
    resolve(itemId) {
      return mentionContext("pr", itemId);
    },
  });

  async function guarded(
    run: () => Promise<PluginCliResult>,
  ): Promise<PluginCliResult> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof PluginCliError) throw error;
      throw new PluginCliError(errorMessage(error));
    }
  }

  function pullRefFromCli(positionals: { repo?: string; number?: string }): {
    repo: string;
    number: number;
  } {
    const repo = requireRepoName(positionals.repo);
    const raw = positionals.number ?? "";
    const number = Number(raw);
    if (
      repo === undefined ||
      !/^[1-9]\d*$/.test(raw) ||
      !itemNumberSchema.safeParse(number).success
    ) {
      throw new PluginCliError(`Invalid pull request number "${raw}".`, {
        code: "invalid_number",
      });
    }
    return { repo, number };
  }

  const pullPositionals = [
    {
      name: "repo",
      description: "The pull request's owner/repo",
      required: true,
    },
    {
      name: "number",
      description: "The pull request number",
      required: true,
    },
  ] as const;

  function cachedItemSummary(item: CachedItem, viewer: string | null) {
    return {
      repo: item.repo,
      number: item.number,
      kind: item.kind,
      state: item.state,
      title: item.title,
      author: item.author,
      labels: item.labels,
      assignees: item.assignees,
      url: item.url,
      updatedAt: item.updatedAt,
      pr: item.pr,
      nextStep: nextStepOf(item, viewer),
    };
  }

  function nextStepOf(item: CachedItem, viewer: string | null): string | null {
    if (item.pr === null) return null;
    return pullNextStep(item.pr, pullGroup(item.pr, item.author, viewer));
  }

  function listCachedItemsCommand(kind: "issue" | "pr") {
    return cliCommand({
      summary:
        kind === "pr"
          ? "List cached pull requests and what each needs next"
          : "List cached open issues",
      description:
        kind === "pr"
          ? "Reads the local cache only; run `bb github sync` to refresh it from GitHub. --view picks the same lists as the panel's tabs: inbox (reviews requested from you, plus your own pull requests that are ready, need fixing, or are in progress), mine, all (open and closed), or merged; without it every open pull request is listed."
          : "Reads the local cache only; run `bb github sync` to refresh it from GitHub.",
      positionals: [
        {
          name: "repo",
          description:
            "Limit the listing to one owner/repo; omit for every tracked repository",
        },
      ],
      options: {
        json: {
          type: "boolean",
          description: "Emit the cached rows as JSON instead of a text table",
        },
        ...(kind === "pr"
          ? {
              view: {
                type: "enum" as const,
                values: PULL_VIEWS.map((view) => view.id),
                description:
                  "inbox, mine, all, or merged, like the panel's tabs",
              },
            }
          : {}),
      },
      run(input) {
        return guarded(async () => {
          const repo = requireRepoName(input.positionals.repo);
          const view =
            "view" in input.options
              ? (input.options.view as PullView | undefined)
              : undefined;
          const viewer =
            kind !== "pr"
              ? null
              : view === undefined
                ? await getViewer().catch(() => null)
                : await getViewer();
          const listed = await withSnoozes(
            listCachedItems({
              kind,
              ...(repo === undefined ? {} : { repo }),
              ...(view === undefined ? { state: "open" as const } : {}),
            }),
          );
          const items = listed.filter(
            (item) =>
              view === undefined ||
              (item.pr !== null &&
                inPullView(
                  view,
                  {
                    pr: item.pr,
                    author: item.author,
                    group: pullGroup(item.pr, item.author, viewer, {
                      snoozed: item.snooze !== null,
                    }),
                  },
                  viewer,
                )),
          );
          if (input.options.json) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                ok: true,
                items: items.map((item) => ({
                  ...cachedItemSummary(item, viewer),
                  snooze: item.snooze,
                })),
              }),
            };
          }
          if (items.length === 0) {
            return {
              exitCode: 0,
              stdout: "Nothing cached. Run `bb github sync` first.",
            };
          }
          return {
            exitCode: 0,
            stdout: items
              .map(
                (item) =>
                  `${item.repo}#${item.number}\t[${item.state}]\t${item.title}${
                    item.pr === null
                      ? ""
                      : `\t${
                          item.snooze === null
                            ? nextStepOf(item, viewer)
                            : `Snoozed ${snoozeLabel(item.snooze, new Date())}`
                        }`
                  }`,
              )
              .join("\n"),
          };
        });
      },
    });
  }

  bb.cli.register(
    defineCli({
      name: "github",
      summary: "Browse tracked GitHub repos, issues, and PRs",
      description:
        "Tracked repositories come from attached projects' GitHub remotes plus the extraRepos setting.",
      commands: {
        repos: cliCommand({
          summary: "List tracked repositories",
          options: {
            json: {
              type: "boolean",
              description:
                "Emit the repositories as JSON, including extraRepos entries that were ignored",
            },
          },
          run(input) {
            return guarded(async () => {
              const repos = await discoverRepos(true);
              const warning =
                ignoredExtraRepos.length > 0
                  ? {
                      stderr: `${describeIgnoredExtraRepos(ignoredExtraRepos)}\n`,
                    }
                  : {};
              if (input.options.json) {
                return {
                  exitCode: 0,
                  stdout: JSON.stringify({
                    ok: true,
                    repos,
                    ignoredExtraRepos,
                  }),
                  ...warning,
                };
              }
              if (repos.length === 0) {
                return {
                  exitCode: 0,
                  stdout:
                    "No tracked repos. Attach a project with a GitHub remote or set extraRepos.",
                  ...warning,
                };
              }
              return {
                exitCode: 0,
                stdout: repos
                  .map(
                    (entry) =>
                      `${entry.repo}${entry.projectId !== null ? `\t(${entry.projectId})` : ""}`,
                  )
                  .join("\n"),
                ...warning,
              };
            });
          },
        }),
        issues: listCachedItemsCommand("issue"),
        prs: listCachedItemsCommand("pr"),
        "pr-state": cliCommand({
          summary:
            "Mark a pull request ready, turn it into a draft, close it, or reopen it",
          description:
            "Runs gh pr ready, gh pr ready --undo, gh pr close, or gh pr reopen as needed; a closed pull request is reopened first. A tracked repository's cache then refreshes in the background, also after a change that failed partway.",
          positionals: [
            {
              name: "repo",
              description: "The pull request's owner/repo",
              required: true,
            },
            {
              name: "number",
              description: "The pull request number",
              required: true,
            },
          ],
          options: {
            state: {
              type: "enum",
              values: ["open", "draft", "closed"],
              required: true,
              description:
                "open (ready for review), draft, or closed (without merging)",
            },
            json: {
              type: "boolean",
              description: "Emit the repository, number, and new state as JSON",
            },
          },
          run(input) {
            return guarded(async () => {
              const repo = input.positionals.repo;
              requireRepoName(repo);
              const number = Number(input.positionals.number);
              if (
                !/^[1-9]\d*$/.test(input.positionals.number) ||
                !itemNumberSchema.safeParse(number).success
              ) {
                throw new PluginCliError(
                  `Invalid pull request number "${input.positionals.number}".`,
                  { code: "invalid_number" },
                );
              }
              const state = input.options.state;
              await changePullState(repo, number, state);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify({ ok: true, repo, number, state })
                  : `${repo}#${number} is ${PULL_STATE_PHRASES[state]}.`,
              };
            });
          },
        }),
        merge: cliCommand({
          summary: "Merge a pull request",
          description:
            "Runs gh pr merge with the chosen method and --match-head-commit, so a push that lands meanwhile stops the merge. A pull request in a merge queue is refused. The repository's cache refreshes afterwards.",
          positionals: [...pullPositionals],
          options: {
            method: {
              type: "enum",
              values: ["squash", "merge", "rebase"],
              description:
                "squash, merge (a merge commit), or rebase; defaults to the repository's default for you",
            },
            "delete-branch": {
              type: "boolean",
              description:
                "Delete the head branch on GitHub after the merge, when you may",
            },
            json: {
              type: "boolean",
              description: "Emit the repository, number, and method as JSON",
            },
          },
          run(input) {
            return guarded(async () => {
              const { repo, number } = pullRefFromCli(input.positionals);
              const { method, deletedBranch } = await mergePull(
                repo,
                number,
                input.options.method ?? null,
                input.options["delete-branch"] === true,
                null,
              );
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify({
                      ok: true,
                      repo,
                      number,
                      method,
                      deletedBranch,
                    })
                  : `Merged ${repo}#${number} (${method})${deletedBranch ? ", branch deleted" : ""}.`,
              };
            });
          },
        }),
        rerun: cliCommand({
          summary: "Re-run the failed checks of a pull request",
          description:
            "Runs gh run rerun --failed once for each GitHub Actions run with a failed job on the head commit.",
          positionals: [...pullPositionals],
          options: {
            json: {
              type: "boolean",
              description: "Emit the number of runs and checks as JSON",
            },
          },
          run(input) {
            return guarded(async () => {
              const { repo, number } = pullRefFromCli(input.positionals);
              const { runs, checks } = await rerunFailedChecks(repo, number);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify({ ok: true, repo, number, runs, checks })
                  : `Re-running ${checks} failed check${checks === 1 ? "" : "s"} in ${runs} run${runs === 1 ? "" : "s"} on ${repo}#${number}.`,
              };
            });
          },
        }),
        snooze: cliCommand({
          summary:
            "Snooze a pull request out of the inbox until something changes",
          description:
            "checks wakes it when its checks finish differently, push when its head commit changes, tomorrow at 8:00, monday at 8:00 next Monday, or an ISO date-time. Merging or closing it wakes it too.",
          positionals: [...pullPositionals],
          options: {
            until: {
              type: "string",
              required: true,
              description:
                "checks, push, tomorrow, monday, or an ISO 8601 date-time",
            },
            json: {
              type: "boolean",
              description: "Emit the snooze as JSON",
            },
          },
          run(input) {
            return guarded(async () => {
              const { repo, number } = pullRefFromCli(input.positionals);
              const until = input.options.until.trim().toLowerCase();
              const now = new Date();
              const timed =
                until === "tomorrow"
                  ? tomorrowMorning(now)
                  : until === "monday"
                    ? nextMondayMorning(now)
                    : null;
              let rule: SnoozeRule;
              let at: string | null = null;
              if (until === "checks" || until === "push") {
                rule = until;
              } else if (timed !== null) {
                rule = "time";
                at = timed.toISOString();
              } else if (Number.isFinite(Date.parse(input.options.until))) {
                rule = "time";
                at = new Date(input.options.until).toISOString();
              } else {
                throw new PluginCliError(
                  `Unknown --until "${input.options.until}". Use checks, push, tomorrow, monday, or an ISO date-time.`,
                  { code: "invalid_until" },
                );
              }
              const snooze = await snoozePull(repo, number, rule, at);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify({ ok: true, repo, number, snooze })
                  : `${repo}#${number} snoozed ${snoozeLabel(snooze, now)}.`,
              };
            });
          },
        }),
        unsnooze: cliCommand({
          summary: "Bring a snoozed pull request back to the inbox",
          positionals: [...pullPositionals],
          options: {
            json: { type: "boolean", description: "Emit the result as JSON" },
          },
          run(input) {
            return guarded(async () => {
              const { repo, number } = pullRefFromCli(input.positionals);
              await unsnoozePull(repo, number);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify({ ok: true, repo, number })
                  : `${repo}#${number} is no longer snoozed.`,
              };
            });
          },
        }),
        agent: cliCommand({
          summary: "Start an agent thread on a pull request or an issue",
          description: `Spawns a thread in the repository's bb project, links it to the pull request or issue, and prints its id. On a pull request the prompt comes from the preset: ${AGENT_PRESETS.map((preset) => `${preset.id} (${preset.label})`).join(", ")}. Without --preset someone else's pull request gets review, and your own gets what it needs: conflicts, fix for failing checks, feedback for requested changes, else review. On an issue the prompt asks the agent to work on it, and --preset does not apply.`,
          positionals: [...pullPositionals],
          options: {
            preset: {
              type: "enum",
              values: AGENT_PRESETS.map((preset) => preset.id),
              description: "What the agent should do",
            },
            prompt: {
              type: "string",
              description: "Your own prompt instead of the preset's",
            },
            json: {
              type: "boolean",
              description: "Emit the thread id as JSON",
            },
          },
          run(input) {
            return guarded(async () => {
              const { repo, number } = pullRefFromCli(input.positionals);
              const cached = getCachedItem("pr", repo, number);
              const issue =
                cached?.pr == null
                  ? getCachedItem("issue", repo, number)
                  : null;
              const prompt = input.options.prompt?.trim() ?? "";
              if (issue != null) {
                if (input.options.preset !== undefined) {
                  throw new Error(
                    `${repo}#${number} is an issue; --preset applies to pull requests.`,
                  );
                }
                const { threadId } = await spawnOnIssue(
                  repo,
                  number,
                  issue.title,
                  prompt.length > 0 ? prompt : null,
                );
                return {
                  exitCode: 0,
                  stdout: input.options.json
                    ? JSON.stringify({ ok: true, repo, number, threadId })
                    : `Started ${threadId} on issue ${repo}#${number}.`,
                };
              }
              const preset =
                input.options.preset ??
                (cached?.pr == null
                  ? "review"
                  : pullPreset(
                      cached.pr,
                      cached.author,
                      await getViewer().catch(() => null),
                    ));
              const { threadId } = await spawnOnPull(
                repo,
                number,
                preset,
                prompt.length > 0 ? prompt : null,
              );
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify({ ok: true, repo, number, preset, threadId })
                  : `Started ${threadId} (${presetLabel(preset)}) on ${repo}#${number}.`,
              };
            });
          },
        }),
        sync: cliCommand({
          summary: "Refresh the cache from GitHub now",
          options: {
            json: {
              type: "boolean",
              description: "Emit the refreshed repo and item counts as JSON",
            },
          },
          run(input) {
            return guarded(async () => {
              const { repos, items } = await syncAll(true);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify({ ok: true, repos, items })
                  : `Synced ${items} item(s) across ${repos} repo(s).`,
              };
            });
          },
        }),
      },
    }),
  );
}
