import { isRunningThreadRuntimeDisplayStatus } from "@bb/client-core";
import type {
  Environment,
  Host,
  ThreadRuntimeDisplayStatus,
  ThreadStatus,
} from "@bb/domain";
import { assertNever } from "@bb/thread-view";

/**
 * Pure header facts for the thread detail screen: the status pill (from the
 * client-core runtime display status, with the thread's own status and
 * pending input layered on) and the one-line environment summary.
 */

export type ThreadStatusPillTone =
  | "working"
  | "attention"
  | "error"
  | "idle"
  | "muted";

export interface ThreadStatusPill {
  label: string;
  tone: ThreadStatusPillTone;
  /** Shows a spinner glyph instead of a static one. */
  spinning: boolean;
}

export function describeThreadStatusPill({
  runtimeDisplayStatus,
  threadStatus,
  hasPendingInteraction,
  archived,
}: {
  runtimeDisplayStatus: ThreadRuntimeDisplayStatus;
  threadStatus: ThreadStatus;
  hasPendingInteraction: boolean;
  archived: boolean;
}): ThreadStatusPill {
  if (hasPendingInteraction) {
    return { label: "Needs input", tone: "attention", spinning: false };
  }
  if (threadStatus === "stopping") {
    return { label: "Stopping", tone: "working", spinning: true };
  }
  switch (runtimeDisplayStatus) {
    case "active":
      return { label: "Working", tone: "working", spinning: true };
    case "provisioning":
      return { label: "Provisioning", tone: "working", spinning: true };
    case "starting":
      return { label: "Starting", tone: "working", spinning: true };
    case "stopping":
      return { label: "Stopping", tone: "working", spinning: true };
    case "host-reconnecting":
      return { label: "Reconnecting", tone: "working", spinning: true };
    case "waiting-for-host":
      return { label: "Waiting for host", tone: "muted", spinning: false };
    case "error":
      return { label: "Error", tone: "error", spinning: false };
    case "idle":
      if (threadStatus === "error") {
        return { label: "Error", tone: "error", spinning: false };
      }
      return archived
        ? { label: "Archived", tone: "muted", spinning: false }
        : { label: "Idle", tone: "idle", spinning: false };
    default:
      return assertNever(runtimeDisplayStatus);
  }
}

export function isThreadRuntimeBusy(
  runtimeDisplayStatus: ThreadRuntimeDisplayStatus,
): boolean {
  return isRunningThreadRuntimeDisplayStatus(runtimeDisplayStatus);
}

function lastPathSegment(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

export interface ThreadEnvironmentSummaryArgs {
  environment: Pick<
    Environment,
    "name" | "branchName" | "path" | "managed" | "status"
  > | null;
  host: Pick<Host, "name"> | null;
  projectName: string | null;
}

/**
 * "Project · host · worktree · branch" as the web thread header's environment
 * line reads it. Empty parts are skipped; an environment that is gone reads
 * as such.
 */
export function describeThreadEnvironment({
  environment,
  host,
  projectName,
}: ThreadEnvironmentSummaryArgs): string[] {
  const parts: string[] = [];
  if (projectName) parts.push(projectName);
  if (host?.name) parts.push(host.name);
  if (environment) {
    const label =
      environment.name ??
      (environment.path ? lastPathSegment(environment.path) : null);
    if (label) parts.push(label);
    if (environment.branchName && environment.branchName !== label) {
      parts.push(environment.branchName);
    }
    if (
      environment.status === "destroyed" ||
      environment.status === "destroying"
    ) {
      parts.push("environment gone");
    }
  }
  return parts;
}
