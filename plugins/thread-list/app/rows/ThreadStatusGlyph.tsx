import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  getThreadListIndicatorLabel,
  resolveThreadListIndicator,
  type ThreadListIndicatorKind,
  type ThreadListIndicatorState,
} from "@bb/client-core";
import type { PluginSidebarThreadRowStatus } from "@get-bb/plugin-sdk/app";
import {
  SIDEBAR_STATUS_ICON_CLASS,
  SIDEBAR_SUCCESS_STATUS_COLOR_CLASS,
  SIDEBAR_SUCCESS_STATUS_DOT_CLASS,
  SIDEBAR_WORKING_STATUS_COLOR_CLASS,
} from "./sidebarRowClasses.js";

const WORKING_ACTIVITY_ICONS = {
  workflow: "Workflow",
  "background-agent": "UserRoundPlus",
  "background-command": "Terminal",
  "plan-mode": "ListTodo",
  goal: "Target",
} satisfies Partial<Record<ThreadListIndicatorKind, IconName>>;

const WAITING_ICONS = {
  "waiting-for-input": "CircleQuestion",
  "queued-waiting": "Clock",
} satisfies Partial<Record<ThreadListIndicatorKind, IconName>>;

function pluginIconName(icon: string | null): IconName {
  return icon ?? "Zap";
}

function ThreadDraftIndicator({
  hideIdleLabel = false,
  isWorking,
  size,
}: {
  hideIdleLabel?: boolean;
  isWorking: boolean;
  size: "default" | "compact";
}) {
  const label = getThreadListIndicatorLabel(
    isWorking ? "working-draft" : "draft",
  );
  return (
    <Icon
      name="Edit"
      className={cn(
        "pointer-events-none shrink-0",
        size === "compact" ? "size-3.5" : SIDEBAR_STATUS_ICON_CLASS,
        isWorking
          ? ["animate-shine-icon", SIDEBAR_WORKING_STATUS_COLOR_CLASS]
          : "text-muted-foreground",
      )}
      {...(!isWorking && hideIdleLabel
        ? { "aria-hidden": true }
        : { "aria-label": label ?? undefined })}
    />
  );
}

function PluginThreadRowStatusIndicator({
  status,
  size,
}: {
  status: PluginSidebarThreadRowStatus;
  size: "default" | "compact";
}) {
  const iconSizeClass =
    size === "compact" ? "size-3.5" : SIDEBAR_STATUS_ICON_CLASS;
  if (status.tone === "running") {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center motion-safe:animate-pulse",
          iconSizeClass,
          "text-success",
        )}
      >
        <Icon
          name={pluginIconName(status.icon)}
          className={cn(
            "pointer-events-none shrink-0 animate-shine-icon",
            iconSizeClass,
          )}
          aria-label={status.label}
        />
      </span>
    );
  }

  return (
    <Icon
      name={pluginIconName(status.icon)}
      className={cn(
        "pointer-events-none shrink-0",
        iconSizeClass,
        status.tone === "success"
          ? SIDEBAR_SUCCESS_STATUS_COLOR_CLASS
          : status.tone === "error"
            ? "text-destructive"
            : "text-muted-foreground",
      )}
      aria-label={status.label}
    />
  );
}

interface ThreadStatusResolution {
  accessibleLabel: string | null;
  indicatorKind: ThreadListIndicatorKind | "archived";
  pluginStatusIsVisible: boolean;
}

export function resolveThreadStatus(
  statusProps: ThreadListIndicatorState,
  pluginStatus: PluginSidebarThreadRowStatus | null = null,
  archived = false,
): ThreadStatusResolution {
  const indicatorKind = archived
    ? "archived"
    : resolveThreadListIndicator(statusProps);
  const pluginStatusIsVisible =
    !archived &&
    pluginStatus !== null &&
    indicatorKind !== "runtime" &&
    indicatorKind !== "unread-error" &&
    indicatorKind !== "waiting-for-input";

  return {
    accessibleLabel: pluginStatusIsVisible
      ? pluginStatus.label
      : indicatorKind === "archived"
        ? "Archived thread"
        : getThreadListIndicatorLabel(indicatorKind),
    indicatorKind,
    pluginStatusIsVisible,
  };
}

export interface ThreadStatusGlyphProps extends ThreadListIndicatorState {
  archived?: boolean;
  pluginStatus?: PluginSidebarThreadRowStatus | null;
  hideIdleDraftLabel?: boolean;
  size?: "default" | "compact";
}

export function ThreadStatusGlyph({
  archived = false,
  pluginStatus = null,
  hasPendingInteraction,
  hasUnsubmittedDraft,
  hasUnreadError,
  hasUnreadSuccess,
  hideIdleDraftLabel = false,
  isBackgroundAgentActive,
  isBackgroundCommandActive,
  isGoalActive,
  isPlanModeActive,
  isRuntimeActive,
  isWorkflowActive,
  queuedWork,
  size = "default",
}: ThreadStatusGlyphProps) {
  const iconSizeClass =
    size === "compact" ? "size-3.5" : SIDEBAR_STATUS_ICON_CLASS;
  const { indicatorKind: kind, pluginStatusIsVisible } = resolveThreadStatus(
    {
      hasPendingInteraction,
      hasUnsubmittedDraft,
      hasUnreadError,
      hasUnreadSuccess,
      isBackgroundAgentActive,
      isBackgroundCommandActive,
      isGoalActive,
      isPlanModeActive,
      isRuntimeActive,
      isWorkflowActive,
      queuedWork,
    },
    pluginStatus,
    archived,
  );

  if (pluginStatusIsVisible && pluginStatus) {
    return <PluginThreadRowStatusIndicator status={pluginStatus} size={size} />;
  }

  switch (kind) {
    case "archived":
      return (
        <Icon
          name="Archive"
          className={iconSizeClass}
          aria-label="Archived thread"
        />
      );
    case "unread-error":
    case "queued-failed":
      return (
        <Icon
          name="CircleX"
          className={cn("text-destructive", iconSizeClass)}
          aria-label={getThreadListIndicatorLabel(kind) ?? undefined}
        />
      );
    case "waiting-for-input":
    case "queued-waiting":
      return (
        <Icon
          name={WAITING_ICONS[kind]}
          className={cn("text-muted-foreground/75", iconSizeClass)}
          aria-label={getThreadListIndicatorLabel(kind) ?? undefined}
        />
      );
    case "working-draft":
      return <ThreadDraftIndicator isWorking size={size} />;
    case "workflow":
    case "background-agent":
    case "background-command":
    case "plan-mode":
    case "goal":
      return (
        <Icon
          name={WORKING_ACTIVITY_ICONS[kind]}
          className={cn(
            "animate-shine-icon",
            SIDEBAR_WORKING_STATUS_COLOR_CLASS,
            iconSizeClass,
          )}
          aria-label={getThreadListIndicatorLabel(kind) ?? undefined}
        />
      );
    case "runtime":
      return (
        <Icon
          name="Loading"
          className={cn(
            "animate-spin motion-reduce:animate-none",
            SIDEBAR_WORKING_STATUS_COLOR_CLASS,
            iconSizeClass,
          )}
          aria-label={getThreadListIndicatorLabel(kind) ?? undefined}
        />
      );
    case "draft":
      return (
        <ThreadDraftIndicator
          hideIdleLabel={hideIdleDraftLabel}
          isWorking={false}
          size={size}
        />
      );
    case "unread-success":
      return (
        <span
          className={SIDEBAR_SUCCESS_STATUS_DOT_CLASS}
          aria-label={getThreadListIndicatorLabel(kind) ?? undefined}
        />
      );
    case "none":
      return null;
  }
}
