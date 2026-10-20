import { getEnvironment, type EnvironmentRow } from "@bb/db";
import {
  environmentPullRequestTag,
  type EnvironmentPullRequestResponse,
} from "@bb/server-contract";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { AppDeps, WorkSessionDeps } from "../../types.js";
import type { WatchedTarget } from "../../ws/watched-targets.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { assembleThreadPullRequest } from "./pull-request.js";
import {
  requireWorkspaceCommandTarget,
  workspaceReadCacheKey,
} from "./workspace-command-target.js";

const ACTIVE_PULL_REQUEST_CHECK_MS = 30_000;

type PullRequestWatchDeps = WorkSessionDeps &
  Pick<AppDeps, "workspaceReadCaches">;

interface WatchedPullRequest {
  fingerprint: string | null;
  needsChecks: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface EnvironmentPullRequestReader {
  read(environment: EnvironmentRow): Promise<EnvironmentPullRequestResponse>;
}

function needsActiveChecks(response: EnvironmentPullRequestResponse): boolean {
  if (response.outcome !== "available") {
    return false;
  }
  const { pullRequest } = response;
  return (
    pullRequest.state === "open" &&
    (pullRequest.autoMerge ||
      pullRequest.inMergeQueue === true ||
      pullRequest.checks.state === "pending" ||
      pullRequest.mergeability.state === "unknown")
  );
}

export function createEnvironmentPullRequestWatch(
  deps: PullRequestWatchDeps,
): EnvironmentPullRequestReader {
  const watched = new Map<string, WatchedPullRequest>();

  async function load(
    environment: EnvironmentRow,
    fresh: boolean,
  ): Promise<EnvironmentPullRequestResponse> {
    if (!environment.isGitRepo) {
      return { outcome: "absent" };
    }
    const target = requireWorkspaceCommandTarget(environment);
    if (fresh) {
      deps.workspaceReadCaches.pullRequest.invalidateEnvironment(
        environment.id,
      );
    }
    const result = await deps.workspaceReadCaches.pullRequest.read({
      environmentId: environment.id,
      hostId: target.hostId,
      key: workspaceReadCacheKey(target),
      load: () =>
        callHostRetryableOnlineRpc(deps, {
          hostId: target.hostId,
          timeoutMs: COMMAND_TIMEOUT_MS,
          command: {
            type: "workspace.pull_request",
            environmentId: target.environmentId,
            workspaceContext: target.workspaceContext,
          },
        }),
    });
    if (result.outcome === "available") {
      return {
        outcome: "available",
        pullRequest: assembleThreadPullRequest(result.pullRequest),
      };
    }
    if (result.outcome === "unavailable") {
      return { outcome: "unavailable", message: result.message };
    }
    return { outcome: "absent" };
  }

  function schedule(environmentId: string, entry: WatchedPullRequest): void {
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (!entry.needsChecks) {
      return;
    }
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void check(environmentId, true);
    }, ACTIVE_PULL_REQUEST_CHECK_MS);
  }

  function observe(
    environmentId: string,
    response: EnvironmentPullRequestResponse,
  ): void {
    const entry = watched.get(environmentId);
    if (entry === undefined) {
      return;
    }
    const fingerprint = JSON.stringify(response);
    if (entry.fingerprint !== null && entry.fingerprint !== fingerprint) {
      deps.hub.notifyTags([environmentPullRequestTag(environmentId)]);
    }
    entry.fingerprint = fingerprint;
    entry.needsChecks = needsActiveChecks(response);
    schedule(environmentId, entry);
  }

  async function check(environmentId: string, fresh: boolean): Promise<void> {
    const environment = getEnvironment(deps.db, environmentId);
    if (environment?.status !== "ready") {
      return;
    }
    try {
      observe(environmentId, await load(environment, fresh));
    } catch (error) {
      deps.logger.debug(
        {
          environmentId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to check watched pull request",
      );
      const entry = watched.get(environmentId);
      if (entry !== undefined) {
        schedule(environmentId, entry);
      }
    }
  }

  function start(target: WatchedTarget<"environment-pull-request">): void {
    watched.set(target.environmentId, {
      fingerprint: null,
      needsChecks: false,
      timer: null,
    });
    void check(target.environmentId, false);
  }

  function stop(target: WatchedTarget<"environment-pull-request">): void {
    const entry = watched.get(target.environmentId);
    if (entry?.timer) {
      clearTimeout(entry.timer);
    }
    watched.delete(target.environmentId);
  }

  deps.hub.onWatchedTargets(["environment-pull-request"], (change) => {
    change.stopped.forEach(stop);
    change.started.forEach(start);
  });

  return {
    async read(environment) {
      const response = await load(environment, false);
      observe(environment.id, response);
      return response;
    },
  };
}
