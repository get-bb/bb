import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, UIEvent } from "react";
import type {
  AutomationExecution,
  AutomationResponse,
  AutomationRunResponse,
  AutomationRunStatus,
} from "./src/rpc-types";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import {
  ResourceActionButton,
  ResourceActivitySection,
  ResourceDefinitionSection,
  ResourceDetailCollection,
  ResourceDetailPage,
  ResourceDetailPanel,
  ResourcePromptPreview,
  ResourceDetailStack,
  ResourceMeta,
  ResourceOverflowMenu,
  useResourceRouteLabel,
} from "@bb/shared-ui/resource-list";
import { Switch } from "@bb/shared-ui/switch";
import { Skeleton } from "@bb/shared-ui/skeleton";
import {
  OptionDisplay,
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
  OPTION_TRIGGER_CONTENT_CLASS_NAME,
} from "@bb/shared-ui/option-display";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { cn, formatHomePathForDisplay } from "@bb/shared-ui/lib/utils";
import {
  formatAutomationTrigger,
  formatDetailScheduleStatusLabel,
  formatScheduleRunTime,
  formatScheduleStatusLabel,
  getOneShotLifecycle,
  oneShotLifecycleAllowsToggle,
} from "./lib/format-schedule";
import {
  formatAutomationModelLabel,
  formatAutomationProviderLabel,
} from "./lib/model-label";
import { AutomationProviderIcon } from "./lib/provider-icon";
import { AutomationMetadataItem } from "./metadata";

export interface AutomationRunsViewState {
  runs: readonly AutomationRunResponse[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  loadMore: () => void;
  retry: () => void;
}

export interface AutomationDetailViewProps {
  automation: AutomationResponse;
  projectLabel: string;
  runsState: AutomationRunsViewState;
  actionPending: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onRunNow: () => void;
  onDelete: () => void;
  onOpenThread: (threadId: string) => void;
  footer?: ReactNode;
}

const PERSONAL_PROJECT_ID = "proj_personal";

interface AutomationLifecycleControlProps {
  checked: boolean;
  disabled?: boolean;
  disabledReason?: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}

export function AutomationLifecycleControl({
  checked,
  disabled = false,
  disabledReason,
  label,
  onCheckedChange,
}: AutomationLifecycleControlProps) {
  const control = (
    <Switch
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onCheckedChange={onCheckedChange}
    />
  );

  if (!disabled || disabledReason === undefined) return control;

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-flex cursor-not-allowed rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            tabIndex={0}
            aria-label={`${label}. ${disabledReason}`}
          >
            {control}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-64">
          {disabledReason}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function automationIconName(automation: AutomationResponse): IconName {
  return automation.execution.mode === "script"
    ? "ComputerTerminal01"
    : "Calendar";
}

export function automationScheduleLabel(
  automation: AutomationResponse,
): string {
  return formatScheduleStatusLabel({
    enabled: automation.enabled,
    nextRunAt: automation.nextRunAt,
    trigger: automation.trigger,
    runCount: automation.runCount,
    lastRunStatus: automation.lastRunStatus,
  });
}

function automationDetailNextRun(
  automation: AutomationResponse,
): ReactNode | null {
  const label = automationDetailScheduleLabel(automation);
  if (label === null) return null;
  if (!label.startsWith("Next ")) return label;
  return (
    <AutomationMetadataItem icon="CalendarCheckOut02" iconLabel="Next run">
      {label.slice("Next ".length)}
    </AutomationMetadataItem>
  );
}

function automationDetailScheduleLabel(
  automation: AutomationResponse,
): string | null {
  return formatDetailScheduleStatusLabel({
    enabled: automation.enabled,
    nextRunAt: automation.nextRunAt,
    trigger: automation.trigger,
    runCount: automation.runCount,
    lastRunStatus: automation.lastRunStatus,
  });
}

function automationBodyLabel(execution: AutomationExecution): string {
  if (execution.mode === "agent") return "Prompt";
  return "Script";
}

const SCRIPT_SCROLLBAR_IDLE_DELAY_MS = 600;

function AutomationScriptContent({ content }: { content: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollbarIdleTimeoutRef = useRef<number | null>(null);
  const [hasMoreBelow, setHasMoreBelow] = useState(false);

  useLayoutEffect(() => {
    const scrollArea = scrollRef.current;
    if (!scrollArea) return;

    const updateOverflow = () => {
      setHasMoreBelow(
        scrollArea.scrollTop + scrollArea.clientHeight <
          scrollArea.scrollHeight - 1,
      );
    };
    updateOverflow();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateOverflow);
    resizeObserver?.observe(scrollArea);

    return () => {
      resizeObserver?.disconnect();
      if (scrollbarIdleTimeoutRef.current !== null) {
        window.clearTimeout(scrollbarIdleTimeoutRef.current);
      }
    };
  }, [content]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const scrollArea = event.currentTarget;
    setHasMoreBelow(
      scrollArea.scrollTop + scrollArea.clientHeight <
        scrollArea.scrollHeight - 1,
    );
    scrollArea.dataset.scrollbarScrolling = "true";
    if (scrollbarIdleTimeoutRef.current !== null) {
      window.clearTimeout(scrollbarIdleTimeoutRef.current);
    }
    scrollbarIdleTimeoutRef.current = window.setTimeout(() => {
      scrollbarIdleTimeoutRef.current = null;
      scrollArea.removeAttribute("data-scrollbar-scrolling");
    }, SCRIPT_SCROLLBAR_IDLE_DELAY_MS);
  };

  return (
    <div className="relative isolate min-w-0">
      <div
        ref={scrollRef}
        role="region"
        aria-label="Script contents"
        tabIndex={0}
        data-automation-script-scroll=""
        onScroll={handleScroll}
        className="transient-scrollbar max-h-64 min-w-0 overflow-auto px-3 py-3"
      >
        <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
          {content}
        </pre>
      </div>
      {hasMoreBelow ? (
        <div
          aria-hidden
          data-automation-script-fade="below"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-b from-transparent to-background"
        />
      ) : null}
    </div>
  );
}

function AutomationEnvironmentVariables({
  environment,
}: {
  environment: Record<string, string>;
}) {
  const names = Object.keys(environment).sort();
  if (names.length === 0) return null;
  const label = `${names.length} env ${names.length === 1 ? "var" : "vars"}`;

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-flex items-center gap-1.5"
            tabIndex={0}
            aria-label={`${names.length} environment ${names.length === 1 ? "variable" : "variables"}: ${names.join(", ")}`}
          >
            <Icon name="Code" className="size-3.5" aria-hidden />
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-80">
          {names.join(", ")}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface DisabledAutomationSelectorProps {
  label: string;
  value: string;
  accessibleValue?: string;
  compactValue?: string;
  leading?: ReactNode;
  title?: string;
  className?: string;
}

function DisabledAutomationSelector({
  label,
  value,
  accessibleValue,
  compactValue,
  leading,
  title,
  className,
}: DisabledAutomationSelectorProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={`${label}: ${accessibleValue ?? value}. Read only`}
      disabled
      data-disabled-automation-selector={label}
      className={cn(
        OPTION_BASE_CLASS_NAME,
        OPTION_INTERACTIVE_CLASS_NAME,
        OPTION_MUTED_CLASS_NAME,
        "cursor-default disabled:opacity-100",
        className,
      )}
    >
      <span
        className={OPTION_TRIGGER_CONTENT_CLASS_NAME}
        title={title ?? `${label}: ${value}`}
      >
        {leading}
        <span className="min-w-0 truncate" data-promptbox-full-label="">
          {value}
        </span>
        {compactValue ? (
          <span className="min-w-0 truncate" data-promptbox-compact-label="">
            {compactValue}
          </span>
        ) : null}
      </span>
      <Icon
        name="ChevronDown"
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
    </Button>
  );
}

function automationEnvironmentLabel(execution: AutomationExecution): string {
  if (execution.mode !== "agent") return "Host";
  const environment = execution.environment;
  if (environment.type === "reuse") return "Reuse worktree";
  if (environment.type === "project-default") return "Project default";
  if (environment.workspace.type === "managed-worktree") return "New worktree";
  if (environment.workspace.type === "personal") return "Local";
  return environment.workspace.path == null
    ? "Workspace"
    : formatHomePathForDisplay(environment.workspace.path);
}

function automationEnvironmentCompactLabel(
  execution: Extract<AutomationExecution, { mode: "agent" }>,
): string {
  if (execution.targetThreadId !== undefined) return "Thread";
  const environment = execution.environment;
  if (environment.type === "reuse") return "Reuse";
  if (environment.type === "project-default") return "Default";
  if (environment.workspace.type === "managed-worktree") return "Worktree";
  if (environment.workspace.type === "personal") return "Local";
  return environment.workspace.path === null
    ? "Workspace"
    : formatHomePathForDisplay(environment.workspace.path);
}

function automationEnvironmentIcon(
  execution: Extract<AutomationExecution, { mode: "agent" }>,
): IconName {
  if (execution.targetThreadId !== undefined) return "MessageSquare";
  const environment = execution.environment;
  if (
    environment.type === "reuse" ||
    (environment.type === "host" &&
      environment.workspace.type === "managed-worktree")
  ) {
    return "FolderGit";
  }
  if (
    environment.type === "host" &&
    (environment.workspace.type === "personal" ||
      environment.workspace.type === "unmanaged")
  ) {
    return "Laptop";
  }
  return "Folder";
}

function formatPermissionMode(
  permissionMode: Extract<
    AutomationExecution,
    { mode: "agent" }
  >["permissionMode"],
): string {
  if (permissionMode === "accept-edits") return "Accept Edits";
  if (permissionMode === "auto") return "Approve for me";
  return "Full Access";
}

function formatPermissionModeCompact(
  permissionMode: Extract<
    AutomationExecution,
    { mode: "agent" }
  >["permissionMode"],
): string {
  if (permissionMode === "accept-edits") return "Edits";
  if (permissionMode === "auto") return "Auto";
  return "Full";
}

function formatRunDuration(run: AutomationRunResponse): string | null {
  if (run.finishedAt === null) return null;
  const seconds = (run.finishedAt - run.startedAt) / 1000;
  if (seconds < 0) return null;
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
}

function isSilentRun(run: AutomationRunResponse): boolean {
  return (
    run.status === "succeeded" &&
    run.runMode === "script" &&
    (run.output === null || run.output.trim().length === 0)
  );
}

export const AUTOMATION_RUN_STATUS_VISUALS: Record<
  AutomationRunStatus,
  {
    label: string;
    icon: IconName;
    className: string;
  }
> = {
  running: {
    label: "Running",
    icon: "Loading",
    className: "animate-spin text-muted-foreground",
  },
  failed: {
    label: "Failed",
    icon: "CircleX",
    className: "text-destructive",
  },
  skipped: {
    label: "Skipped",
    // Not CircleDashed: icon.tsx aliases it to the same DashedLineCircleIcon as
    // Spinner, so a skipped run rendered an identical shape to a running one.
    // ArrowTurnForward is the only glyph in the map that reads as "passed
    // over", and it is shape-distinct from check, x, spinner, clock and pause.
    icon: "ArrowTurnForward",
    className: "text-subtle-foreground",
  },
  succeeded: {
    label: "Succeeded",
    icon: "CircleCheck",
    className: "text-success",
  },
};

export function AutomationRunStatusIndicator({
  status,
  showLabel = false,
}: {
  status: AutomationRunStatus;
  showLabel?: boolean;
}) {
  const visual = AUTOMATION_RUN_STATUS_VISUALS[status];
  return (
    <span
      role="img"
      aria-label={visual.label}
      className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
    >
      <Icon
        name={visual.icon}
        className={cn("size-4", visual.className)}
        aria-hidden
      />
      {showLabel ? <span>{visual.label}</span> : null}
    </span>
  );
}

function RunRow({
  run,
  onOpenThread,
}: {
  run: AutomationRunResponse;
  onOpenThread: (threadId: string) => void;
}) {
  const duration = formatRunDuration(run);
  const silent = isSilentRun(run);
  const showOutput =
    run.runMode === "script" &&
    (run.output !== null || run.error !== null || silent);
  const visual = AUTOMATION_RUN_STATUS_VISUALS[run.status];
  const running = run.status === "running";
  const openable = run.runMode === "agent" && run.threadId !== null;
  // The whole row is the affordance when there is a thread, so the destination
  // stays keyboard-reachable without a separate visible button competing with
  // the timestamp on every line.
  const RowTag = openable ? "button" : "div";
  const line = (
    <RowTag
      {...(openable
        ? {
            type: "button" as const,
            onClick: () => onOpenThread(run.threadId!),
          }
        : {})}
      className={cn(
        "group/run flex w-full min-w-0 items-center gap-2.5 rounded-sm px-2 py-1.5 text-left",
        openable &&
          "cursor-pointer hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default",
        running && "bg-surface-recessed/40",
      )}
    >
      <span
        role="img"
        aria-label={visual.label}
        className="inline-flex shrink-0"
      >
        <Icon
          name={visual.icon}
          className={cn(
            "size-3.5",
            visual.className,
            running && "animate-shine-icon",
          )}
          aria-hidden
        />
      </span>
      <span
        className={cn(
          "min-w-0 shrink-0 text-sm",
          running ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {formatScheduleRunTime(run.startedAt)}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-xs",
          running
            ? "animate-shine text-muted-foreground"
            : "text-subtle-foreground",
        )}
      >
        {running ? `${visual.label}\u2026` : (duration ?? "")}
        {run.skipReason ? `${duration ? " · " : ""}${run.skipReason}` : ""}
      </span>
      {openable ? (
        <Icon
          name="ChevronRight"
          className="size-3.5 shrink-0 text-subtle-foreground opacity-0 transition-opacity group-hover/run:opacity-100 group-focus-visible/run:opacity-100"
          aria-hidden
        />
      ) : null}
    </RowTag>
  );
  return (
    <div className="overflow-hidden rounded-sm">
      {line}
      {showOutput ? (
        <pre
          className={cn(
            "mx-2 mb-2 whitespace-pre-wrap rounded-md bg-surface-recessed/70 px-3 py-2 font-mono text-xs leading-relaxed",
            "text-foreground",
            silent && "italic text-subtle-foreground",
          )}
        >
          {run.error ??
            (silent
              ? "no output — silent gate, nothing surfaced"
              : (run.output ?? ""))}
        </pre>
      ) : null}
    </div>
  );
}

export function AutomationDetailView({
  automation,
  projectLabel,
  runsState,
  actionPending,
  onToggle,
  onEdit,
  onRunNow,
  onDelete,
  onOpenThread,
  footer,
}: AutomationDetailViewProps) {
  useResourceRouteLabel(automation.name);
  const oneShotLifecycle = getOneShotLifecycle({
    enabled: automation.enabled,
    trigger: automation.trigger,
    runCount: automation.runCount,
    lastRunStatus: automation.lastRunStatus,
  });
  const lifecycleLocked = !oneShotLifecycleAllowsToggle(oneShotLifecycle);
  const lifecycleDisabledReason = lifecycleLocked
    ? oneShotLifecycle === "expired"
      ? "This one-time automation expired. Edit it to schedule another run."
      : "This one-time automation has completed. Edit it to schedule another run."
    : undefined;
  const bodyLabel = automationBodyLabel(automation.execution);
  const execution = automation.execution;
  const projectContextLabel = projectLabel;
  const personalProject = automation.projectId === PERSONAL_PROJECT_ID;

  return (
    <ResourceDetailPage
      leading={
        <Icon
          name={automationIconName(automation)}
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      }
      title={automation.name}
      metadata={
        <ResourceMeta
          items={[
            <AutomationMetadataItem
              icon={personalProject ? "Laptop" : "Folder"}
              iconLabel={personalProject ? "Local project" : "Project"}
              title={projectContextLabel}
            >
              {projectContextLabel}
            </AutomationMetadataItem>,
            <AutomationMetadataItem icon="DateTime" iconLabel="Schedule">
              {formatAutomationTrigger(automation.trigger)}
            </AutomationMetadataItem>,
            automationDetailNextRun(automation),
          ]}
        />
      }
      lifecycleControl={
        <AutomationLifecycleControl
          checked={automation.enabled}
          disabled={actionPending || lifecycleLocked}
          disabledReason={lifecycleDisabledReason}
          label={
            oneShotLifecycle === "expired"
              ? "Expired automation; edit to reschedule"
              : lifecycleLocked
                ? `${automationScheduleLabel(automation)} automation`
                : automation.enabled
                  ? "Pause automation"
                  : "Resume automation"
          }
          onCheckedChange={onToggle}
        />
      }
      overflowMenu={
        <ResourceOverflowMenu
          label={`${automation.name} actions`}
          disabled={actionPending}
          items={[
            { label: "Run now", icon: "Play", onSelect: onRunNow },
            { kind: "separator" },
            {
              label: "Delete",
              icon: "Trash2",
              tone: "destructive",
              onSelect: onDelete,
            },
          ]}
        />
      }
    >
      <ResourceDetailStack>
        <ResourceDefinitionSection
          label={bodyLabel}
          actions={
            <>
              {execution.mode === "agent" ? (
                <span
                  data-automation-read-only-label=""
                  className="mr-1 inline-flex items-center gap-1 text-xs text-muted-foreground"
                >
                  <Icon name="Lock" className="size-3.5" aria-hidden />
                  Read only
                </span>
              ) : null}
              <ResourceActionButton
                label="Edit with chat"
                tooltipLabel="Edit with chat"
                icon="MessageCirclePlus"
                onClick={onEdit}
              />
            </>
          }
        >
          {execution.mode === "agent" ? (
            <div data-promptbox-shell="" className="min-w-0">
              <ResourcePromptPreview
                className="bg-background"
                context={[
                  {
                    label: (
                      <DisabledAutomationSelector
                        label="Provider and model"
                        value={formatAutomationModelLabel(
                          execution.model,
                          execution.providerId,
                        )}
                        accessibleValue={`${formatAutomationProviderLabel(execution.providerId)}, ${formatAutomationModelLabel(execution.model, execution.providerId)}`}
                        compactValue={formatAutomationModelLabel(
                          execution.model,
                          execution.providerId,
                        )}
                        leading={
                          <AutomationProviderIcon
                            providerId={execution.providerId}
                          />
                        }
                        title={`${formatAutomationProviderLabel(execution.providerId)}: ${formatAutomationModelLabel(execution.model, execution.providerId)}`}
                      />
                    ),
                  },
                ]}
              >
                {execution.prompt}
              </ResourcePromptPreview>
              <div
                data-automation-prompt-footer=""
                className="mt-1 flex min-h-6 min-w-0 items-center justify-between gap-2 px-3.5 text-xs text-muted-foreground"
              >
                <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                  {!personalProject ? (
                    <OptionDisplay
                      label="Project"
                      value={projectContextLabel}
                      compactValue={projectContextLabel}
                      leading={
                        <Icon
                          name="Folder"
                          className="size-3.5 shrink-0"
                          aria-hidden
                        />
                      }
                      className="shrink-0"
                      muted
                    />
                  ) : null}
                  <OptionDisplay
                    label="Environment"
                    value={
                      execution.targetThreadId !== undefined
                        ? "Existing thread"
                        : automationEnvironmentLabel(execution)
                    }
                    compactValue={automationEnvironmentCompactLabel(execution)}
                    leading={
                      <Icon
                        name={automationEnvironmentIcon(execution)}
                        className="size-3.5 shrink-0"
                        aria-hidden
                      />
                    }
                    muted
                  />
                </div>
                <DisabledAutomationSelector
                  label="Permission mode"
                  value={formatPermissionMode(execution.permissionMode)}
                  compactValue={formatPermissionModeCompact(
                    execution.permissionMode,
                  )}
                  className="h-6 shrink-0"
                />
              </div>
            </div>
          ) : (
            <ResourceDetailPanel
              surface="flat"
              className="rounded-md border border-border bg-background"
            >
              {execution.script ? (
                <AutomationScriptContent content={execution.script} />
              ) : (
                <div className="px-3 py-3 text-xs text-muted-foreground">
                  Script content unavailable.
                </div>
              )}
              <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border bg-surface-recessed/55 px-3 py-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Icon
                    name="ComputerTerminal01"
                    className="size-3.5"
                    aria-hidden
                  />
                  {execution.interpreter ?? "bash"}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="Clock" className="size-3.5" aria-hidden />
                  {Math.round(execution.timeoutMs / 1000)}s timeout
                </span>
                {execution.env ? (
                  <AutomationEnvironmentVariables environment={execution.env} />
                ) : null}
              </div>
            </ResourceDetailPanel>
          )}
        </ResourceDefinitionSection>

        <ResourceActivitySection label="Runs">
          {runsState.error !== null ? (
            <ResourceDetailCollection>
              <div
                data-automation-runs-state="error"
                className="flex min-w-0 items-center justify-between gap-3 px-2 py-1.5 text-left text-sm"
              >
                <span className="py-1.5 text-muted-foreground">
                  Runs unavailable.
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={runsState.retry}
                >
                  Retry
                </Button>
              </div>
            </ResourceDetailCollection>
          ) : runsState.loading ? (
            <ResourceDetailCollection>
              <div
                data-automation-runs-state="loading"
                role="status"
                aria-label="Loading runs"
                className="flex min-w-0 items-center gap-2.5 px-2 py-2.5"
              >
                <Skeleton className="size-3.5 shrink-0 rounded-full" />
                <Skeleton className="h-3 w-28 rounded-sm" />
                <Skeleton className="h-3 w-10 rounded-sm" />
              </div>
            </ResourceDetailCollection>
          ) : runsState.runs.length === 0 ? (
            <ResourceDetailCollection>
              <div
                data-automation-runs-state="empty"
                className="flex min-w-0 flex-col items-center gap-2 px-2 py-3 text-center text-sm"
              >
                <span className="text-muted-foreground">No runs yet.</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={actionPending}
                  onClick={onRunNow}
                >
                  <Icon name="Play" className="size-3.5" aria-hidden />
                  Run now
                </Button>
              </div>
            </ResourceDetailCollection>
          ) : (
            <div>
              <ResourceDetailCollection className="divide-border/60">
                {runsState.runs.map((run) => (
                  <RunRow key={run.id} run={run} onOpenThread={onOpenThread} />
                ))}
              </ResourceDetailCollection>
              {runsState.nextCursor !== null ? (
                <div className="flex justify-center pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={runsState.loadingMore}
                    onClick={runsState.loadMore}
                  >
                    {runsState.loadingMore ? "Loading…" : "Load more"}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </ResourceActivitySection>
      </ResourceDetailStack>
      {footer}
    </ResourceDetailPage>
  );
}
