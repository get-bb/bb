import type { ReactNode } from "react";
import type {
  AutomationExecution,
  AutomationResponse,
  AutomationRunResponse,
  AutomationRunStatus,
} from "./src/rpc-types";
import { Button } from "@bb/shared-ui/button";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
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
  ResourceLocationMeta,
  ResourceMeta,
  ResourceOverflowMenu,
  useResourceRouteLabel,
} from "@bb/shared-ui/resource-list";
import { Switch } from "@bb/shared-ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  formatAutomationTrigger,
  formatDetailScheduleStatusLabel,
  formatScheduleRunTime,
  formatScheduleStatusLabel,
  getOneShotLifecycle,
  oneShotLifecycleAllowsToggle,
} from "./lib/format-schedule";

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
  return execution.scriptFile !== undefined && execution.script === undefined
    ? "Script file"
    : "Script";
}

function automationEnvironmentLabel(execution: AutomationExecution): string {
  if (execution.mode !== "agent") return "Host";
  const environment = execution.environment;
  if (environment.type === "reuse") return "Existing environment";
  if (environment.type === "project-default") return "Project default";
  if (environment.workspace.type === "managed-worktree") return "Worktree";
  if (environment.workspace.type === "personal") return "Local";
  return environment.workspace.path ?? "Local workspace";
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
    icon: "CircleDashed",
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
  return (
    <div className="overflow-hidden rounded-sm">
      <div className="flex items-center gap-2 px-2 py-1.5 text-sm">
        <span className="sr-only">
          {AUTOMATION_RUN_STATUS_VISUALS[run.status].label}
        </span>
        <span className="font-medium">
          {formatScheduleRunTime(run.startedAt)}
        </span>
        {duration ? (
          <span className="text-xs text-muted-foreground">{duration}</span>
        ) : null}
        {run.runMode === "agent" && run.threadId ? (
          <button
            type="button"
            onClick={() => onOpenThread(run.threadId!)}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            View thread
          </button>
        ) : null}
      </div>
      {run.skipReason ? (
        <p className="mx-2 mb-2 rounded-md bg-surface-recessed/70 px-3 py-2 text-xs text-muted-foreground">
          {run.skipReason}
        </p>
      ) : null}
      {showOutput ? (
        <pre
          className={cn(
            "mx-2 mb-2 whitespace-pre-wrap rounded-md bg-surface-recessed/70 px-3 py-2 font-mono text-xs leading-relaxed",
            run.error ? "text-destructive" : "text-foreground",
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
  const localProject = projectLabel === "Local";

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
            <ResourceLocationMeta
              label={projectContextLabel}
              icon={localProject ? "Laptop" : "Folder"}
            />,
            <span className="inline-flex items-center gap-1.5">
              <Icon name="Clock" className="size-3.5" aria-hidden />
              {formatAutomationTrigger(automation.trigger)}
            </span>,
            automationDetailScheduleLabel(automation),
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
            <ResourceActionButton
              label="Edit with chat"
              tooltipLabel="Edit with chat"
              icon="MessageCirclePlus"
              onClick={onEdit}
            />
          }
        >
          {execution.mode === "agent" ? (
            <ResourcePromptPreview
              context={[
                {
                  icon: "Brain",
                  label: `${execution.providerId} · ${execution.model}`,
                },
                {
                  icon:
                    execution.environment.type === "host" &&
                    execution.environment.workspace.type === "personal"
                      ? "Laptop"
                      : "Folder",
                  label: automationEnvironmentLabel(execution),
                },
                {
                  icon: "Lock",
                  label: formatPermissionMode(execution.permissionMode),
                },
              ]}
            >
              {execution.prompt}
            </ResourcePromptPreview>
          ) : (
            <ResourceDetailPanel
              surface="recessed"
              className="bg-surface-recessed/45"
            >
              <div
                className={cn(
                  "px-3 py-2",
                  execution.script && "max-h-[42dvh] overflow-auto",
                )}
              >
                {execution.script ? (
                  <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
                    {execution.script}
                  </pre>
                ) : execution.scriptFile ? (
                  <span className="font-mono text-xs">
                    {execution.scriptFile}
                  </span>
                ) : null}
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/35 px-3 py-1.5 text-xs text-muted-foreground">
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
              </div>
            </ResourceDetailPanel>
          )}
        </ResourceDefinitionSection>

        <ResourceActivitySection label="Runs">
          {runsState.error !== null ? (
            <ResourceDetailPanel
              surface="recessed"
              className="px-3 py-5 text-center text-sm text-destructive"
            >
              <div className="flex flex-col items-center gap-2">
                <span>Failed to load runs.</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={runsState.retry}
                >
                  Retry
                </Button>
              </div>
            </ResourceDetailPanel>
          ) : runsState.loading ? (
            <ResourceDetailPanel
              surface="recessed"
              className="px-3 py-6 text-center text-sm text-muted-foreground"
            >
              Loading…
            </ResourceDetailPanel>
          ) : runsState.runs.length === 0 ? (
            <EmptyStatePanel className="py-5">
              <div className="flex flex-col items-center gap-2">
                <span>No runs yet.</span>
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
            </EmptyStatePanel>
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
