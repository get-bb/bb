import {
  defineRpcContract,
  type StandardSchemaV1,
  type StandardSchemaV1Issue,
} from "@get-bb/plugin-sdk";
import type { EnvironmentPullRequest, PullRequest } from "./contract.js";

export const GITHUB_PR_STATUS_PLUGIN_ID = "bb--github-pr-status";
export const PULL_REQUESTS_MAX_KEYS = 200;
export const PULL_REQUESTS_ANY_AGE_MS = Number.MAX_SAFE_INTEGER;

const OPEN_PULL_REQUEST_STALE_MS = 30_000;
const SETTLED_PULL_REQUEST_STALE_MS = 60 * 60_000;
const VENDOR = GITHUB_PR_STATUS_PLUGIN_ID;

export function environmentPullRequestTag(environmentId: string): string {
  return `environment:${environmentId}`;
}

export function pullRequestStaleAfterMs(
  pullRequest: Pick<PullRequest, "state"> | null,
): number {
  return pullRequest?.state === "merged" || pullRequest?.state === "closed"
    ? SETTLED_PULL_REQUEST_STALE_MS
    : OPEN_PULL_REQUEST_STALE_MS;
}

export function isEnvironmentPullRequestStale(
  row: EnvironmentPullRequest,
  loadedAt: number,
  now: number,
): boolean {
  return (
    now - loadedAt >
    pullRequestStaleAfterMs(
      row.outcome === "available" ? row.pullRequest : null,
    )
  );
}

export interface PullRequestsReadInput {
  keys: string[];
  maxAgeMs?: number;
}

function issue(message: string): {
  issues: readonly StandardSchemaV1Issue[];
} {
  return { issues: [{ message }] };
}

const pullRequestsReadInput: StandardSchemaV1<PullRequestsReadInput> = {
  "~standard": {
    version: 1,
    vendor: VENDOR,
    validate(value) {
      if (typeof value !== "object" || value === null)
        return issue("expected an object");
      const keys: unknown = Reflect.get(value, "keys");
      const maxAgeMs: unknown = Reflect.get(value, "maxAgeMs");
      if (
        !Array.isArray(keys) ||
        keys.length === 0 ||
        keys.length > PULL_REQUESTS_MAX_KEYS ||
        !keys.every((key) => typeof key === "string" && key.length > 0)
      )
        return issue(
          `keys must be 1-${PULL_REQUESTS_MAX_KEYS} non-empty strings`,
        );
      if (maxAgeMs === undefined) return { value: { keys } };
      if (!Number.isSafeInteger(maxAgeMs) || Number(maxAgeMs) < 0)
        return issue("maxAgeMs must be a non-negative integer");
      return { value: { keys, maxAgeMs: Number(maxAgeMs) } };
    },
  },
};

const pullRequestsReadOutput: StandardSchemaV1<
  Record<string, EnvironmentPullRequest>
> = {
  "~standard": {
    version: 1,
    vendor: VENDOR,
    validate(value) {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        return issue("expected a record of environment rows");
      const rows: Record<string, EnvironmentPullRequest> = {};
      for (const [key, row] of Object.entries(value)) {
        const outcome: unknown =
          typeof row === "object" && row !== null
            ? Reflect.get(row, "outcome")
            : undefined;
        if (
          outcome !== "available" &&
          outcome !== "absent" &&
          outcome !== "unavailable"
        )
          return issue(`row ${key} has no known outcome`);
        rows[key] = row as EnvironmentPullRequest;
      }
      return { value: rows };
    },
  },
};

export const pullRequestsReadContract = defineRpcContract({
  pullRequests: {
    experimental_description:
      "The GitHub pull request for each environment's current branch, keyed by environment id. maxAgeMs lets saved rows up to that age answer at once while they refresh in the background.",
    input: pullRequestsReadInput,
    output: pullRequestsReadOutput,
    keyTags: (key) => [environmentPullRequestTag(key)],
  },
});
