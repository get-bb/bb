import type { ThreadListEntry } from "@bb/domain";
import type {
  ProjectWorktree,
  ProjectWorktreeFailure,
} from "@bb/server-contract";
import {
  encodeReuseValue,
  encodeWorktreePathValue,
} from "../environment-picker-value";
import { getThreadDisplayTitle } from "@/lib/thread-title";

export interface ReuseWorktreeDetails {
  detachedHeadSha: string | null;
  lock: { reason: string | null } | null;
  unavailableReason: "missing" | "prunable" | null;
  userManaged: boolean;
}

export interface ReuseThreadOption {
  value: string | null;
  environmentId: string | null;
  branchName: string | null;
  name: string | null;
  path: string | null;
  environmentProviderId: string | null;
  hostId: string | null;
  hostName: string | null;
  worktree: ReuseWorktreeDetails | null;
  threads: ReadonlyArray<{ id: string; title: string }>;
}

export interface ReuseDiscoveryFailure {
  hostId: string;
  hostName: string | null;
  message: string;
}

interface ReuseThreadOptionsModel {
  options: ReuseThreadOption[];
  failures: ReuseDiscoveryFailure[];
}

interface BuildReuseThreadOptionsArgs {
  threads: readonly ThreadListEntry[];
  worktrees: readonly ProjectWorktree[];
  failures: readonly ProjectWorktreeFailure[];
  hostNameById: ReadonlyMap<string, string> | null;
}

type ThreadPreview = ReuseThreadOption["threads"][number];

function threadPreviewsByEnvironmentId(
  threads: readonly ThreadListEntry[],
): Map<string, ThreadPreview[]> {
  const buckets = new Map<string, ThreadListEntry[]>();
  for (const thread of threads) {
    if (thread.environmentId === null) continue;
    const bucket = buckets.get(thread.environmentId);
    if (bucket) {
      bucket.push(thread);
    } else {
      buckets.set(thread.environmentId, [thread]);
    }
  }
  const previews = new Map<string, ThreadPreview[]>();
  for (const [environmentId, bucket] of buckets) {
    bucket.sort(
      (left, right) => right.latestAttentionAt - left.latestAttentionAt,
    );
    previews.set(
      environmentId,
      bucket.map((thread) => ({
        id: thread.id,
        title: getThreadDisplayTitle(thread),
      })),
    );
  }
  return previews;
}

function discoveredWorktreeOption(
  worktree: ProjectWorktree,
  hostName: string | null,
  threads: readonly ThreadPreview[],
): ReuseThreadOption {
  const { availability, checkout } = worktree;
  return {
    value:
      worktree.environmentId !== null
        ? encodeReuseValue(worktree.environmentId)
        : availability.kind === "selectable"
          ? encodeWorktreePathValue(worktree.hostId, availability.canonicalPath)
          : null,
    environmentId: worktree.environmentId,
    branchName: checkout.kind === "branch" ? checkout.branchName : null,
    name: worktree.environmentName,
    path: worktree.path,
    environmentProviderId: worktree.environmentProviderId,
    hostId: worktree.hostId,
    hostName,
    worktree: {
      detachedHeadSha: checkout.kind === "detached" ? checkout.headSha : null,
      lock: worktree.lock,
      unavailableReason:
        availability.kind === "selectable" ? null : availability.reason,
      userManaged: worktree.ownership === "user-managed",
    },
    threads,
  };
}

function reuseOptionSortLabel(option: ReuseThreadOption): string {
  return (
    option.name ??
    option.branchName ??
    option.worktree?.detachedHeadSha ??
    option.path ??
    option.environmentId ??
    ""
  );
}

export function buildReuseThreadOptions({
  threads,
  worktrees,
  failures,
  hostNameById,
}: BuildReuseThreadOptionsArgs): ReuseThreadOptionsModel {
  const hostName = (hostId: string | null): string | null =>
    hostNameById === null || hostId === null
      ? null
      : (hostNameById.get(hostId) ?? null);
  const previews = threadPreviewsByEnvironmentId(threads);
  const optionsByEnvironmentId = new Map<string, ReuseThreadOption>();
  for (const thread of threads) {
    const environmentId = thread.environmentId;
    if (environmentId === null || optionsByEnvironmentId.has(environmentId)) {
      continue;
    }
    optionsByEnvironmentId.set(environmentId, {
      value: encodeReuseValue(environmentId),
      environmentId,
      branchName: thread.environmentBranchName,
      name: thread.environmentName,
      path: thread.environmentPath,
      environmentProviderId: thread.environmentProviderId,
      hostId: thread.environmentHostId,
      hostName: hostName(thread.environmentHostId),
      worktree: null,
      threads: previews.get(environmentId) ?? [],
    });
  }
  const discovered: ReuseThreadOption[] = [];
  for (const worktree of worktrees) {
    const option = discoveredWorktreeOption(
      worktree,
      hostName(worktree.hostId),
      worktree.environmentId === null
        ? []
        : (previews.get(worktree.environmentId) ?? []),
    );
    if (worktree.environmentId === null) {
      discovered.push(option);
    } else {
      optionsByEnvironmentId.set(worktree.environmentId, option);
    }
  }
  const options = [...optionsByEnvironmentId.values(), ...discovered];
  options.sort((left, right) => {
    const environmentRank =
      Number(right.environmentId !== null) -
      Number(left.environmentId !== null);
    if (environmentRank !== 0) return environmentRank;
    const labelCompare = reuseOptionSortLabel(left).localeCompare(
      reuseOptionSortLabel(right),
    );
    if (labelCompare !== 0) return labelCompare;
    return (left.path ?? "").localeCompare(right.path ?? "");
  });
  return {
    options,
    failures: failures.map((failure) => ({
      hostId: failure.hostId,
      hostName: hostName(failure.hostId),
      message: failure.message,
    })),
  };
}
