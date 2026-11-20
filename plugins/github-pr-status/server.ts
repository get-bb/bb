import {
  cliCommand,
  defineCli,
  experimental_PluginRpcRefusal,
  PluginCliError,
  type BbPluginApi,
  type PluginCliContext,
} from "@get-bb/plugin-sdk";
import { assemblePullRequest, assembleWatchFacts } from "./assemble.js";
import {
  HOST_VIEWS_MAX_READS,
  githubPrStatusHostContract,
  githubPrStatusRpcContract,
  SHOW_PULL_REQUEST_SETTING,
  type EnvironmentPullRequest,
  type HostPullRequestAction,
  type HostPullRequestLookup,
  type HostRefs,
  type PullRequest,
  type PullRequestWatch,
  type PullRequestWatchFacts,
  CHECK_LOG_LINES_DEFAULT,
  CHECK_LOG_LINES_MAX,
  type CheckLog,
} from "./contract.js";
import {
  createPullRequestPersistence,
  type StoredWatch,
} from "./persistence.js";
import { environmentPullRequestTag } from "./read-contract.js";
import { createPullRequestStore } from "./store.js";
import {
  evaluateWatch,
  formatWatchMessage,
  githubText,
  mergeWatchMessages,
  WATCH_UNAVAILABLE_LIMIT_MS,
  watchBaseline,
  type WatchMessage,
} from "./watch.js";

const JSON_OPTION = {
  type: "boolean",
  description: "Print machine-readable JSON output",
} as const;

const ENVIRONMENT_POSITIONAL = [
  {
    name: "environment-id",
    description: "Environment whose current branch has the pull request",
    required: true,
  },
] as const;

const THREAD_OPTION = {
  type: "string",
  description:
    "Thread to watch for; defaults to the thread that runs the command",
} as const;

const CHECK_OPTION = {
  type: "string",
  description: "Check name; defaults to every failing check",
} as const;

const LOAD_BATCH_QUIET_MS = 50;
const LOAD_BATCH_MAX_MS = 250;

const REFRESHING_ENVIRONMENT_CHANGES: ReadonlySet<string> = new Set([
  "environment-created",
  "environment-deleted",
  "status-changed",
]);

export function environmentChangeEffect(
  changes: readonly string[],
): "refresh" | "branch" | "invalidate" | null {
  if (changes.some((change) => REFRESHING_ENVIRONMENT_CHANGES.has(change)))
    return "refresh";
  if (changes.includes("metadata-changed")) return "branch";
  if (changes.includes("git-refs-changed")) return "invalidate";
  return null;
}

type Environment = Awaited<
  ReturnType<BbPluginApi["sdk"]["environments"]["get"]>
>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function httpStatusOf(error: unknown): number | null {
  return typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
    ? error.status
    : null;
}

function refuse(message: string): never {
  throw new experimental_PluginRpcRefusal({ code: "conflict", message });
}

async function runCliAction(
  action: () => Promise<{ message: string }>,
  json: boolean,
): Promise<{ exitCode: number; stdout: string }> {
  let result: { message: string };
  try {
    result = await action();
  } catch (error) {
    if (error instanceof experimental_PluginRpcRefusal) {
      throw new PluginCliError(error.message, {
        code: "pull_request_action_failed",
      });
    }
    throw error;
  }
  return {
    exitCode: 0,
    stdout: json ? JSON.stringify(result) : result.message,
  };
}

function describePullRequest(pr: PullRequest): string {
  return [
    `Pull request: #${pr.number} ${pr.state} - ${pr.title}`,
    `URL: ${pr.url}`,
    `Branch: ${pr.headRefName} -> ${pr.baseRefName}`,
    `Attention: ${pr.attention}`,
    `Auto-merge: ${pr.autoMerge ? "on" : "off"}`,
    `Merge queue: ${pr.inMergeQueue === null ? "unknown" : pr.inMergeQueue ? "queued" : "not queued"}`,
    `Checks: ${pr.checks.state} (${pr.checks.passedCount} passed, ` +
      `${pr.checks.failedCount} failed, ${pr.checks.pendingCount} pending, ` +
      `${pr.checks.totalCount} total)`,
    `Review: ${pr.review.state} (${pr.review.reviewRequestCount} requested)`,
    `Merge: ${pr.mergeability.state}`,
  ].join("\n");
}

function describeCheckLog(check: CheckLog): string {
  return [
    `== ${check.name}${check.url === null ? "" : ` (${check.url})`}`,
    ...(check.note === null ? [] : [check.note]),
    ...(check.log === null ? [] : [check.log]),
  ].join("\n");
}

function cliThreadId(
  thread: string | undefined,
  ctx: PluginCliContext,
): string {
  const threadId = thread ?? ctx.threadId;
  if (threadId === undefined)
    throw new PluginCliError(
      "Pass --thread, or run the command from a bb thread",
      { code: "missing_required" },
    );
  return threadId;
}

function describeEnvironmentPullRequest(
  result: EnvironmentPullRequest,
): string {
  switch (result.outcome) {
    case "available":
      return describePullRequest(result.pullRequest);
    case "absent":
      return "No pull request found";
    case "unavailable":
      return `Pull request lookup unavailable: ${result.message}`;
  }
}

export default function githubPrStatusPlugin(bb: BbPluginApi): void {
  bb.settings.define({
    [SHOW_PULL_REQUEST_SETTING]: {
      type: "boolean",
      label: "Show pull request above the composer",
      description:
        "Show the pull request's status, Mark ready and merge above the composer.",
      default: true,
    },
  });
  const host = bb.hosts.experimental_client({
    contract: githubPrStatusHostContract,
  });

  async function getEnvironment(
    environmentId: string,
  ): Promise<Environment | null> {
    try {
      return await bb.sdk.environments.get({ environmentId });
    } catch (error) {
      if (httpStatusOf(error) === 404) return null;
      throw error;
    }
  }

  const watches = new Map<string, StoredWatch>();
  const watchStarts = new Map<string, number>();
  const watchFacts = new Map<string, PullRequestWatchFacts>();
  const NO_WATCH_FACTS: PullRequestWatchFacts = {
    failedChecks: [],
    outsideActivity: null,
  };

  function watchesPullRequest(environmentId: string, url: string): boolean {
    if ((watchStarts.get(environmentId) ?? 0) > 0) return true;
    for (const watch of watches.values())
      if (watch.environmentId === environmentId || watch.url === url)
        return true;
    return false;
  }

  const persistence = createPullRequestPersistence(bb.storage);
  const savedLinks = persistence.links();
  const lookedUpBranches = new Map<string, string | null>(
    savedLinks.map((link) => [link.environmentId, link.branch]),
  );
  const upstreams = new Map<string, string | null>();

  async function inspectRefs(
    environmentId: string,
    refsChanged: boolean,
  ): Promise<void> {
    if (!lookedUpBranches.has(environmentId)) return;
    try {
      const environment = await getEnvironment(environmentId);
      if (environment?.status !== "ready" || environment.path === null) return;
      const refs = await host.call(
        "upstream",
        { path: environment.path },
        { hostId: environment.hostId },
      );
      const previousBranch = lookedUpBranches.get(environmentId);
      const previousOid = upstreams.get(environmentId);
      lookedUpBranches.set(environmentId, refs.branchName);
      upstreams.set(environmentId, refs.oid);
      if (previousBranch !== refs.branchName)
        store.refresh(environmentId, true);
      else if (
        refsChanged &&
        store.hasPullRequest(environmentId) &&
        refs.oid !== null &&
        previousOid !== refs.oid
      )
        store.pushed(environmentId);
    } catch (error) {
      bb.log.debug(
        `Failed to inspect refs for ${environmentId}: ${errorMessage(error)}`,
      );
    }
  }

  type ViewRead = {
    path: string;
    known: { url: string; branchName: string | null } | null;
    refresh: boolean;
  };
  type PreparedLoad =
    | { kind: "done"; result: EnvironmentPullRequest }
    | { kind: "view"; hostId: string; read: ViewRead };

  async function prepareLoad(
    environmentId: string,
    url: string | null,
    refresh: boolean,
  ): Promise<PreparedLoad> {
    let environment: Environment | null;
    try {
      environment = await getEnvironment(environmentId);
    } catch (error) {
      return {
        kind: "done",
        result: { outcome: "unavailable", message: errorMessage(error) },
      };
    }
    if (environment === null || !environment.isGitRepo) {
      return { kind: "done", result: { outcome: "absent" } };
    }
    if (environment.status !== "ready" || environment.path === null) {
      return {
        kind: "done",
        result: { outcome: "unavailable", message: "Environment is not ready" },
      };
    }
    try {
      const machine = await bb.sdk.hosts.get({ hostId: environment.hostId });
      if (
        machine.status !== "connected" ||
        machine.lifecycle.phase !== "active"
      )
        return {
          kind: "done",
          result: {
            outcome: "unavailable",
            message: `${machine.name} isn't available. Start the machine and try again.`,
          },
        };
    } catch (error) {
      return {
        kind: "done",
        result: { outcome: "unavailable", message: errorMessage(error) },
      };
    }
    const rediscover =
      url !== null &&
      store.currentUrl(environmentId) === url &&
      store.isSettled(environmentId);
    return {
      kind: "view",
      hostId: environment.hostId,
      read: {
        path: environment.path,
        known:
          url === null || rediscover
            ? null
            : {
                url,
                branchName: lookedUpBranches.get(environmentId) ?? null,
              },
        refresh,
      },
    };
  }

  function toEnvironmentPullRequest(
    lookup: HostPullRequestLookup,
  ): EnvironmentPullRequest {
    switch (lookup.outcome) {
      case "found":
        return {
          outcome: "available",
          pullRequest: assemblePullRequest(lookup.pullRequest),
        };
      case "none":
        return { outcome: "absent" };
      case "unavailable":
        return lookup;
    }
  }

  type LoadOutcome = {
    result: EnvironmentPullRequest;
    refs: HostRefs | null;
  };
  type QueuedLoad = {
    environmentId: string;
    url: string | null;
    refresh: boolean;
    resolve(outcome: LoadOutcome): void;
  };
  let queuedLoads: QueuedLoad[] = [];
  let loadsStartedAt = 0;
  let loadTimer: ReturnType<typeof setTimeout> | undefined;

  async function viewOnHost(
    hostId: string,
    batch: readonly { read: ViewRead; load: QueuedLoad }[],
  ): Promise<void> {
    try {
      const results = await host.call(
        "views",
        { reads: batch.map((entry) => entry.read) },
        { hostId },
      );
      batch.forEach((entry, index) => {
        const view = results[index];
        if (view === undefined) {
          entry.load.resolve({
            result: {
              outcome: "unavailable",
              message: "The machine returned no pull request result",
            },
            refs: null,
          });
          return;
        }
        if (view.refs !== null) {
          lookedUpBranches.set(entry.load.environmentId, view.refs.branchName);
          upstreams.set(entry.load.environmentId, view.refs.oid);
        }
        if (
          view.lookup.outcome === "found" &&
          watchesPullRequest(
            entry.load.environmentId,
            view.lookup.pullRequest.url,
          )
        )
          watchFacts.set(
            view.lookup.pullRequest.url,
            assembleWatchFacts(view.lookup.pullRequest),
          );
        entry.load.resolve({
          result: toEnvironmentPullRequest(view.lookup),
          refs: view.refs,
        });
      });
    } catch (error) {
      for (const entry of batch)
        entry.load.resolve({
          result: { outcome: "unavailable", message: errorMessage(error) },
          refs: null,
        });
    }
  }

  async function runLoads(loads: readonly QueuedLoad[]): Promise<void> {
    const prepared = await Promise.all(
      loads.map((load) =>
        prepareLoad(load.environmentId, load.url, load.refresh),
      ),
    );
    const views = new Map<string, { read: ViewRead; load: QueuedLoad }[]>();
    prepared.forEach((entry, index) => {
      const load = loads[index]!;
      if (entry.kind === "done") {
        load.resolve({ result: entry.result, refs: null });
        return;
      }
      const group = views.get(entry.hostId) ?? [];
      group.push({ read: entry.read, load });
      views.set(entry.hostId, group);
    });
    await Promise.all(
      [...views].flatMap(([hostId, entries]) =>
        Array.from(
          { length: Math.ceil(entries.length / HOST_VIEWS_MAX_READS) },
          (_, chunk) =>
            viewOnHost(
              hostId,
              entries.slice(
                chunk * HOST_VIEWS_MAX_READS,
                (chunk + 1) * HOST_VIEWS_MAX_READS,
              ),
            ),
        ),
      ),
    );
  }

  function runQueuedLoads(): void {
    clearTimeout(loadTimer);
    loadTimer = undefined;
    const loads = queuedLoads;
    queuedLoads = [];
    void runLoads(loads);
  }

  function loadPullRequest(
    environmentId: string,
    url: string | null,
    refresh: boolean,
  ): Promise<EnvironmentPullRequest> {
    return loadPullRequestAndBranch(environmentId, url, refresh).then(
      ({ result }) => result,
    );
  }

  function loadPullRequestAndBranch(
    environmentId: string,
    url: string | null,
    refresh: boolean,
  ): Promise<LoadOutcome> {
    return new Promise((resolve) => {
      if (queuedLoads.length === 0) loadsStartedAt = Date.now();
      queuedLoads.push({ environmentId, url, refresh, resolve });
      clearTimeout(loadTimer);
      loadTimer = setTimeout(
        runQueuedLoads,
        Math.min(
          LOAD_BATCH_QUIET_MS,
          Math.max(0, loadsStartedAt + LOAD_BATCH_MAX_MS - Date.now()),
        ),
      );
    });
  }

  const store = createPullRequestStore({
    persistence,
    branch: (environmentId) => lookedUpBranches.get(environmentId) ?? null,
    load: loadPullRequest,
    publish: (environmentIds) => {
      bb.rpc.experimental_invalidate(
        environmentIds.map(environmentPullRequestTag),
      );
    },
    loaded: (environmentId, url, result) =>
      watchLoaded(environmentId, url, result),
    onCheckFailed: (environmentId, error) => {
      bb.log.debug(
        `Failed to check watched pull request for ${environmentId}: ${errorMessage(error)}`,
      );
    },
  });

  bb.onDispose(() => {
    store.dispose();
    clearTimeout(loadTimer);
  });
  bb.events.on("experimental_environment.removed", ({ removal }) => {
    store.remove(removal.environmentId);
    lookedUpBranches.delete(removal.environmentId);
    upstreams.delete(removal.environmentId);
  });

  for (const { environmentId } of savedLinks) {
    void getEnvironment(environmentId)
      .then((environment) => {
        if (environment === null) store.remove(environmentId);
      })
      .catch((error) =>
        bb.log.debug(
          `Failed to check saved environment ${environmentId}: ${errorMessage(error)}`,
        ),
      );
  }

  let watchedCount = 0;
  let stopEnvironmentEvents: (() => void) | null = null;
  function retainEnvironmentEvents(): () => void {
    watchedCount += 1;
    stopEnvironmentEvents ??= bb.sdk.subscribe({
      event: "environment:changed",
      callback: (event) => {
        const environmentId = event.id;
        if (environmentId === undefined || !store.isWatched(environmentId))
          return;
        switch (environmentChangeEffect(event.changes)) {
          case "refresh":
            store.refresh(environmentId);
            return;
          case "branch":
            void inspectRefs(
              environmentId,
              event.changes.includes("git-refs-changed"),
            );
            return;
          case "invalidate":
            void inspectRefs(environmentId, true);
            return;
          case null:
            return;
        }
      },
    });
    return () => {
      watchedCount -= 1;
      if (watchedCount > 0) return;
      stopEnvironmentEvents?.();
      stopEnvironmentEvents = null;
    };
  }

  const watchPolls = new Map<string, AbortController>();
  const lastWatchSuccess = new Map<string, number>();
  const queuedWakes = new Map<
    string,
    { queuedMessageId: string; updatedAt: number; message: WatchMessage }
  >();
  const wakeChains = new Map<string, Promise<void>>();

  function publicWatch(watch: StoredWatch): PullRequestWatch {
    return {
      threadId: watch.threadId,
      environmentId: watch.environmentId,
      url: watch.url,
      number: watch.number,
      startedAt: watch.startedAt,
    };
  }

  function pollForWatch(watch: StoredWatch): void {
    watchPolls.get(watch.threadId)?.abort();
    const controller = new AbortController();
    watchPolls.set(watch.threadId, controller);
    store.watch(watch.environmentId, controller.signal);
    const release = retainEnvironmentEvents();
    controller.signal.addEventListener("abort", release, { once: true });
  }

  function pruneWatchFacts(): void {
    for (const url of watchFacts.keys())
      if (![...watches.values()].some((watch) => watch.url === url))
        watchFacts.delete(url);
  }

  function endWatch(threadId: string): void {
    watches.delete(threadId);
    lastWatchSuccess.delete(threadId);
    persistence.removeWatch(threadId);
    watchPolls.get(threadId)?.abort();
    watchPolls.delete(threadId);
    pruneWatchFacts();
  }

  function saveWatchIfChanged(watch: StoredWatch, before: string): void {
    if (JSON.stringify([watch.progress, watch.unavailableSince]) !== before)
      persistence.saveWatch(watch);
  }

  async function deliverWake(
    watch: StoredWatch,
    message: WatchMessage,
    onFailed: () => void,
  ): Promise<void> {
    const threadId = watch.threadId;
    const queued = queuedWakes.get(threadId);
    queuedWakes.delete(threadId);
    if (queued !== undefined) {
      const merged = mergeWatchMessages(queued.message, message);
      try {
        const row = await bb.sdk.threads.queuedMessages.update({
          threadId,
          queuedMessageId: queued.queuedMessageId,
          expectedUpdatedAt: queued.updatedAt,
          input: [
            { type: "text", text: formatWatchMessage(merged), mentions: [] },
          ],
        });
        queuedWakes.set(threadId, {
          queuedMessageId: row.id,
          updatedAt: row.updatedAt,
          message: merged,
        });
        return;
      } catch (error) {
        bb.log.debug(
          `Queued watch message for ${threadId} was already delivered or changed: ${errorMessage(error)}`,
        );
      }
    }
    try {
      const result = await bb.sdk.threads.send({
        threadId,
        mode: "queue-if-active",
        input: [
          { type: "text", text: formatWatchMessage(message), mentions: [] },
        ],
      });
      if (result.delivery === "queued")
        queuedWakes.set(threadId, {
          queuedMessageId: result.queuedMessage.id,
          updatedAt: result.queuedMessage.updatedAt,
          message,
        });
    } catch (error) {
      bb.log.warn(
        `Failed to message thread ${threadId} about ${watch.url}: ${errorMessage(error)}`,
      );
      if (httpStatusOf(error) === 404) {
        if (watches.get(threadId) === watch) endWatch(threadId);
        return;
      }
      onFailed();
    }
  }

  function wake(
    watch: StoredWatch,
    message: WatchMessage,
    onFailed: () => void = () => {},
  ): void {
    const threadId = watch.threadId;
    const next = (wakeChains.get(threadId) ?? Promise.resolve()).then(() =>
      deliverWake(watch, message, onFailed),
    );
    wakeChains.set(threadId, next);
    void next.finally(() => {
      if (wakeChains.get(threadId) === next) wakeChains.delete(threadId);
    });
  }

  function reportWatch(watch: StoredWatch, pullRequest: PullRequest): void {
    lastWatchSuccess.set(watch.threadId, Date.now());
    const before = JSON.stringify([watch.progress, watch.unavailableSince]);
    const previous = watch.progress;
    const update = evaluateWatch(
      pullRequest,
      watchFacts.get(pullRequest.url) ?? NO_WATCH_FACTS,
      watch.progress,
    );
    if (update.ended !== null) endWatch(watch.threadId);
    else {
      watch.progress = update.progress;
      watch.unavailableSince = null;
      saveWatchIfChanged(watch, before);
    }
    if (update.news.length === 0) return;
    wake(
      watch,
      {
        pullRequest,
        environmentId: watch.environmentId,
        news: update.news,
        ended: update.ended,
      },
      () => {
        if (
          watches.get(watch.threadId) !== watch ||
          watch.progress !== update.progress
        )
          return;
        watch.progress = previous;
        persistence.saveWatch(watch);
      },
    );
  }

  function endWatchWithMessage(watch: StoredWatch, reason: string): void {
    endWatch(watch.threadId);
    wake(watch, {
      pullRequest: { number: watch.number, title: null, url: watch.url },
      environmentId: watch.environmentId,
      news: [reason],
      ended: "stopped",
    });
  }

  async function machineIsAway(environmentId: string): Promise<boolean> {
    const environment = await getEnvironment(environmentId);
    if (environment === null) return false;
    const machine = await bb.sdk.hosts.get({ hostId: environment.hostId });
    return (
      machine.status !== "connected" || machine.lifecycle.phase !== "active"
    );
  }

  async function watchUnavailable(
    watch: StoredWatch,
    message: string,
  ): Promise<void> {
    const readAt = Date.now();
    let away: boolean;
    try {
      away = await machineIsAway(watch.environmentId);
    } catch (error) {
      bb.log.debug(
        `Failed to check the machine of ${watch.environmentId}: ${errorMessage(error)}`,
      );
      return;
    }
    if (
      watches.get(watch.threadId) !== watch ||
      (lastWatchSuccess.get(watch.threadId) ?? 0) >= readAt
    )
      return;
    const before = JSON.stringify([watch.progress, watch.unavailableSince]);
    if (away) watch.unavailableSince = null;
    else if (watch.unavailableSince === null) watch.unavailableSince = readAt;
    else if (readAt - watch.unavailableSince >= WATCH_UNAVAILABLE_LIMIT_MS) {
      endWatchWithMessage(
        watch,
        `bb could not read this pull request for 15 minutes, so the watch ended: ${githubText(message)}`,
      );
      return;
    }
    saveWatchIfChanged(watch, before);
  }

  function watchLoaded(
    environmentId: string,
    url: string | null,
    result: EnvironmentPullRequest,
  ): void {
    const onNamedBranch =
      (lookedUpBranches.get(environmentId) ?? null) !== null;
    for (const watch of [...watches.values()]) {
      const sameEnvironment = watch.environmentId === environmentId;
      switch (result.outcome) {
        case "available":
          if (result.pullRequest.url === watch.url)
            reportWatch(watch, result.pullRequest);
          else if (sameEnvironment && onNamedBranch)
            endWatchWithMessage(
              watch,
              `The environment's branch now has pull request #${result.pullRequest.number}, not #${watch.number}, so the watch ended.`,
            );
          break;
        case "absent":
          if (sameEnvironment && onNamedBranch)
            endWatchWithMessage(
              watch,
              `The environment's branch no longer has pull request #${watch.number}, so the watch ended.`,
            );
          break;
        case "unavailable":
          if (sameEnvironment || url === watch.url)
            void watchUnavailable(watch, result.message);
          break;
      }
    }
  }

  async function watchingThreadEnvironment(threadId: string): Promise<string> {
    let thread: Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["get"]>>;
    try {
      thread = await bb.sdk.threads.get({ threadId });
    } catch (error) {
      if (httpStatusOf(error) === 404)
        throw new experimental_PluginRpcRefusal({
          code: "not_found",
          message: `Thread not found: ${threadId}`,
        });
      throw error;
    }
    if (thread.environmentId === null)
      refuse("The thread has no environment, so it has no pull request");
    return thread.environmentId;
  }

  async function readForWatchStart(
    environmentId: string,
  ): Promise<EnvironmentPullRequest> {
    watchStarts.set(environmentId, (watchStarts.get(environmentId) ?? 0) + 1);
    try {
      await store.reread(environmentId);
      return await store.read(environmentId, { viewer: false });
    } finally {
      const count = (watchStarts.get(environmentId) ?? 1) - 1;
      if (count > 0) watchStarts.set(environmentId, count);
      else watchStarts.delete(environmentId);
    }
  }

  async function startWatch(threadId: string) {
    const environmentId = await watchingThreadEnvironment(threadId);
    try {
      const result = await readForWatchStart(environmentId);
      if (result.outcome === "unavailable") refuse(result.message);
      if (result.outcome === "absent")
        refuse(
          "No pull request found for the environment's branch. Push the branch and open a pull request first.",
        );
      const pullRequest = result.pullRequest;
      if (pullRequest.state === "merged" || pullRequest.state === "closed")
        refuse(
          `Pull request #${pullRequest.number} is already ${pullRequest.state}`,
        );
      const facts = watchFacts.get(pullRequest.url) ?? NO_WATCH_FACTS;
      const watch: StoredWatch = {
        threadId,
        environmentId,
        url: pullRequest.url,
        number: pullRequest.number,
        startedAt: Date.now(),
        progress: watchBaseline(pullRequest, facts),
        unavailableSince: null,
      };
      if (watches.has(threadId)) endWatch(threadId);
      watches.set(threadId, watch);
      persistence.saveWatch(watch);
      pollForWatch(watch);
      const failing = facts.failedChecks.map((check) => githubText(check.name));
      return {
        message: [
          `Watching #${pullRequest.number} for thread ${threadId}.`,
          describePullRequest(pullRequest),
          ...(failing.length > 0 ? [`Failing now: ${failing.join(", ")}`] : []),
          "bb sends this thread a message when a check fails, all checks pass, someone else comments or reviews, the review decision changes, the branch starts to conflict, or the pull request merges or closes. End your turn now instead of polling.",
        ].join("\n"),
        watch: publicWatch(watch),
      };
    } finally {
      pruneWatchFacts();
    }
  }

  function stopWatch(threadId: string) {
    const watch = watches.get(threadId);
    if (watch === undefined)
      return { message: "The thread watches no pull request" };
    endWatch(threadId);
    return { message: `Stopped watching #${watch.number}` };
  }

  function describeWatch(threadId: string): string {
    const watch = watches.get(threadId);
    return watch === undefined
      ? "The thread watches no pull request"
      : `Watching #${watch.number} (${watch.url}) in environment ${watch.environmentId} since ${new Date(watch.startedAt).toISOString()}`;
  }

  bb.background.service("pull-request-watches", {
    start: (signal) =>
      new Promise<void>((resolve) => {
        for (const watch of persistence.watches()) {
          watches.set(watch.threadId, watch);
          pollForWatch(watch);
        }
        signal.addEventListener(
          "abort",
          () => {
            for (const controller of watchPolls.values()) controller.abort();
            watchPolls.clear();
            watches.clear();
            resolve();
          },
          { once: true },
        );
      }),
  });
  for (const event of ["thread.archived", "thread.deleted"] as const) {
    bb.events.on(event, ({ thread }) => {
      if (watches.has(thread.id)) endWatch(thread.id);
    });
  }
  bb.events.on("experimental_environment.removed", ({ removal }) => {
    for (const watch of [...watches.values()])
      if (watch.environmentId === removal.environmentId)
        endWatch(watch.threadId);
  });

  async function checkLogs(
    environmentId: string,
    check: string | null,
    lines: number,
  ): Promise<CheckLog[]> {
    const target = await requireActionTarget(environmentId);
    const result = await host.call(
      "checkLogs",
      { path: target.path, url: target.pullRequest.url, check, lines },
      { hostId: target.environment.hostId, timeoutMs: 120_000 },
    );
    if (!result.ok) refuse(result.message);
    return result.checks;
  }

  async function rerunChecks(environmentId: string, check: string | null) {
    const target = await requireActionTarget(environmentId);
    try {
      const result = await host.call(
        "rerunChecks",
        { path: target.path, url: target.pullRequest.url, check },
        { hostId: target.environment.hostId, timeoutMs: 120_000 },
      );
      if (!result.ok) refuse(result.message);
      return { message: result.message };
    } finally {
      store.pushed(environmentId);
    }
  }

  async function requireActionTarget(environmentId: string): Promise<{
    environment: Environment;
    path: string;
    pullRequest: PullRequest;
  }> {
    const environment = await getEnvironment(environmentId);
    if (environment === null) {
      throw new experimental_PluginRpcRefusal({
        code: "not_found",
        message: `Environment not found: ${environmentId}`,
      });
    }
    if (!environment.isGitRepo) {
      refuse("Pull request actions require a git environment");
    }
    if (environment.status !== "ready" || environment.path === null) {
      refuse("Environment is not ready");
    }
    const machine = await bb.sdk.hosts.get({ hostId: environment.hostId });
    if (
      machine.status !== "connected" ||
      machine.lifecycle.phase !== "active"
    ) {
      refuse(
        `${machine.name} isn't available, so its pull request can't be changed. Start the machine and try again.`,
      );
    }
    const url = store.currentUrl(environmentId);
    const checked = await loadPullRequestAndBranch(environmentId, url, true);
    let result = checked.result;
    if (
      url !== null &&
      result.outcome === "available" &&
      (result.pullRequest.state === "merged" ||
        result.pullRequest.state === "closed" ||
        result.pullRequest.headRefName !== checked.refs?.branchName)
    )
      result = await loadPullRequest(environmentId, null, true);
    if (result.outcome === "unavailable") refuse(result.message);
    if (result.outcome === "absent") refuse("No pull request found");
    return {
      environment,
      path: environment.path,
      pullRequest: result.pullRequest,
    };
  }

  async function runAction(
    environmentId: string,
    action: HostPullRequestAction,
    assertState: (pullRequest: PullRequest) => void,
  ): Promise<void> {
    const target = await requireActionTarget(environmentId);
    assertState(target.pullRequest);
    try {
      const result = await host.call(
        "act",
        { path: target.path, url: target.pullRequest.url, action },
        { hostId: target.environment.hostId, timeoutMs: 90_000 },
      );
      if (!result.ok) refuse(result.message);
    } finally {
      store.refresh(environmentId);
    }
  }

  async function markReady(environmentId: string) {
    await runAction(environmentId, { operation: "ready" }, (pullRequest) => {
      if (pullRequest.state !== "draft") refuse("Pull request is not a draft");
    });
    return { message: "Pull request marked ready" };
  }

  async function markDraft(environmentId: string) {
    await runAction(environmentId, { operation: "draft" }, (pullRequest) => {
      if (pullRequest.state !== "open") refuse("Pull request is not open");
    });
    return { message: "Pull request converted to draft" };
  }

  async function merge(
    environmentId: string,
    method: "merge" | "squash" | "rebase",
  ) {
    await runAction(
      environmentId,
      { operation: "merge", method },
      (pullRequest) => {
        if (
          pullRequest.state !== "open" ||
          pullRequest.mergeability.state !== "mergeable"
        ) {
          refuse("Pull request is not currently mergeable");
        }
      },
    );
    return { message: "Pull request merge started" };
  }

  bb.rpc.register(
    githubPrStatusRpcContract,
    {
      async pullRequests({ keys }, context) {
        const viewer = context.experimental_caller.kind === "client";
        const results = await Promise.all(
          keys.map(
            async (key) => [key, await store.read(key, { viewer })] as const,
          ),
        );
        return Object.fromEntries(results);
      },
      async refresh({ environmentId }) {
        await store.reread(environmentId);
        return { ok: true } as const;
      },
      markReady: ({ environmentId }) => markReady(environmentId),
      markDraft: ({ environmentId }) => markDraft(environmentId),
      merge: ({ environmentId, method }) => merge(environmentId, method),
      watch: ({ threadId }) => startWatch(threadId),
      unwatch: async ({ threadId }) => stopWatch(threadId),
      watching: async ({ threadId }) => {
        const watch = watches.get(threadId);
        return { watch: watch === undefined ? null : publicWatch(watch) };
      },
      checkLogs: async ({ environmentId, check, lines }) => ({
        checks: await checkLogs(environmentId, check, lines),
      }),
      rerunChecks: ({ environmentId, check }) =>
        rerunChecks(environmentId, check),
    },
    {
      experimental_discoverable: true,
      experimental_description:
        "GitHub pull request status and actions for bb environments.",
    },
  );

  bb.rpc.experimental_whileWatched("pullRequests", (read, signal) => {
    if (!("key" in read)) return;
    store.watch(read.key, signal);
    const release = retainEnvironmentEvents();
    signal.addEventListener("abort", release, { once: true });
  });

  async function turnRanGh(threadId: string): Promise<boolean> {
    let beforeSeq: string | undefined;
    for (;;) {
      const events = await bb.sdk.threads.events.list({
        threadId,
        beforeSeq,
        order: "desc",
        limit: "100",
        types: ["item/started", "item/completed", "client/turn/requested"],
      });
      if (events.length === 0) return false;
      for (const event of events) {
        if (event.type === "client/turn/requested") return false;
        if (event.type !== "item/started" && event.type !== "item/completed")
          continue;
        const item = event.data.item;
        const command =
          item.type === "commandExecution"
            ? item.command
            : item.type === "toolCall"
              ? JSON.stringify(item.arguments ?? {})
              : "";
        if (/(?:^|[\s;|&"'])gh\s/u.test(command)) return true;
      }
      beforeSeq = String(events[events.length - 1]!.seq);
    }
  }
  for (const event of ["thread.idle", "thread.failed"] as const) {
    bb.events.on(event, async ({ thread }) => {
      const environmentId = thread.environmentId;
      if (environmentId === null || !store.isWatched(environmentId)) return;
      if (!store.hasPullRequest(environmentId))
        store.refresh(environmentId, true);
      else if (await turnRanGh(thread.id)) store.recheck(environmentId);
    });
  }

  bb.cli.register(
    defineCli({
      name: "pull-request",
      summary: "Inspect and manage an environment's GitHub pull request",
      description:
        "Runs gh on the environment's machine against its current branch. The machine must be online; bb does not wake it.",
      commands: {
        show: cliCommand({
          summary: "Show an environment's pull request",
          positionals: ENVIRONMENT_POSITIONAL,
          options: { json: JSON_OPTION },
          async run(input) {
            const result = await store.read(
              input.positionals["environment-id"],
              { viewer: false },
            );
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify(result)
                : describeEnvironmentPullRequest(result),
            };
          },
        }),
        watch: cliCommand({
          summary:
            "Message a thread when its pull request's checks, reviews or mergeability change",
          description:
            "Watches the pull request of the thread's environment. bb sends the thread a message when a check fails, all checks pass, someone else comments or reviews, the review decision changes, the branch starts to conflict, or the pull request merges or closes. End the turn after this command instead of polling. One watch per thread; watching again restarts it.",
          options: { thread: THREAD_OPTION, json: JSON_OPTION },
          run: (input, ctx) =>
            runCliAction(
              () => startWatch(cliThreadId(input.options.thread, ctx)),
              input.options.json,
            ),
        }),
        watching: cliCommand({
          summary: "Show the pull request a thread watches",
          options: { thread: THREAD_OPTION, json: JSON_OPTION },
          async run(input, ctx) {
            const threadId = cliThreadId(input.options.thread, ctx);
            const watch = watches.get(threadId);
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify({
                    watch: watch === undefined ? null : publicWatch(watch),
                  })
                : describeWatch(threadId),
            };
          },
        }),
        unwatch: cliCommand({
          summary: "Stop watching a thread's pull request",
          options: { thread: THREAD_OPTION, json: JSON_OPTION },
          run: (input, ctx) =>
            runCliAction(
              async () => stopWatch(cliThreadId(input.options.thread, ctx)),
              input.options.json,
            ),
        }),
        logs: cliCommand({
          summary: "Print the end of each failing check's log",
          description:
            "Reads GitHub Actions job logs through gh on the environment's machine. Prints the lines up to the last error of each failing check, or of the check named by --check. Checks from other CI services print only their link.",
          positionals: ENVIRONMENT_POSITIONAL,
          options: {
            check: CHECK_OPTION,
            lines: {
              type: "integer",
              min: 1,
              max: CHECK_LOG_LINES_MAX,
              default: CHECK_LOG_LINES_DEFAULT,
              description: "Lines per check",
            },
            json: JSON_OPTION,
          },
          async run(input) {
            let checks: CheckLog[];
            try {
              checks = await checkLogs(
                input.positionals["environment-id"],
                input.options.check ?? null,
                input.options.lines,
              );
            } catch (error) {
              if (error instanceof experimental_PluginRpcRefusal)
                throw new PluginCliError(error.message, {
                  code: "pull_request_action_failed",
                });
              throw error;
            }
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify({ checks })
                : checks.map(describeCheckLog).join("\n\n"),
            };
          },
        }),
        rerun: cliCommand({
          summary: "Re-run failing GitHub Actions jobs",
          description:
            "Re-runs the failed jobs of each workflow run with a failing check, or only the job of the check named by --check.",
          positionals: ENVIRONMENT_POSITIONAL,
          options: { check: CHECK_OPTION, json: JSON_OPTION },
          run: (input) =>
            runCliAction(
              () =>
                rerunChecks(
                  input.positionals["environment-id"],
                  input.options.check ?? null,
                ),
              input.options.json,
            ),
        }),
        ready: cliCommand({
          summary: "Mark a pull request ready for review",
          positionals: ENVIRONMENT_POSITIONAL,
          options: { json: JSON_OPTION },
          run: (input) =>
            runCliAction(
              () => markReady(input.positionals["environment-id"]),
              input.options.json,
            ),
        }),
        draft: cliCommand({
          summary: "Convert a pull request to draft",
          positionals: ENVIRONMENT_POSITIONAL,
          options: { json: JSON_OPTION },
          run: (input) =>
            runCliAction(
              () => markDraft(input.positionals["environment-id"]),
              input.options.json,
            ),
        }),
        merge: cliCommand({
          summary: "Merge a pull request",
          positionals: ENVIRONMENT_POSITIONAL,
          options: {
            method: {
              type: "enum",
              values: ["merge", "squash", "rebase"],
              default: "merge",
              description: "Merge method",
            },
            json: JSON_OPTION,
          },
          run: (input) =>
            runCliAction(
              () =>
                merge(
                  input.positionals["environment-id"],
                  input.options.method,
                ),
              input.options.json,
            ),
        }),
      },
    }),
  );
}
