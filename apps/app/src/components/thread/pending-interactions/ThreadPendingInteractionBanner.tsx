import { useMemo, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import {
  assertNever,
  buildPendingInteractionApprovalResolution,
  describePendingInteractionToolUse,
  formatPendingInteractionSubjectDetailLines,
  type PendingInteractionToolUseAsk,
} from "@bb/core-ui";
import { extractShellCommandFromString } from "@bb/thread-view";
import {
  isPluginPendingInteraction,
  type ApprovalPendingInteractionPayload,
  type PendingInteraction,
  type PendingInteractionApprovalDecision,
  type PendingInteractionApprovalSubject,
  type PendingInteractionResolution,
  type PendingInteractionUserQuestionQuestion,
} from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { ExpandableLine } from "@/components/ui/expandable-line.js";
import { Icon } from "@bb/shared-ui/icon";
import { MarkdownPreview } from "@/components/ui/markdown-preview.js";
import { getDetailScrollMaxHeightClass } from "@/components/ui/detail-scroll-size.js";
import { UserQuestionAnswerForm } from "@/components/thread/user-questions/UserQuestionInteractionContent.js";
import { useResolveThreadPendingInteraction } from "@/hooks/mutations/thread-interaction-mutations";
import { PluginPendingInteractionComposer } from "@/components/plugin/PluginPendingInteractionComposer";
import {
  classifyInteractionRequest,
  type InteractionRequestView,
} from "./interaction-request";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import {
  presentationIconName,
  presentationTintStyle,
} from "@/components/thread/timeline/presentation-display";
import { PluginCompactIconMask } from "@/components/plugin/PluginIcon";
import { usePluginIconUrl } from "@/lib/plugin-logos";
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

type ApprovalBannerSubject = Extract<
  InteractionRequestView,
  { family: "approval" }
>["subject"];

interface ApprovalPendingInteractionBannerProps {
  interaction: PendingInteraction;
  payload: ApprovalPendingInteractionPayload;
  subject: ApprovalBannerSubject;
  sourceThread?: ThreadPendingInteractionSourceThread;
  threadId: string;
}

interface UserQuestionPendingInteractionBannerProps {
  interaction: PendingInteraction;
  questions: readonly PendingInteractionUserQuestionQuestion[];
  sourceThread?: ThreadPendingInteractionSourceThread;
  threadId: string;
}

interface BannerShellProps {
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
  subject: ApprovalBannerSubject;
}

export function ThreadPendingInteractionBanner({
  interaction,
  sourceThread,
  threadId,
}: ThreadPendingInteractionBannerProps) {
  const request = classifyInteractionRequest(interaction);
  if (request.family === "approval") {
    return (
      <ApprovalPendingInteractionBanner
        interaction={interaction}
        payload={request.payload}
        subject={request.subject}
        sourceThread={sourceThread}
        threadId={threadId}
      />
    );
  }
  switch (request.kind) {
    case "user_question":
      return (
        <ThreadUserQuestionPendingInteractionBanner
          interaction={interaction}
          questions={request.questions}
          sourceThread={sourceThread}
          threadId={threadId}
        />
      );
    case "plan_review":
      return (
        <PlanReviewRequestBanner
          interaction={interaction}
          request={request}
          sourceThread={sourceThread}
          threadId={threadId}
        />
      );
    default:
      return (
        <div
          data-testid="plugin-request-banner"
          data-request-kind={request.kind}
        >
          {sourceThread ? (
            <NavLink
              to={sourceThread.href}
              className="mb-1 block text-xs text-muted-foreground no-underline hover:underline"
            >
              From child thread: {sourceThread.title}
            </NavLink>
          ) : null}
          <PluginPendingInteractionComposer
            interaction={interaction}
            request={{
              pluginId: request.pluginId,
              rendererId: request.name,
              title: request.title,
              data: request.data,
            }}
            dismissal={
              isPluginPendingInteraction(interaction) ? "cancel" : "stop-turn"
            }
          />
        </div>
      );
  }
}

interface PlanReviewRequestBannerProps {
  interaction: PendingInteraction;
  request: Extract<InteractionRequestView, { kind: "plan_review" }>;
  sourceThread?: ThreadPendingInteractionSourceThread;
  threadId: string;
}

function PlanReviewRequestBanner({
  interaction,
  request,
  sourceThread,
  threadId,
}: PlanReviewRequestBannerProps) {
  const resolvePendingInteraction = useResolveThreadPendingInteraction();
  const isResolving = interaction.status === "resolving";
  const submittedDecision = approvalResolutionDecision(interaction.resolution);
  const mutationErrorMessage = resolvePendingInteraction.error
    ? getMutationErrorMessage({
        error: resolvePendingInteraction.error,
        fallbackMessage: "Failed to resolve plan review",
        lifecycleOperation: "resolve_interaction",
      })
    : null;
  const submitDisabled = resolvePendingInteraction.isPending || isResolving;
  const { approval } = request;
  const submitDecision = (
    decision: PendingInteractionApprovalDecision,
  ): void => {
    const resolution = buildPendingInteractionApprovalResolution(
      interaction,
      decision,
    );
    void resolvePendingInteraction
      .mutateAsync({ threadId, interactionId: interaction.id, resolution })
      .catch(() => {});
  };
  const { plan, planFilePath } = request.review;
  return (
    <BannerShell
      title={approval.reason ?? "Ready to code?"}
      errorMessage={mutationErrorMessage}
      sourceThread={sourceThread}
      footer={approval.availableDecisions.map((decision) => (
        <ApprovalDecisionButton
          key={decision}
          decision={decision}
          disabled={submitDisabled}
          isLoading={isResolving && submittedDecision === decision}
          onClick={() => submitDecision(decision)}
          subjectKind="plan"
        />
      ))}
    >
      <div
        className="overflow-hidden rounded-lg border border-border bg-card"
        data-testid="plan-review-request"
      >
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
    </BannerShell>
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
  subject,
  sourceThread,
  threadId,
}: ApprovalPendingInteractionBannerProps) {
  const resolvePendingInteraction = useResolveThreadPendingInteraction();
  const isResolving = interaction.status === "resolving";
  const submittedDecision = approvalResolutionDecision(interaction.resolution);
  const view = useMemo(
    () => buildApprovalSubject({ interaction, payload, subject }),
    [interaction, payload, subject],
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
      title={view.title}
      errorMessage={mutationErrorMessage}
      sourceThread={sourceThread}
      footer={payload.availableDecisions.map((decision) => (
        <ApprovalDecisionButton
          key={decision}
          decision={decision}
          disabled={submitDisabled}
          isLoading={isResolving && submittedDecision === decision}
          onClick={() => submitDecision(decision)}
          subjectKind={subject.kind}
        />
      ))}
    >
      {view.body}
    </BannerShell>
  );
}

function ThreadUserQuestionPendingInteractionBanner({
  interaction,
  questions,
  sourceThread,
  threadId,
}: UserQuestionPendingInteractionBannerProps) {
  const isResolving = interaction.status === "resolving";

  return (
    <BannerShell sourceThread={sourceThread}>
      <UserQuestionAnswerForm
        interactionId={interaction.id}
        isResolving={isResolving}
        questions={questions}
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

function ToolUseAskCard({ ask }: { ask: PendingInteractionToolUseAsk }) {
  const iconUrl = usePluginIconUrl(ask.icon.glyph);
  return (
    <div
      className="min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-card px-3 py-2"
      data-testid="tool-use-ask"
    >
      <div className="flex min-w-0 items-center gap-2 text-xs text-foreground">
        {iconUrl !== undefined ? (
          <PluginCompactIconMask
            url={iconUrl}
            className="size-3.5"
            style={presentationTintStyle(ask)}
          />
        ) : (
          <Icon
            name={presentationIconName(ask) ?? "Terminal"}
            className="size-3.5 shrink-0"
            style={presentationTintStyle(ask)}
          />
        )}
        <span className="min-w-0 truncate font-mono">
          {ask.headline ?? ask.tool}
        </span>
      </div>
      {ask.headline !== null ? (
        <p className="mt-1 text-xs text-muted-foreground">Tool: {ask.tool}</p>
      ) : null}
      {ask.detail !== null ? (
        <MarkdownPreview
          content={ask.detail}
          className="mt-1 text-xs text-muted-foreground"
          imagePolicy="alt-text"
        />
      ) : null}
    </div>
  );
}

function buildApprovalSubject({
  interaction,
  payload,
  subject,
}: BuildApprovalSubjectInput): ApprovalSubject {
  switch (subject.kind) {
    case "command": {
      const rawCommand = subject.command;
      const command = rawCommand
        ? (extractShellCommandFromString(rawCommand) ?? rawCommand)
        : null;
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
    case "tool_use": {
      const ask = describePendingInteractionToolUse({ ...payload, subject });
      return {
        title: ask.title,
        body: <ToolUseAskCard ask={ask} />,
      };
    }
    default:
      return assertNever(subject);
  }
}

function labelForApprovalDecision(
  decision: PendingInteractionApprovalDecision,
  subjectKind: PendingInteractionApprovalSubject["kind"],
): string {
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
