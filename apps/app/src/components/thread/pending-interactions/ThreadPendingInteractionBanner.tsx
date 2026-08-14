import { useMemo, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import {
  assertNever,
  buildPendingInteractionApprovalResolution,
  formatPendingInteractionSubjectDetailLines,
} from "@bb/core-ui";
import { extractShellCommandFromString } from "@bb/thread-view";
import {
  isApprovalPendingInteractionPayload,
  isUserQuestionPendingInteractionPayload,
  type ApprovalPendingInteractionPayload,
  type PendingInteraction,
  type PendingInteractionApprovalDecision,
  type PendingInteractionApprovalSubject,
  type PendingInteractionResolution,
  type UserQuestionPendingInteractionPayload,
} from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { ExpandableLine } from "@/components/ui/expandable-line.js";
import { Icon } from "@bb/shared-ui/icon";
import { MarkdownPreview } from "@/components/ui/markdown-preview.js";
import { getDetailScrollMaxHeightClass } from "@/components/ui/detail-scroll-size.js";
import { UserQuestionAnswerForm } from "@/components/thread/user-questions/UserQuestionInteractionContent.js";
import { useResolveThreadPendingInteraction } from "@/hooks/mutations/thread-interaction-mutations";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { cn } from "@bb/shared-ui/lib/utils";

interface ThreadPendingInteractionSourceThread {
  href: string;
  title: string;
}

interface ThreadPendingInteractionBannerProps {
  interaction: PendingInteraction;
  sourceThread?: ThreadPendingInteractionSourceThread;
  threadId: string;
}

interface ApprovalPendingInteractionBannerProps {
  interaction: PendingInteraction;
  payload: ApprovalPendingInteractionPayload;
  sourceThread?: ThreadPendingInteractionSourceThread;
  threadId: string;
}

interface UserQuestionPendingInteractionBannerProps {
  interaction: PendingInteraction;
  payload: UserQuestionPendingInteractionPayload;
  sourceThread?: ThreadPendingInteractionSourceThread;
  threadId: string;
}

interface BannerShellProps {
  /** Heading line. Omitted when the body supplies its own (e.g. the question form). */
  title?: string;
  errorMessage?: string | null;
  footer?: ReactNode;
  children?: ReactNode;
  sourceThread?: ThreadPendingInteractionSourceThread;
}

interface ApprovalSubject {
  title: string;
  body: ReactNode;
}

interface BuildApprovalSubjectInput {
  interaction: PendingInteraction;
  payload: ApprovalPendingInteractionPayload;
}

export function ThreadPendingInteractionBanner({
  interaction,
  sourceThread,
  threadId,
}: ThreadPendingInteractionBannerProps) {
  if (interaction.payload.kind === "plugin") {
    return null;
  }
  if (isUserQuestionPendingInteractionPayload(interaction.payload)) {
    return (
      <ThreadUserQuestionPendingInteractionBanner
        interaction={interaction}
        payload={interaction.payload}
        sourceThread={sourceThread}
        threadId={threadId}
      />
    );
  }

  if (!isApprovalPendingInteractionPayload(interaction.payload)) {
    return assertNever(interaction.payload);
  }

  return (
    <ApprovalPendingInteractionBanner
      interaction={interaction}
      payload={interaction.payload}
      sourceThread={sourceThread}
      threadId={threadId}
    />
  );
}

function BannerShell({
  title,
  errorMessage,
  footer,
  children,
  sourceThread,
}: BannerShellProps) {
  return (
    <div className="mb-2 min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-surface-recessed px-4 py-3 text-xs text-muted-foreground">
      {sourceThread ? (
        <NavLink
          to={sourceThread.href}
          className="mb-1 block text-xs text-muted-foreground no-underline hover:underline"
        >
          From child thread: {sourceThread.title}
        </NavLink>
      ) : null}
      {title ? (
        <h3 className="min-w-0 text-sm font-semibold text-foreground">
          <ExpandableLine fullText={title} collapsedClassName="line-clamp-2">
            {title}
          </ExpandableLine>
        </h3>
      ) : null}
      {children ? (
        <div className={title ? "mt-3" : undefined}>{children}</div>
      ) : null}
      {footer ? (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {footer}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="mt-2 rounded-md border border-surface-destructive-border bg-surface-destructive px-2 py-1 text-xs text-destructive-text">
          {errorMessage}
        </div>
      ) : null}
    </div>
  );
}

function ApprovalPendingInteractionBanner({
  interaction,
  payload,
  sourceThread,
  threadId,
}: ApprovalPendingInteractionBannerProps) {
  const resolvePendingInteraction = useResolveThreadPendingInteraction();
  const isResolving = interaction.status === "resolving";
  const submittedDecision = approvalResolutionDecision(interaction.resolution);
  const subject = useMemo(
    () => buildApprovalSubject({ interaction, payload }),
    [interaction, payload],
  );
  const mutationErrorMessage = resolvePendingInteraction.error
    ? getMutationErrorMessage({
        error: resolvePendingInteraction.error,
        fallbackMessage: "Failed to resolve pending interaction",
        lifecycleOperation: "resolve_interaction",
      })
    : null;
  const submitDisabled = resolvePendingInteraction.isPending || isResolving;

  const submitDecision = (
    decision: PendingInteractionApprovalDecision,
  ): void => {
    const resolution = buildPendingInteractionApprovalResolution(
      interaction,
      decision,
    );
    void resolvePendingInteraction
      .mutateAsync({
        threadId,
        interactionId: interaction.id,
        resolution,
      })
      .catch(() => {});
  };

  return (
    <BannerShell
      title={subject.title}
      errorMessage={mutationErrorMessage}
      sourceThread={sourceThread}
      footer={payload.availableDecisions.map((decision) => (
        <ApprovalDecisionButton
          key={decision}
          decision={decision}
          disabled={submitDisabled}
          isLoading={isResolving && submittedDecision === decision}
          onClick={() => submitDecision(decision)}
          subjectKind={payload.subject.kind}
        />
      ))}
    >
      {subject.body}
    </BannerShell>
  );
}

function ThreadUserQuestionPendingInteractionBanner({
  interaction,
  payload,
  sourceThread,
  threadId,
}: UserQuestionPendingInteractionBannerProps) {
  const isResolving = interaction.status === "resolving";

  // No shell title: the form supplies its own heading (the current question
  // prompt) plus the question tab strip.
  return (
    <BannerShell sourceThread={sourceThread}>
      <UserQuestionAnswerForm
        interactionId={interaction.id}
        isResolving={isResolving}
        questions={payload.questions}
        threadId={threadId}
      />
    </BannerShell>
  );
}

interface ApprovalDecisionButtonProps {
  decision: PendingInteractionApprovalDecision;
  disabled: boolean;
  isLoading: boolean;
  onClick: () => void;
  subjectKind: PendingInteractionApprovalSubject["kind"];
}

function ApprovalDecisionButton({
  decision,
  disabled,
  isLoading,
  onClick,
  subjectKind,
}: ApprovalDecisionButtonProps) {
  return (
    <Button
      type="button"
      size="sm"
      variant={approvalDecisionButtonVariant(decision)}
      disabled={disabled}
      onClick={onClick}
    >
      {isLoading ? (
        <Icon name="Spinner" className="size-3 animate-spin" />
      ) : null}
      {labelForApprovalDecision(decision, subjectKind)}
    </Button>
  );
}

function approvalDecisionButtonVariant(
  decision: PendingInteractionApprovalDecision,
): "default" | "outline" | "ghost" {
  // Three-level hierarchy: filled primary for the safest yes, outline for the
  // longer-lived yes, ghost for the dismissive no. Keeps Deny visible without
  // letting it compete with the affirmative actions.
  switch (decision) {
    case "allow_once":
      return "default";
    case "allow_for_session":
      return "outline";
    case "deny":
      return "ghost";
  }
}

function approvalResolutionDecision(
  resolution: PendingInteractionResolution | null,
): PendingInteractionApprovalDecision | null {
  if (!resolution || "kind" in resolution) {
    return null;
  }
  return resolution.decision;
}

function ApprovalDetailList({
  className,
  lines,
}: {
  className: string;
  lines: readonly string[];
}) {
  return (
    <ul
      className={cn(
        "min-w-0 max-w-full text-xs text-muted-foreground [overflow-wrap:anywhere]",
        className,
      )}
    >
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function buildApprovalSubject({
  interaction,
  payload,
}: BuildApprovalSubjectInput): ApprovalSubject {
  switch (payload.subject.kind) {
    case "command": {
      const rawCommand = payload.subject.command;
      const command = rawCommand
        ? (extractShellCommandFromString(rawCommand) ?? rawCommand)
        : null;
      // The cwd value is a self-describing absolute path, so the "Cwd: "
      // prefix from the shared formatter reads as redundant in the banner.
      // Strip the label here; other prefixed lines (Action:, Session grant:)
      // need their labels to be readable.
      const detailLines = formatPendingInteractionSubjectDetailLines(
        interaction,
      )
        .filter((line) => !line.startsWith("Command: "))
        .map((line) =>
          line.startsWith("Cwd: ") ? line.slice("Cwd: ".length) : line,
        );
      return {
        title: payload.reason ?? "Do you want to run this command?",
        body: command ? (
          <div className="min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-card">
            <pre
              className={cn(
                getDetailScrollMaxHeightClass("base"),
                "max-w-full overflow-auto whitespace-pre px-3 py-2 font-mono text-xs leading-relaxed text-foreground",
              )}
            >
              $ {command}
            </pre>
            {detailLines.length > 0 ? (
              <ApprovalDetailList
                className="border-t border-border px-3 py-2"
                lines={detailLines}
              />
            ) : null}
          </div>
        ) : null,
      };
    }
    case "file_change": {
      const detailLines =
        formatPendingInteractionSubjectDetailLines(interaction);
      return {
        title: payload.reason ?? "Do you want to make these changes?",
        body:
          detailLines.length > 0 ? (
            <ApprovalDetailList
              className="rounded-lg border border-border bg-card px-3 py-2"
              lines={detailLines}
            />
          ) : null,
      };
    }
    case "permission_grant": {
      const detailLines =
        formatPendingInteractionSubjectDetailLines(interaction);
      return {
        title: payload.reason ?? "Do you want to grant this permission?",
        body:
          detailLines.length > 0 ? (
            <ApprovalDetailList
              className="rounded-lg border border-border bg-card px-3 py-2"
              lines={detailLines}
            />
          ) : null,
      };
    }
    case "plan": {
      const { plan, planFilePath } = payload.subject;
      return {
        title: payload.reason ?? "Ready to code?",
        body: (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div
              className={cn(
                getDetailScrollMaxHeightClass("base"),
                "overflow-auto px-3 py-2",
              )}
            >
              <MarkdownPreview content={plan} className="text-xs" />
            </div>
            {planFilePath ? (
              <p className="truncate border-t border-border px-3 py-2 font-mono text-xs text-muted-foreground">
                {planFilePath}
              </p>
            ) : null}
          </div>
        ),
      };
    }
    default:
      return assertNever(payload.subject);
  }
}

function labelForApprovalDecision(
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
  }
}
