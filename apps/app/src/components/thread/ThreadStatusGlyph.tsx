import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  getThreadListIndicatorLabel,
  type ThreadListIndicatorKind,
} from "@bb/client-core";
import type {
  PluginComposerThreadRowStatus,
  PluginThreadStatusGlyphProps,
} from "@get-bb/plugin-sdk";
import { pluginIconName } from "@/components/plugin/PluginIcon";
import {
  SIDEBAR_STATUS_ICON_CLASS,
  SIDEBAR_SUCCESS_STATUS_COLOR_CLASS,
  SIDEBAR_SUCCESS_STATUS_DOT_CLASS,
  SIDEBAR_WORKING_STATUS_COLOR_CLASS,
} from "@bb/shared-ui/sidebar-row-classes";

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
  status: PluginComposerThreadRowStatus;
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
  rowStatusIsVisible: boolean;
}

export function resolveThreadStatus(
  indicator: ThreadListIndicatorKind,
  rowStatus: PluginComposerThreadRowStatus | null = null,
  archived = false,
): ThreadStatusResolution {
  const indicatorKind = archived ? "archived" : indicator;
  const rowStatusIsVisible =
    !archived &&
    rowStatus !== null &&
    indicatorKind !== "runtime" &&
    indicatorKind !== "unread-error" &&
    indicatorKind !== "waiting-for-input";

  return {
    accessibleLabel: rowStatusIsVisible
      ? rowStatus.label
      : indicatorKind === "archived"
        ? "Archived thread"
        : getThreadListIndicatorLabel(indicatorKind),
    indicatorKind,
    rowStatusIsVisible,
  };
}

export function ThreadStatusGlyph({
  indicator,
  archived = false,
  rowStatus = null,
  hideIdleDraftLabel = false,
  size = "default",
}: PluginThreadStatusGlyphProps) {
  const iconSizeClass =
    size === "compact" ? "size-3.5" : SIDEBAR_STATUS_ICON_CLASS;
  const { indicatorKind: kind, rowStatusIsVisible } = resolveThreadStatus(
    indicator,
    rowStatus,
    archived,
  );

  if (rowStatusIsVisible && rowStatus) {
    return <PluginThreadRowStatusIndicator status={rowStatus} size={size} />;
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
