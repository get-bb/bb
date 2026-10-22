import {
  cliCommand,
  defineCli,
  experimental_PluginRpcRefusal,
  PluginCliError,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { assemblePullRequest } from "./assemble.js";
import {
  environmentPullRequestTag,
  githubPrStatusHostContract,
  githubPrStatusRpcContract,
  type EnvironmentPullRequest,
  type HostPullRequestAction,
  type PullRequest,
} from "./contract.js";
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

  const lookedUpBranches = new Map<string, string | null>();

  async function refreshIfBranchChanged(environmentId: string): Promise<void> {
    if (!lookedUpBranches.has(environmentId)) return;
    try {
      const environment = await getEnvironment(environmentId);
      if (
        (environment?.branchName ?? null) !==
        lookedUpBranches.get(environmentId)
      ) {
        store.refresh(environmentId);
      }
    } catch (error) {
      bb.log.debug(
        `Failed to read environment ${environmentId}: ${errorMessage(error)}`,
      );
    }
  }

  async function loadPullRequest(
    environmentId: string,
  ): Promise<EnvironmentPullRequest> {
    let environment: Environment | null;
    try {
      environment = await getEnvironment(environmentId);
    } catch (error) {
      return { outcome: "unavailable", message: errorMessage(error) };
    }
    lookedUpBranches.set(environmentId, environment?.branchName ?? null);
    if (environment === null || !environment.isGitRepo) {
      return { outcome: "absent" };
    }
    if (environment.status !== "ready" || environment.path === null) {
      return { outcome: "unavailable", message: "Environment is not ready" };
    }
    try {
      const lookup = await host.call(
        "view",
        { path: environment.path },
        { hostId: environment.hostId },
      );
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
    } catch (error) {
      return { outcome: "unavailable", message: errorMessage(error) };
    }
  }

  const store = createPullRequestStore({
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
            if (event.changes.includes("git-refs-changed"))
              store.invalidate(environmentId);
            void refreshIfBranchChanged(environmentId);
            return;
          case "invalidate":
            store.invalidate(environmentId);
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
    const result = await loadPullRequest(environmentId);
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

  for (const event of ["thread.idle", "thread.failed"] as const) {
    bb.events.on(event, ({ thread }) => {
      if (thread.environmentId !== null) store.recheck(thread.environmentId);
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
