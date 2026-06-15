import type {
  TimelineActivityIntent,
  TimelineFileChange,
  TimelineRow,
} from "@bb/server-contract";
import { assertNever } from "./assert-never.js";
import { getFileChangeDiffStats } from "./file-change-summary.js";
import type {
  EventProjection,
  EventProjectionFileEditChange,
  EventProjectionMessage,
  EventProjectionToolParsedIntent,
} from "./event-projection-types.js";

export type TimelineDelegationChildRowsMode = "all" | "pending-only";

export type TimelineWorkProjectionMessage = Extract<
  EventProjectionMessage,
  {
    kind:
      | "command"
      | "delegation"
      | "file-edit"
      | "image-view"
      | "permission-grant-lifecycle"
      | "tool-call"
      | "user-question-lifecycle"
      | "web-fetch"
      | "web-search"
      | "workflow";
  }
>;

export type TimelineCommandProjectionMessage = Extract<
  TimelineWorkProjectionMessage,
  { kind: "command" }
>;
export type TimelineToolCallProjectionMessage = Extract<
  TimelineWorkProjectionMessage,
  { kind: "tool-call" }
>;
export type TimelineFileEditProjectionMessage = Extract<
  TimelineWorkProjectionMessage,
  { kind: "file-edit" }
>;
export type TimelineWebSearchProjectionMessage = Extract<
  TimelineWorkProjectionMessage,
  { kind: "web-search" }
>;
export type TimelineWebFetchProjectionMessage = Extract<
  TimelineWorkProjectionMessage,
  { kind: "web-fetch" }
>;
export type TimelineImageViewProjectionMessage = Extract<
  TimelineWorkProjectionMessage,
  { kind: "image-view" }
>;
export type TimelineDelegationProjectionMessage = Extract<
  TimelineWorkProjectionMessage,
  { kind: "delegation" }
>;
export type TimelineWorkflowProjectionMessage = Extract<
  TimelineWorkProjectionMessage,
  { kind: "workflow" }
>;
export type TimelinePermissionGrantProjectionMessage = Extract<
  TimelineWorkProjectionMessage,
  { kind: "permission-grant-lifecycle" }
>;
export type TimelineUserQuestionProjectionMessage = Extract<
  TimelineWorkProjectionMessage,
  { kind: "user-question-lifecycle" }
>;

export interface TimelineWorkRowBuildOptions {
  delegationChildRows: TimelineDelegationChildRowsMode;
  rowIdPrefix: string;
  workspaceRoot: string | null;
}

export interface BuildDelegationChildRowsArgs {
  projection: EventProjection;
  rowIdPrefix: string;
  workspaceRoot: string | null;
}

export type BuildDelegationChildRows = (
  args: BuildDelegationChildRowsArgs,
) => TimelineRow[];

export function convertActivityIntent(
  intent: EventProjectionToolParsedIntent,
): TimelineActivityIntent {
  switch (intent.type) {
    case "read":
      return {
        type: "read",
        command: intent.cmd,
        name: intent.name,
        path: intent.path,
      };
    case "list_files":
      return {
        type: "list_files",
        command: intent.cmd,
        path: intent.path,
      };
    case "search":
      return {
        type: "search",
        command: intent.cmd,
        query: intent.query,
        path: intent.path,
      };
    case "unknown":
      return {
        type: "unknown",
        command: intent.cmd,
      };
    default:
      return assertNever(intent);
  }
}

/**
 * File-edit tool calls persist the path the provider reported, which is
 * absolute (e.g. `/Users/.../worktrees/env_x/bb/src/app.ts`). The timeline
 * contract promises a workspace-relative path so it matches the repo-relative
 * names produced by `git diff` in the diff panel, lets `open-file-diff` focus
 * the right card, and keeps the inline diff header readable. Relativize once
 * here at the projection boundary so every downstream consumer sees one
 * canonical workspace-relative path.
 */
function relativizeWorkspacePath(
  path: string,
  workspaceRoot: string | null,
): string {
  if (!workspaceRoot) return path;
  const normalizedRoot = workspaceRoot.replace(/\/+$/u, "");
  if (normalizedRoot.length === 0) return path;
  if (path.startsWith(`${normalizedRoot}/`)) {
    return path.slice(normalizedRoot.length + 1);
  }
  return path;
}

export function toTimelineFileChange(
  change: EventProjectionFileEditChange,
  workspaceRoot: string | null,
): TimelineFileChange {
  return {
    path: relativizeWorkspacePath(change.path, workspaceRoot),
    kind: change.kind ?? null,
    movePath:
      change.movePath == null
        ? null
        : relativizeWorkspacePath(change.movePath, workspaceRoot),
    diff: change.diff ?? null,
    diffStats: getFileChangeDiffStats(change),
  };
}
