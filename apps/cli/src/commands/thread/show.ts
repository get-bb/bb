import { prependOlderTimelineRows } from "@bb/client-core";
import { Command } from "commander";
import {
  formatThreadTimelineText,
  type ThreadTimelineTextFormat,
} from "@bb/thread-view";
import {
  type Environment,
  type Thread,
  type ThreadEventRow,
  type ThreadPullRequest,
  type ThreadTimelinePendingTodos,
} from "@bb/domain";
import { BbHttpError, type BbSdk } from "@bb/sdk";
import type {
  ThreadTimelineResponse,
  TimelineConversationRow,
} from "@bb/server-contract";
import {
  THREAD_EVENT_LIST_PAGE_SIZE,
  THREAD_MESSAGE_CONTEXT_LIMIT,
} from "@bb/server-contract";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import {
  getErrorMessage,
  outputJson,
  requireThreadIdOrSelf,
} from "../helpers.js";
import {
  type ThreadEnvironmentInfo,
  fetchEnvironmentInfo,
  printEnvironmentInfo,
} from "../environment-helpers.js";
import { fetchThreadPendingTodos, printPendingTodos } from "./pending-todos.js";

interface ThreadShowCommandOptions {
  self?: boolean;
  json?: boolean;
}

interface ThreadLogCommandOptions {
  self?: boolean;
  json?: boolean;
  format?: string;
  limit?: string;
  afterSeq?: string;
  all?: boolean;
  message?: string;
  context?: string;
}

const THREAD_LOG_DEFAULT_EVENT_LIMIT = 100;
const THREAD_LOG_TIMELINE_SEGMENT_LIMIT_MAX = 100;

interface ThreadOutputCommandOptions {
  json?: boolean;
  self?: boolean;
}

interface ThreadStatusPayload {
  thread: Thread;
}

type ThreadShowEnvironmentJsonPayload = Environment & {
  pullRequest: ThreadShowPullRequestPayload;
};

interface ThreadShowJsonPayload extends ThreadStatusPayload {
  environment: ThreadShowEnvironmentJsonPayload | null;
  pendingTodos: ThreadTimelinePendingTodos | null;
}

interface ThreadShowPullRequestPayload {
  status: "available" | "none" | "unavailable";
  pullRequest: ThreadPullRequest | null;
  message?: string;
}

async function fetchPullRequest(args: {
  environmentId: string;
  sdk: BbSdk;
}): Promise<ThreadShowPullRequestPayload> {
  try {
    const response = await args.sdk.environments.pullRequest({
      environmentId: args.environmentId,
    });
    if (response.outcome === "available") {
      return {
        status: "available",
        pullRequest: response.pullRequest,
      };
    }
    if (response.outcome === "unavailable") {
      return {
        status: "unavailable",
        pullRequest: null,
        message: response.message,
      };
    }
    return {
      status: "none",
      pullRequest: null,
    };
  } catch (err) {
    return {
      status: "unavailable",
      pullRequest: null,
      message: getErrorMessage(err),
    };
  }
}

function threadShowEnvironmentJson(
  environment: Environment | null,
  pullRequest: ThreadShowPullRequestPayload | null,
): ThreadShowEnvironmentJsonPayload | null {
  if (!environment) {
    return null;
  }
  return {
    ...environment,
    pullRequest: pullRequest ?? {
      status: "unavailable",
      pullRequest: null,
      message: "Pull request lookup was not run.",
    },
  };
}

export function registerShowCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("show [id]")
    .aliases(["get", "view", "status"])
    .description("Show thread details and pull request status")
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string | undefined, opts: ThreadShowCommandOptions) => {
        const threadId = requireThreadIdOrSelf(id, opts);
        const sdk = createCliBbSdk(getUrl());
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
        const fetchedPullRequest = thread.environmentId
          ? await fetchPullRequest({
              environmentId: thread.environmentId,
              sdk,
            })
          : null;

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
          const environment = await getEnvironment();
          const jsonPayload: ThreadShowJsonPayload = {
            ...statusPayload,
            environment: threadShowEnvironmentJson(
              environment,
              fetchedPullRequest,
            ),
            pendingTodos,
          };
          outputJson(opts, jsonPayload);
          return;
        }

        printThreadStatus(statusPayload, environmentInfo, fetchedPullRequest);

        printPendingTodos(pendingTodos);
      }),
    );

  parent
    .command("log [id]")
    .aliases(["messages", "timeline"])
    .description("Show thread event log")
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
      `Maximum entries to print: events for json (oldest first, default ${THREAD_LOG_DEFAULT_EVENT_LIMIT}); user-message turns for minimal/verbose (newest first, default 20, max ${THREAD_LOG_TIMELINE_SEGMENT_LIMIT_MAX})`,
    )
    .option(
      "--after-seq <seq>",
      "Return events after this sequence number; json format only",
    )
    .option(
      "--all",
      "Print the whole thread by paging through every entry (cannot be combined with --limit)",
    )
    .option(
      "--message <seq>",
      "Print one message: the msg value of a message link or @thread:<id>#msg=<seq> mention",
    )
    .option(
      "--context <count>",
      `With --message, also print up to this many messages before and after it (0-${THREAD_MESSAGE_CONTEXT_LIMIT})`,
    )
    .action(
      action(async (id: string | undefined, opts: ThreadLogCommandOptions) => {
        const threadId = requireThreadIdOrSelf(id, opts);
        const sdk = createCliBbSdk(getUrl());
        const format = resolveThreadTimelineTextFormat(opts);

        if (opts.message !== undefined) {
          await printThreadLogMessage(sdk, { threadId, format, opts });
          return;
        }
        if (opts.context !== undefined) {
          throw new Error("--context requires --message");
        }

        if (opts.all && opts.limit !== undefined) {
          throw new Error("--all cannot be combined with --limit");
        }
        if (format !== "json" && opts.afterSeq !== undefined) {
          throw new Error("--after-seq is only supported with --format json");
        }

        if (format === "json") {
          const events = opts.all
            ? await listAllThreadLogEvents(sdk, threadId, opts.afterSeq)
            : await listThreadLogEventsPage(sdk, {
                threadId,
                limit: parseThreadLogLimit(
                  opts.limit,
                  THREAD_LOG_DEFAULT_EVENT_LIMIT,
                ),
                afterSeq: opts.afterSeq,
              });
          console.log(JSON.stringify(events.rows, null, 2));
          if (events.hasMore) {
            const lastSeq = events.rows[events.rows.length - 1]?.seq;
            console.error(
              `Showing the oldest ${events.rows.length} events${
                opts.afterSeq === undefined ? "" : ` after seq ${opts.afterSeq}`
              }; more exist. Use --after-seq ${lastSeq} for the next page or --all for the whole thread.`,
            );
          }
          return;
        }

        const segmentLimit = opts.all
          ? THREAD_LOG_TIMELINE_SEGMENT_LIMIT_MAX
          : parseThreadLogLimit(opts.limit, null);
        if (
          segmentLimit !== null &&
          segmentLimit > THREAD_LOG_TIMELINE_SEGMENT_LIMIT_MAX
        ) {
          throw new Error(
            `--limit must be at most ${THREAD_LOG_TIMELINE_SEGMENT_LIMIT_MAX} for minimal/verbose formats; use --all for the whole thread.`,
          );
        }
        const timelineQuery = {
          threadId,
          ...(format === "verbose"
            ? { includeNestedRows: "true" as const }
            : {}),
          ...(segmentLimit === null
            ? {}
            : { segmentLimit: String(segmentLimit) }),
        };
        const timeline: ThreadTimelineResponse =
          await sdk.threads.timeline(timelineQuery);
        let rows = timeline.rows;
        let page = timeline.timelinePage;
        while (opts.all && page.olderCursor !== null) {
          const older: ThreadTimelineResponse = await sdk.threads.timeline({
            ...timelineQuery,
            beforeAnchorSeq: String(page.olderCursor.anchorSeq),
            beforeAnchorId: page.olderCursor.anchorId,
          });
          rows = prependOlderTimelineRows({
            olderRows: older.rows,
            loadedRows: rows,
          });
          page = older.timelinePage;
        }
        const color = process.stdout.isTTY === true && !process.env.NO_COLOR;
        const text = formatThreadTimelineText(rows, {
          verbose: format === "verbose",
          color,
        });
        const notice =
          page.olderCursor !== null
            ? `(Showing the newest ${page.returnedSegmentCount} user-message turns; older history omitted. Use --limit <n> (max ${THREAD_LOG_TIMELINE_SEGMENT_LIMIT_MAX}) or --all to see more.)`
            : null;
        console.log(notice === null ? text : `${text}\n\n${notice}`);
      }),
    );

  parent
    .command("output [id]")
    .description("Get the final output of a thread")
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (id: string | undefined, opts: ThreadOutputCommandOptions) => {
          const threadId = requireThreadIdOrSelf(id, opts);
          const sdk = createCliBbSdk(getUrl());
          const result = await sdk.threads.output({ threadId });
          if (outputJson(opts, result)) return;
          if (result.output) {
            console.log(result.output);
          } else {
            console.log("(no output)");
          }
        },
      ),
    );
}

function printThreadStatus(
  payload: ThreadStatusPayload,
  environmentInfo: ThreadEnvironmentInfo | null,
  pullRequest: ThreadShowPullRequestPayload | null,
): void {
  const { thread } = payload;
  console.log(`Thread: ${thread.id}`);
  console.log(`  Status: ${thread.status}`);
  if (thread.title) {
    console.log(`  Title: ${thread.title}`);
  }
  console.log(`  Project: ${thread.projectId}`);
  if (thread.parentThreadId) {
    console.log(`  Parent: ${thread.parentThreadId}`);
    console.log(`  Parent notifications: ${thread.parentNotifications}`);
  }
  if (thread.archivedAt !== null) {
    console.log(`  Archived: ${new Date(thread.archivedAt).toLocaleString()}`);
  }
  if (thread.pinnedAt !== null) {
    console.log(`  Pinned: ${new Date(thread.pinnedAt).toLocaleString()}`);
  }
  if (environmentInfo) {
    printEnvironmentInfo(environmentInfo);
    printEnvironmentPullRequest(pullRequest);
  } else if (thread.environmentId) {
    console.log(`  Environment: ${thread.environmentId}`);
    printEnvironmentPullRequest(pullRequest);
  }
  console.log(`  Created: ${new Date(thread.createdAt).toLocaleString()}`);
  console.log(`  Updated: ${new Date(thread.updatedAt).toLocaleString()}`);
}

function printEnvironmentPullRequest(
  pullRequest: ThreadShowPullRequestPayload | null,
): void {
  if (!pullRequest) {
    return;
  }

  if (pullRequest.status === "unavailable") {
    console.log("    Pull request: unavailable");
    if (pullRequest.message) {
      console.log(`      ${pullRequest.message}`);
    }
    return;
  }

  if (pullRequest.status === "none") {
    console.log("    Pull request: none");
    return;
  }

  const pr = pullRequest.pullRequest;
  if (!pr) {
    console.log("    Pull request: none");
    return;
  }
  console.log(`    Pull request: #${pr.number} ${pr.state} - ${pr.title}`);
  console.log(`    URL:          ${pr.url}`);
  console.log(`    Branch:       ${pr.headRefName} -> ${pr.baseRefName}`);
  console.log(`    Attention:    ${pr.attention}`);
  console.log(
    `    Checks:       ${pr.checks.state} (${pr.checks.passedCount} passed, ` +
      `${pr.checks.failedCount} failed, ${pr.checks.pendingCount} pending, ` +
      `${pr.checks.totalCount} total)`,
  );
  console.log(
    `    Review:       ${pr.review.state} (${pr.review.reviewRequestCount} requested)`,
  );
  console.log(`    Merge:        ${pr.mergeability.state}`);
}

async function printThreadLogMessage(
  sdk: BbSdk,
  args: {
    threadId: string;
    format: ThreadTimelineTextFormat;
    opts: ThreadLogCommandOptions;
  },
): Promise<void> {
  const { format, opts, threadId } = args;
  if (opts.all || opts.limit !== undefined || opts.afterSeq !== undefined) {
    throw new Error(
      "--message cannot be combined with --limit, --all or --after-seq",
    );
  }
  if (opts.message === undefined || !/^(0|[1-9]\d*)$/u.test(opts.message)) {
    throw new Error("--message must be a non-negative integer.");
  }
  const context = opts.context === undefined ? 0 : Number(opts.context);
  if (
    opts.context !== undefined &&
    (!/^\d+$/u.test(opts.context) || context > THREAD_MESSAGE_CONTEXT_LIMIT)
  ) {
    throw new Error(
      `--context must be an integer from 0 to ${THREAD_MESSAGE_CONTEXT_LIMIT}.`,
    );
  }
  const result = await sdk.threads.message({
    threadId,
    seq: Number(opts.message),
    before: context,
    after: context,
  });
  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const color = process.stdout.isTTY === true && !process.env.NO_COLOR;
  const formatRows = (rows: readonly TimelineConversationRow[]) =>
    formatThreadTimelineText([...rows], {
      verbose: format === "verbose",
      color,
    });
  if (context === 0) {
    console.log(formatRows([result.message]));
    return;
  }
  const sections = [
    ...(result.before.length > 0
      ? [`Before:\n${formatRows(result.before)}`]
      : []),
    `Message ${opts.message}:\n${formatRows([result.message])}`,
    ...(result.after.length > 0 ? [`After:\n${formatRows(result.after)}`] : []),
  ];
  console.log(sections.join("\n\n"));
}

function parseThreadLogLimit<TDefault extends number | null>(
  value: string | undefined,
  defaultLimit: TDefault,
): number | TDefault {
  if (value === undefined) return defaultLimit;
  if (!/^\d+$/u.test(value) || Number(value) < 1) {
    throw new Error("--limit must be a positive integer.");
  }
  return Number(value);
}

interface ThreadLogEventsPage {
  rows: ThreadEventRow[];
  hasMore: boolean;
}

interface ThreadLogEventBatch {
  pageSize: number;
  rows: ThreadEventRow[];
}

async function listThreadLogEventBatch(
  sdk: BbSdk,
  args: {
    threadId: string;
    limit: number;
    afterSeq: string | undefined;
  },
): Promise<ThreadLogEventBatch> {
  let pageSize = args.limit;
  for (;;) {
    try {
      const rows = await sdk.threads.events.list({
        threadId: args.threadId,
        limit: String(pageSize),
        ...(args.afterSeq === undefined ? {} : { afterSeq: args.afterSeq }),
      });
      return { pageSize, rows };
    } catch (error) {
      if (
        !(error instanceof BbHttpError) ||
        error.status !== 413 ||
        error.code !== "event_data_too_large" ||
        pageSize === 1
      ) {
        throw error;
      }
      pageSize = Math.max(1, Math.ceil(pageSize / 2));
    }
  }
}

function growThreadLogEventPageSize(pageSize: number): number {
  return Math.min(THREAD_EVENT_LIST_PAGE_SIZE, pageSize * 2);
}

async function listThreadLogEventsPage(
  sdk: BbSdk,
  args: { threadId: string; limit: number; afterSeq: string | undefined },
): Promise<ThreadLogEventsPage> {
  const requestedRows = args.limit + 1;
  const rows: ThreadEventRow[] = [];
  let cursor = args.afterSeq;
  let pageSize = THREAD_EVENT_LIST_PAGE_SIZE;
  while (rows.length < requestedRows) {
    const requestedPageSize = Math.min(pageSize, requestedRows - rows.length);
    const page = await listThreadLogEventBatch(sdk, {
      threadId: args.threadId,
      limit: requestedPageSize,
      afterSeq: cursor,
    });
    rows.push(...page.rows);
    const last = page.rows.at(-1);
    if (!last || page.rows.length < page.pageSize) {
      break;
    }
    cursor = String(last.seq);
    pageSize = growThreadLogEventPageSize(page.pageSize);
  }
  const hasMore = rows.length > args.limit;
  return { rows: hasMore ? rows.slice(0, args.limit) : rows, hasMore };
}

async function listAllThreadLogEvents(
  sdk: BbSdk,
  threadId: string,
  afterSeq: string | undefined,
): Promise<ThreadLogEventsPage> {
  const rows: ThreadEventRow[] = [];
  let cursor = afterSeq;
  let pageSize = THREAD_EVENT_LIST_PAGE_SIZE;
  for (;;) {
    const page = await listThreadLogEventBatch(sdk, {
      threadId,
      limit: pageSize,
      afterSeq: cursor,
    });
    rows.push(...page.rows);
    const last = page.rows.at(-1);
    if (last === undefined || page.rows.length < page.pageSize) {
      return { rows, hasMore: false };
    }
    cursor = String(last.seq);
    pageSize = growThreadLogEventPageSize(page.pageSize);
  }
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
