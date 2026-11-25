import {
  cliCommand,
  defineCli,
  experimental_BbHttpError,
  experimental_PluginRpcRefusal,
  PluginCliError,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { assemblePullRequest } from "./assemble.js";
import {
  HOST_VIEWS_MAX_READS,
  githubPrStatusHostContract,
  githubPrStatusRpcContract,
  SHOW_PULL_REQUEST_SETTING,
  type EnvironmentPullRequest,
  type EnvironmentPullRequestEntry,
  type HostPullRequestAction,
  type HostPullRequestLookup,
  type HostRefs,
  type PullRequest,
} from "./contract.js";
import {
  createPullRequestPersistence,
  pullRequestTargetKey,
  type PullRequestTarget,
  type SavedRepo,
} from "./persistence.js";
import { environmentPullRequestTag } from "./read-contract.js";
import { createPullRequestStore, type TargetPullRequest } from "./store.js";

const JSON_OPTION = {
  type: "boolean",
  description: "Print machine-readable JSON output",
} as const;

const ENVIRONMENT_POSITIONAL = [
  {
    name: "environment-id",
    description: "Environment whose pull requests to use",
    required: true,
  },
] as const;

const LINK_POSITIONALS = [
  ...ENVIRONMENT_POSITIONAL,
  { name: "url", description: "Pull request URL", required: true },
] as const;

const URL_OPTION = {
  type: "string",
  description:
    "URL of the pull request to act on; defaults to the environment's first pull request",
} as const;

const PULL_REQUEST_URL =
  /^(https:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/\d+)(?:[/?#].*)?$/u;

function pullRequestUrl(url: string): string {
  const match = PULL_REQUEST_URL.exec(url);
  if (match === null)
    refuse(
      `Expected a pull request URL like https://github.com/owner/repo/pull/123, got ${url}`,
    );
  return match[1]!;
}

const LOAD_BATCH_QUIET_MS = 50;
const LOAD_BATCH_MAX_MS = 250;
const REPOS_FRESH_MS = 60_000;
const REPOS_RETRY_MS = 5 * 60_000;

const PULL_REQUEST_INSTRUCTIONS =
  "bb shows the pull request of each repo's checked-out branch with this thread. " +
  "After you open a pull request for any other branch (a split or stacked branch), " +
  'run `bb pull-request link "$BB_ENVIRONMENT_ID" <url>` so bb shows it too.';

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
type Machine = Awaited<ReturnType<BbPluginApi["sdk"]["hosts"]["get"]>>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function refuse(message: string): never {
  throw new experimental_PluginRpcRefusal({ code: "conflict", message });
}

function mainTarget(environmentId: string): PullRequestTarget {
  return { environmentId, slot: { kind: "repo", label: "" } };
}

function isMainTarget(target: PullRequestTarget): boolean {
  return target.slot.kind === "repo" && target.slot.label === "";
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

function describeEnvironmentPullRequest(
  result: EnvironmentPullRequest,
): string {
  switch (result.outcome) {
    case "available":
      if (result.pullRequests.length === 1)
        return describePullRequest(result.pullRequest);
      return result.pullRequests
        .map(
          (entry) =>
            describePullRequest(entry.pullRequest) +
            (entry.linked ? "\nLinked: yes" : ""),
        )
        .join("\n\n");
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
  bb.agents.contributeInstructions(() => PULL_REQUEST_INSTRUCTIONS);
  const host = bb.hosts.experimental_client({
    contract: githubPrStatusHostContract,
  });

  async function getEnvironment(
    environmentId: string,
  ): Promise<Environment | null> {
    try {
      return await bb.sdk.environments.get({ environmentId });
    } catch (error) {
      if (error instanceof experimental_BbHttpError && error.status === 404)
        return null;
      throw error;
    }
  }

  function machineUnavailable(machine: Machine): boolean {
    return (
      machine.status !== "connected" || machine.lifecycle.phase !== "active"
    );
  }

  const persistence = createPullRequestPersistence(bb.storage);
  const savedTargets = persistence.targets();
  const lookedUpBranches = new Map<string, string | null>(
    savedTargets.map((row) => [pullRequestTargetKey(row.target), row.branch]),
  );
  const upstreams = new Map<string, string | null>();
  const repos = persistence.repos();
  const reposCheckedAt = new Map<string, number>();
  const reposResolving = new Map<string, Promise<void>>();
  const linkedUrls = new Map<string, string[]>();

  function linksOf(environmentId: string): string[] {
    let urls = linkedUrls.get(environmentId);
    if (urls === undefined) {
      urls = persistence.linkedUrls(environmentId);
      linkedUrls.set(environmentId, urls);
    }
    return urls;
  }

  function repoTargets(environmentId: string): PullRequestTarget[] {
    return (repos.get(environmentId) ?? []).map((repo) => ({
      environmentId,
      slot: { kind: "repo", label: repo.label },
    }));
  }

  function targetsOf(environmentId: string): PullRequestTarget[] {
    return [
      mainTarget(environmentId),
      ...repoTargets(environmentId),
      ...linksOf(environmentId).map((url): PullRequestTarget => ({
        environmentId,
        slot: { kind: "link", url },
      })),
    ];
  }

  async function inspectRefs(
    environmentId: string,
    refsChanged: boolean,
  ): Promise<void> {
    const target = mainTarget(environmentId);
    const key = pullRequestTargetKey(target);
    if (!lookedUpBranches.has(key)) return;
    try {
      const environment = await getEnvironment(environmentId);
      if (environment?.status !== "ready" || environment.path === null) return;
      const refs = await host.call(
        "upstream",
        { path: environment.path },
        { hostId: environment.hostId },
      );
      const previousBranch = lookedUpBranches.get(key);
      const previousOid = upstreams.get(key);
      lookedUpBranches.set(key, refs.branchName);
      upstreams.set(key, refs.oid);
      if (previousBranch !== refs.branchName) store.refresh(target, true);
      else if (
        refsChanged &&
        store.hasPullRequest(target) &&
        refs.oid !== null &&
        previousOid !== refs.oid
      )
        store.pushed(target);
    } catch (error) {
      bb.log.debug(
        `Failed to inspect refs for ${environmentId}: ${errorMessage(error)}`,
      );
    }
  }

  type ViewRead =
    | {
        kind: "branch";
        path: string;
        known: { url: string; branchName: string | null } | null;
        refresh: boolean;
      }
    | { kind: "url"; path: string; url: string };
  type PreparedLoad =
    | { kind: "done"; result: TargetPullRequest }
    | { kind: "view"; hostId: string; read: ViewRead };
  type Lookups = {
    environment(environmentId: string): Promise<Environment | null>;
    machine(hostId: string): Promise<Machine>;
  };

  function batchLookups(): Lookups {
    const environments = new Map<string, Promise<Environment | null>>();
    const machines = new Map<string, Promise<Machine>>();
    return {
      environment(environmentId) {
        let found = environments.get(environmentId);
        if (found === undefined) {
          found = getEnvironment(environmentId);
          environments.set(environmentId, found);
        }
        return found;
      },
      machine(hostId) {
        let found = machines.get(hostId);
        if (found === undefined) {
          found = bb.sdk.hosts.get({ hostId });
          machines.set(hostId, found);
        }
        return found;
      },
    };
  }

  type ReadyEnvironment =
    | { kind: "ready"; environment: Environment & { path: string } }
    | { kind: "done"; result: TargetPullRequest };

  async function readyEnvironment(
    environmentId: string,
    lookups: Lookups,
    requireGitRepo: boolean,
  ): Promise<ReadyEnvironment> {
    let environment: Environment | null;
    try {
      environment = await lookups.environment(environmentId);
    } catch (error) {
      return {
        kind: "done",
        result: { outcome: "unavailable", message: errorMessage(error) },
      };
    }
    if (environment === null || (requireGitRepo && !environment.isGitRepo)) {
      return { kind: "done", result: { outcome: "absent" } };
    }
    if (environment.status !== "ready" || environment.path === null) {
      return {
        kind: "done",
        result: { outcome: "unavailable", message: "Environment is not ready" },
      };
    }
    try {
      const machine = await lookups.machine(environment.hostId);
      if (machineUnavailable(machine))
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
    return {
      kind: "ready",
      environment: { ...environment, path: environment.path },
    };
  }

  function targetPath(
    target: PullRequestTarget,
    environment: Environment & { path: string },
  ): string | null {
    if (target.slot.kind === "link" || isMainTarget(target))
      return environment.path;
    const label = target.slot.label;
    return (
      repos.get(target.environmentId)?.find((repo) => repo.label === label)
        ?.rootPath ?? null
    );
  }

  async function prepareLoad(
    target: PullRequestTarget,
    url: string | null,
    refresh: boolean,
    lookups: Lookups,
  ): Promise<PreparedLoad> {
    const ready = await readyEnvironment(
      target.environmentId,
      lookups,
      isMainTarget(target),
    );
    if (ready.kind === "done") return ready;
    const { environment } = ready;
    const path = targetPath(target, environment);
    if (path === null) return { kind: "done", result: { outcome: "absent" } };
    if (target.slot.kind === "link")
      return {
        kind: "view",
        hostId: environment.hostId,
        read: { kind: "url", path, url: target.slot.url },
      };
    const rediscover =
      url !== null &&
      store.currentUrl(target) === url &&
      store.isSettled(target);
    return {
      kind: "view",
      hostId: environment.hostId,
      read: {
        kind: "branch",
        path,
        known:
          url === null || rediscover
            ? null
            : {
                url,
                branchName:
                  lookedUpBranches.get(pullRequestTargetKey(target)) ?? null,
              },
        refresh,
      },
    };
  }

  function toTargetPullRequest(
    lookup: HostPullRequestLookup,
  ): TargetPullRequest {
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
    result: TargetPullRequest;
    refs: HostRefs | null;
  };
  type QueuedLoad = {
    target: PullRequestTarget;
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
          const key = pullRequestTargetKey(entry.load.target);
          lookedUpBranches.set(key, view.refs.branchName);
          upstreams.set(key, view.refs.oid);
        }
        entry.load.resolve({
          result: toTargetPullRequest(view.lookup),
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
    const lookups = batchLookups();
    const prepared = await Promise.all(
      loads.map((load) =>
        prepareLoad(load.target, load.url, load.refresh, lookups),
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
    target: PullRequestTarget,
    url: string | null,
    refresh: boolean,
  ): Promise<TargetPullRequest> {
    return loadPullRequestAndBranch(target, url, refresh).then(
      ({ result }) => result,
    );
  }

  function loadPullRequestAndBranch(
    target: PullRequestTarget,
    url: string | null,
    refresh: boolean,
  ): Promise<LoadOutcome> {
    return new Promise((resolve) => {
      if (queuedLoads.length === 0) loadsStartedAt = Date.now();
      queuedLoads.push({ target, url, refresh, resolve });
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
    branch: (target) =>
      lookedUpBranches.get(pullRequestTargetKey(target)) ?? null,
    load: loadPullRequest,
    publish: (targets) => {
      bb.rpc.experimental_invalidate([
        ...new Set(
          targets.map((target) =>
            environmentPullRequestTag(target.environmentId),
          ),
        ),
      ]);
    },
    onCheckFailed: (target, error) => {
      bb.log.debug(
        `Failed to check watched pull request for ${target.environmentId}: ${errorMessage(error)}`,
      );
    },
  });

  const watchedEnvironments = new Map<string, Set<AbortSignal>>();

  function watchTargets(environmentId: string): void {
    const signals = watchedEnvironments.get(environmentId);
    if (signals === undefined) return;
    for (const target of targetsOf(environmentId))
      for (const signal of signals) store.watch(target, signal);
  }

  function forgetTarget(target: PullRequestTarget): void {
    store.remove(target);
    const key = pullRequestTargetKey(target);
    lookedUpBranches.delete(key);
    upstreams.delete(key);
  }

  function forgetEnvironment(environmentId: string): void {
    for (const target of targetsOf(environmentId)) forgetTarget(target);
    persistence.removeEnvironment(environmentId);
    repos.delete(environmentId);
    reposCheckedAt.delete(environmentId);
    linkedUrls.delete(environmentId);
  }

  async function resolveRepos(environmentId: string): Promise<void> {
    const ready = await readyEnvironment(environmentId, batchLookups(), false);
    if (ready.kind === "done") return;
    const { repos: found } = await bb.sdk.environments.experimental_repos({
      environmentId,
    });
    const next: SavedRepo[] = found
      .filter((repo) => repo.source !== "main")
      .map((repo) => ({ label: repo.label, rootPath: repo.rootPath }));
    const previous = repos.get(environmentId);
    const changed = JSON.stringify(previous ?? []) !== JSON.stringify(next);
    if (previous !== undefined && !changed) return;
    const kept = new Set(next.map((repo) => repo.label));
    for (const repo of previous ?? [])
      if (!kept.has(repo.label))
        forgetTarget({
          environmentId,
          slot: { kind: "repo", label: repo.label },
        });
    repos.set(environmentId, next);
    persistence.saveRepos(environmentId, next);
    if (!changed) return;
    watchTargets(environmentId);
    if (watchedEnvironments.has(environmentId))
      bb.rpc.experimental_invalidate([
        environmentPullRequestTag(environmentId),
      ]);
  }

  function ensureRepos(
    environmentId: string,
    freshWithinMs: number | null,
  ): Promise<void> {
    const checkedAt = reposCheckedAt.get(environmentId);
    const age =
      checkedAt === undefined
        ? Number.POSITIVE_INFINITY
        : Date.now() - checkedAt;
    const current =
      freshWithinMs === null
        ? repos.has(environmentId) || age < REPOS_RETRY_MS
        : age < freshWithinMs;
    if (current) return Promise.resolve();
    let pending = reposResolving.get(environmentId);
    if (pending === undefined) {
      pending = resolveRepos(environmentId)
        .catch((error) =>
          bb.log.debug(
            `Failed to find repos for ${environmentId}: ${errorMessage(error)}`,
          ),
        )
        .finally(() => {
          reposCheckedAt.set(environmentId, Date.now());
          reposResolving.delete(environmentId);
        });
      reposResolving.set(environmentId, pending);
    }
    return pending;
  }

  function assembleRow(
    environmentId: string,
    results: readonly TargetPullRequest[],
  ): EnvironmentPullRequest {
    const linked = new Set(linksOf(environmentId));
    const entries: EnvironmentPullRequestEntry[] = [];
    for (const result of results) {
      if (result.outcome !== "available") continue;
      const { pullRequest } = result;
      if (entries.some((entry) => entry.pullRequest.url === pullRequest.url))
        continue;
      entries.push({ pullRequest, linked: linked.has(pullRequest.url) });
    }
    const [first] = entries;
    if (first !== undefined)
      return {
        outcome: "available",
        pullRequest: first.pullRequest,
        pullRequests: entries,
      };
    return (
      results.find((result) => result.outcome === "unavailable") ?? {
        outcome: "absent",
      }
    );
  }

  async function readEnvironment(
    environmentId: string,
    { viewer }: { viewer: boolean },
  ): Promise<EnvironmentPullRequest> {
    if (viewer) void ensureRepos(environmentId, null);
    else await ensureRepos(environmentId, REPOS_FRESH_MS);
    const results = await Promise.all(
      targetsOf(environmentId).map((target) => store.read(target, { viewer })),
    );
    return assembleRow(environmentId, results);
  }

  bb.onDispose(() => {
    store.dispose();
    clearTimeout(loadTimer);
  });
  bb.events.on("experimental_environment.removed", ({ removal }) => {
    forgetEnvironment(removal.environmentId);
  });

  for (const environmentId of new Set([
    ...savedTargets.map((row) => row.target.environmentId),
    ...repos.keys(),
  ])) {
    void getEnvironment(environmentId)
      .then((environment) => {
        if (environment === null) forgetEnvironment(environmentId);
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
        if (
          environmentId === undefined ||
          !watchedEnvironments.has(environmentId)
        )
          return;
        switch (environmentChangeEffect(event.changes)) {
          case "refresh":
            void ensureRepos(environmentId, 0);
            for (const target of targetsOf(environmentId))
              store.refresh(target);
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

  async function requireActionTarget(
    environmentId: string,
    url: string | null,
  ): Promise<{
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
    if (environment.status !== "ready" || environment.path === null) {
      refuse("Environment is not ready");
    }
    const machine = await bb.sdk.hosts.get({ hostId: environment.hostId });
    if (machineUnavailable(machine)) {
      refuse(
        `${machine.name} isn't available, so its pull request can't be changed. Start the machine and try again.`,
      );
    }
    const readyEnvironment = { ...environment, path: environment.path };
    const row = await readEnvironment(environmentId, { viewer: false });
    if (row.outcome === "unavailable") refuse(row.message);
    if (row.outcome === "absent") refuse("No pull request found");
    const chosenUrl = url ?? row.pullRequest.url;
    const target = targetsOf(environmentId).find(
      (candidate) => store.currentUrl(candidate) === chosenUrl,
    );
    if (target === undefined)
      refuse(`${chosenUrl} is not one of this environment's pull requests`);
    const path = targetPath(target, readyEnvironment);
    if (path === null) refuse("No pull request found");
    const checked = await loadPullRequestAndBranch(target, chosenUrl, true);
    let result = checked.result;
    if (
      url === null &&
      target.slot.kind === "repo" &&
      result.outcome === "available" &&
      (result.pullRequest.state === "merged" ||
        result.pullRequest.state === "closed" ||
        result.pullRequest.headRefName !== checked.refs?.branchName)
    )
      result = await loadPullRequest(target, null, true);
    if (result.outcome === "unavailable") refuse(result.message);
    if (result.outcome === "absent") refuse("No pull request found");
    return { environment, path, pullRequest: result.pullRequest };
  }

  async function runAction(
    environmentId: string,
    url: string | null,
    action: HostPullRequestAction,
    assertState: (pullRequest: PullRequest) => void,
  ): Promise<void> {
    const target = await requireActionTarget(environmentId, url);
    assertState(target.pullRequest);
    try {
      const result = await host.call(
        "act",
        { path: target.path, url: target.pullRequest.url, action },
        { hostId: target.environment.hostId, timeoutMs: 90_000 },
      );
      if (!result.ok) refuse(result.message);
    } finally {
      for (const candidate of targetsOf(environmentId))
        if (store.currentUrl(candidate) === target.pullRequest.url)
          store.refresh(candidate);
    }
  }

  async function markReady(environmentId: string, url: string | null) {
    await runAction(
      environmentId,
      url,
      { operation: "ready" },
      (pullRequest) => {
        if (pullRequest.state !== "draft")
          refuse("Pull request is not a draft");
      },
    );
    return { message: "Pull request marked ready" };
  }

  async function markDraft(environmentId: string, url: string | null) {
    await runAction(
      environmentId,
      url,
      { operation: "draft" },
      (pullRequest) => {
        if (pullRequest.state !== "open") refuse("Pull request is not open");
      },
    );
    return { message: "Pull request converted to draft" };
  }

  async function merge(
    environmentId: string,
    url: string | null,
    method: "merge" | "squash" | "rebase",
  ) {
    await runAction(
      environmentId,
      url,
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

  async function link(environmentId: string, url: string) {
    const lookups = batchLookups();
    const ready = await readyEnvironment(environmentId, lookups, false);
    if (ready.kind === "done") {
      if (ready.result.outcome === "unavailable") refuse(ready.result.message);
      throw new experimental_PluginRpcRefusal({
        code: "not_found",
        message: `Environment not found: ${environmentId}`,
      });
    }
    const probe: PullRequestTarget = {
      environmentId,
      slot: { kind: "link", url },
    };
    const { result } = await loadPullRequestAndBranch(probe, null, true);
    if (result.outcome === "unavailable") refuse(result.message);
    if (result.outcome === "absent") refuse(`No pull request found at ${url}`);
    const canonical = result.pullRequest.url;
    const urls = linksOf(environmentId);
    if (!urls.includes(canonical)) {
      persistence.addLinkedUrl(environmentId, canonical);
      linkedUrls.set(environmentId, [...urls, canonical]);
    }
    const target: PullRequestTarget = {
      environmentId,
      slot: { kind: "link", url: canonical },
    };
    watchTargets(environmentId);
    await store.reread(target);
    bb.rpc.experimental_invalidate([environmentPullRequestTag(environmentId)]);
    return {
      message: `Linked pull request #${result.pullRequest.number} to ${environmentId}`,
    };
  }

  function unlink(environmentId: string, url: string) {
    const urls = linksOf(environmentId);
    if (!urls.includes(url)) refuse(`${url} is not linked to ${environmentId}`);
    persistence.removeLinkedUrl(environmentId, url);
    linkedUrls.set(
      environmentId,
      urls.filter((linkedUrl) => linkedUrl !== url),
    );
    forgetTarget({ environmentId, slot: { kind: "link", url } });
    bb.rpc.experimental_invalidate([environmentPullRequestTag(environmentId)]);
    return { message: `Unlinked ${url} from ${environmentId}` };
  }

  bb.rpc.register(
    githubPrStatusRpcContract,
    {
      async pullRequests({ keys }, context) {
        const viewer = context.experimental_caller.kind === "client";
        const results = await Promise.all(
          keys.map(
            async (key) =>
              [key, await readEnvironment(key, { viewer })] as const,
          ),
        );
        return Object.fromEntries(results);
      },
      async refresh({ environmentId }) {
        await ensureRepos(environmentId, 0);
        await Promise.all(
          targetsOf(environmentId).map((target) => store.reread(target)),
        );
        return { ok: true } as const;
      },
      markReady: ({ environmentId, url }) =>
        markReady(environmentId, url ?? null),
      markDraft: ({ environmentId, url }) =>
        markDraft(environmentId, url ?? null),
      merge: ({ environmentId, url, method }) =>
        merge(environmentId, url ?? null, method),
      link: ({ environmentId, url }) =>
        link(environmentId, pullRequestUrl(url)),
      unlink: async ({ environmentId, url }) =>
        unlink(environmentId, pullRequestUrl(url)),
    },
    {
      experimental_discoverable: true,
      experimental_description:
        "GitHub pull request status and actions for bb environments.",
    },
  );

  bb.rpc.experimental_whileWatched("pullRequests", (read, signal) => {
    if (!("key" in read)) return;
    const environmentId = read.key;
    const signals = watchedEnvironments.get(environmentId) ?? new Set();
    signals.add(signal);
    watchedEnvironments.set(environmentId, signals);
    watchTargets(environmentId);
    const release = retainEnvironmentEvents();
    signal.addEventListener(
      "abort",
      () => {
        release();
        signals.delete(signal);
        if (signals.size === 0) watchedEnvironments.delete(environmentId);
      },
      { once: true },
    );
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
      if (environmentId === null || !watchedEnvironments.has(environmentId))
        return;
      await ensureRepos(environmentId, 0);
      let ranGh: Promise<boolean> | null = null;
      for (const target of targetsOf(environmentId)) {
        if (!store.hasPullRequest(target)) store.refresh(target, true);
        else if (await (ranGh ??= turnRanGh(thread.id))) store.recheck(target);
      }
    });
  }

  bb.cli.register(
    defineCli({
      name: "pull-request",
      summary: "Inspect and manage an environment's GitHub pull requests",
      description:
        "Runs gh on the environment's machine. An environment shows the pull request of each repo's checked-out branch plus any pull request linked to it. The machine must be online; bb does not wake it.",
      commands: {
        show: cliCommand({
          summary: "Show an environment's pull requests",
          positionals: ENVIRONMENT_POSITIONAL,
          options: { json: JSON_OPTION },
          async run(input) {
            const result = await readEnvironment(
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
        ready: cliCommand({
          summary: "Mark a pull request ready for review",
          positionals: ENVIRONMENT_POSITIONAL,
          options: { url: URL_OPTION, json: JSON_OPTION },
          run: (input) =>
            runCliAction(
              () =>
                markReady(
                  input.positionals["environment-id"],
                  input.options.url ?? null,
                ),
              input.options.json,
            ),
        }),
        draft: cliCommand({
          summary: "Convert a pull request to draft",
          positionals: ENVIRONMENT_POSITIONAL,
          options: { url: URL_OPTION, json: JSON_OPTION },
          run: (input) =>
            runCliAction(
              () =>
                markDraft(
                  input.positionals["environment-id"],
                  input.options.url ?? null,
                ),
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
            url: URL_OPTION,
            json: JSON_OPTION,
          },
          run: (input) =>
            runCliAction(
              () =>
                merge(
                  input.positionals["environment-id"],
                  input.options.url ?? null,
                  input.options.method,
                ),
              input.options.json,
            ),
        }),
        link: cliCommand({
          summary: "Show another pull request with an environment",
          positionals: LINK_POSITIONALS,
          options: { json: JSON_OPTION },
          run: (input) =>
            runCliAction(
              () =>
                link(
                  input.positionals["environment-id"],
                  input.positionals.url,
                ),
              input.options.json,
            ),
        }),
        unlink: cliCommand({
          summary: "Stop showing a linked pull request",
          positionals: LINK_POSITIONALS,
          options: { json: JSON_OPTION },
          run: (input) =>
            runCliAction(
              async () =>
                unlink(
                  input.positionals["environment-id"],
                  pullRequestUrl(input.positionals.url),
                ),
              input.options.json,
            ),
        }),
      },
    }),
  );
}
