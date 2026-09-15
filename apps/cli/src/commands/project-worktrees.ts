import type {
  ProjectWorktree,
  ProjectWorktreesResponse,
} from "@bb/server-contract";
import { columnWidths, printBorderlessTable } from "../table.js";

function formatWorktreeLabel(worktree: ProjectWorktree): string {
  if (worktree.environmentName !== null) {
    return worktree.environmentName;
  }
  return worktree.checkout.kind === "branch"
    ? worktree.checkout.branchName
    : `Detached at ${worktree.checkout.headSha.slice(0, 7)}`;
}

function formatWorktreeState(worktree: ProjectWorktree): string {
  if (worktree.availability.kind === "unavailable") {
    return worktree.availability.reason;
  }
  if (worktree.lock !== null) {
    return worktree.lock.reason === null
      ? "locked"
      : `locked: ${worktree.lock.reason}`;
  }
  return "available";
}

export function printProjectWorktrees(
  response: ProjectWorktreesResponse,
  hostNameById: ReadonlyMap<string, string>,
): void {
  const hostIds = [
    ...new Set([
      ...response.worktrees.map((worktree) => worktree.hostId),
      ...response.failures.map((failure) => failure.hostId),
    ]),
  ];
  if (hostIds.length === 0) {
    console.log("No worktrees found");
    return;
  }
  const multiMachine = hostIds.length > 1;
  const hostLabel = (hostId: string) => hostNameById.get(hostId) ?? hostId;

  const rows: string[][] = [];
  for (const hostId of hostIds) {
    const failure = response.failures.find((entry) => entry.hostId === hostId);
    if (failure) {
      rows.push([
        hostLabel(hostId),
        "-",
        failure.code === "host_offline" ? "offline" : failure.message,
        "-",
        "-",
      ]);
    }
    for (const worktree of response.worktrees) {
      if (worktree.hostId !== hostId) {
        continue;
      }
      const label = formatWorktreeLabel(worktree);
      rows.push([
        multiMachine ? `${hostLabel(hostId)} · ${label}` : label,
        worktree.path,
        formatWorktreeState(worktree),
        worktree.ownership,
        worktree.environmentId ?? "-",
      ]);
    }
  }

  printBorderlessTable(
    {
      head: ["Worktree", "Path", "State", "Ownership", "Environment"],
      colWidths: columnWidths(rows, [8, 4, 5, 9, 11]),
      trimTrailingWhitespace: true,
    },
    rows,
  );
}
