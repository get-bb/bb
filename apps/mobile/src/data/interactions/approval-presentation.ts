import {
  assertNever,
  formatPendingInteractionSubjectDetailLines,
} from "@bb/core-ui";
import type {
  ApprovalPendingInteractionPayload,
  PendingInteraction,
  PendingInteractionApprovalDecision,
  PendingInteractionApprovalSubject,
  PendingInteractionResolution,
} from "@bb/domain";
import { extractShellCommandFromString } from "@bb/thread-view";

/**
 * Pure presentation model of an approval pending interaction (ports the
 * subject/label logic of
 * apps/app/src/components/thread/pending-interactions/ThreadPendingInteractionBanner.tsx).
 * The decision → resolution mapping itself is `@bb/core-ui`'s
 * `buildPendingInteractionApprovalResolution`.
 */

export interface ApprovalSubjectPresentation {
  title: string;
  /** Shell command to show in a mono block (command subjects). */
  command: string | null;
  /** Plan markdown (plan subjects). */
  plan: string | null;
  /** Secondary lines (cwd, actions, session grant, write root, permissions, plan file). */
  detailLines: string[];
}

export function describeApprovalSubject(
  interaction: PendingInteraction,
  payload: ApprovalPendingInteractionPayload,
): ApprovalSubjectPresentation {
  const subject = payload.subject;
  switch (subject.kind) {
    case "command": {
      const rawCommand = subject.command;
      const command = rawCommand
        ? (extractShellCommandFromString(rawCommand) ?? rawCommand)
        : null;
      // The cwd value is a self-describing absolute path, so the "Cwd: "
      // prefix reads as redundant next to the command block; other prefixed
      // lines (Action:, Session grant:) need their labels.
      const detailLines = formatPendingInteractionSubjectDetailLines(
        interaction,
      )
        .filter((line) => !line.startsWith("Command: "))
        .map((line) =>
          line.startsWith("Cwd: ") ? line.slice("Cwd: ".length) : line,
        );
      return {
        title: payload.reason ?? "Do you want to run this command?",
        command,
        plan: null,
        detailLines,
      };
    }
    case "file_change":
      return {
        title: payload.reason ?? "Do you want to make these changes?",
        command: null,
        plan: null,
        detailLines: formatPendingInteractionSubjectDetailLines(interaction),
      };
    case "permission_grant":
      return {
        title: payload.reason ?? "Do you want to grant this permission?",
        command: null,
        plan: null,
        detailLines: formatPendingInteractionSubjectDetailLines(interaction),
      };
    case "plan":
      return {
        title: payload.reason ?? "Ready to code?",
        command: null,
        plan: subject.plan,
        detailLines: subject.planFilePath ? [subject.planFilePath] : [],
      };
    // The ACP bridge raises this for generic tool permissions; the subject's
    // presentation is the banner's base until WS5 designs the tool-use surface.
    case "tool_use":
      return {
        title: payload.reason ?? subject.presentation.label.pending,
        command: null,
        plan: null,
        detailLines: formatPendingInteractionSubjectDetailLines(interaction),
      };
    default:
      return assertNever(subject);
  }
}

export function labelForApprovalDecision(
  decision: PendingInteractionApprovalDecision,
  subjectKind: PendingInteractionApprovalSubject["kind"],
): string {
  // A plan verdict decides whether the work starts, not what the agent may
  // touch, so the permission vocabulary would misdescribe both buttons.
  if (subjectKind === "plan") {
    return decision === "deny" ? "Keep planning" : "Approve plan";
  }
  switch (decision) {
    case "allow_once":
      return "Allow once";
    case "allow_for_session":
      return "Allow for session";
    case "deny":
      return "Deny";
    default:
      return assertNever(decision);
  }
}

export type ApprovalDecisionButtonVariant = "default" | "outline" | "ghost";

/**
 * Three-level hierarchy: filled primary for the safest yes, outline for the
 * longer-lived yes, ghost for the dismissive no. Keeps Deny visible without
 * letting it compete with the affirmative actions.
 */
export function approvalDecisionButtonVariant(
  decision: PendingInteractionApprovalDecision,
): ApprovalDecisionButtonVariant {
  switch (decision) {
    case "allow_once":
      return "default";
    case "allow_for_session":
      return "outline";
    case "deny":
      return "ghost";
    default:
      return assertNever(decision);
  }
}

/** The decision already submitted (server `resolving`), if any. */
export function approvalResolutionDecision(
  resolution: PendingInteractionResolution | null,
): PendingInteractionApprovalDecision | null {
  if (!resolution || "kind" in resolution) return null;
  return resolution.decision;
}
