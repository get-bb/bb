import {
  cliCommand,
  defineCli,
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
  type HostPullRequestAction,
  type HostPullRequestLookup,
  type PullRequest,
} from "./contract.js";
import { createPullRequestPersistence } from "./persistence.js";
import { environmentPullRequestTag } from "./read-contract.js";
import { createPullRequestStore } from "./store.js";

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

  type ViewRead = { path: string; url: string | null; refresh: boolean };
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
      const refs = await host.call(
        "upstream",
        { path: environment.path },
        { hostId: environment.hostId },
      );
      if (
        url !== null &&
        store.currentUrl(environmentId) === url &&
        lookedUpBranches.has(environmentId) &&
        lookedUpBranches.get(environmentId) !== refs.branchName
      )
        url = null;
      lookedUpBranches.set(environmentId, refs.branchName);
      upstreams.set(environmentId, refs.oid);
      return {
        kind: "view",
        hostId: environment.hostId,
        read: { path: environment.path, url, refresh },
      };
    } catch (error) {
      return {
        kind: "done",
        result: { outcome: "unavailable", message: errorMessage(error) },
      };
    }
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

  type QueuedLoad = {
    environmentId: string;
    url: string | null;
    refresh: boolean;
    resolve(result: EnvironmentPullRequest): void;
  };
  let queuedLoads: QueuedLoad[] = [];
  let loadsStartedAt = 0;
  let loadTimer: ReturnType<typeof setTimeout> | undefined;

  async function viewOnHost(
    hostId: string,
    batch: readonly { read: ViewRead; load: QueuedLoad }[],
  ): Promise<void> {
    try {
      const lookups = await host.call(
        "views",
        { reads: batch.map((entry) => entry.read) },
        { hostId },
      );
      batch.forEach((entry, index) => {
        const lookup = lookups[index];
        entry.load.resolve(
          lookup === undefined
            ? {
                outcome: "unavailable",
                message: "The machine returned no pull request result",
              }
            : toEnvironmentPullRequest(lookup),
        );
      });
    } catch (error) {
      for (const entry of batch)
        entry.load.resolve({
          outcome: "unavailable",
          message: errorMessage(error),
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
        load.resolve(entry.result);
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
    const result = await loadPullRequest(environmentId, null, true);
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
        { path: target.path, action },
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
