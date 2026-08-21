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
 * pending input layered on) and the one-line environment summary. The header
 * hides "working" tones; the timeline's working indicator already shows them.
 */

type ThreadStatusPillTone =
  | "working"
  | "attention"
  | "error"
  | "idle"
  | "muted";

export interface ThreadStatusPill {
  label: string;
  tone: ThreadStatusPillTone;
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
    return { label: "Needs input", tone: "attention" };
  }
  if (threadStatus === "stopping") {
    return { label: "Stopping", tone: "working" };
  }
  switch (runtimeDisplayStatus) {
    case "active":
      return { label: "Working", tone: "working" };
    case "provisioning":
      return { label: "Provisioning", tone: "working" };
    case "starting":
      return { label: "Starting", tone: "working" };
    case "stopping":
      return { label: "Stopping", tone: "working" };
    case "host-reconnecting":
      return { label: "Reconnecting", tone: "working" };
    case "waiting-for-host":
      return { label: "Waiting for host", tone: "muted" };
    case "error":
      return { label: "Error", tone: "error" };
    case "idle":
      if (threadStatus === "error") {
        return { label: "Error", tone: "error" };
      }
      return archived
        ? { label: "Archived", tone: "muted" }
        : { label: "Idle", tone: "idle" };
    default:
      return assertNever(runtimeDisplayStatus);
  }
}

function lastPathSegment(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

interface ThreadEnvironmentSummaryArgs {
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
