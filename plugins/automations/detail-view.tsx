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
import {
  formatAutomationModelLabel,
  formatAutomationProviderLabel,
} from "./lib/model-label";

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

/**
 * The upcoming run, labelled in full.
 *
 * No icon: the row already carries the project and cadence glyphs, and a third
 * time-shaped icon beside the cadence clock would read as a second clock
 * meaning something else. The whole meta row now sits a tone below the title,
 * which is what keeps this from competing.
 */
function automationDetailNextRun(
  automation: AutomationResponse,
): ReactNode | null {
  const label = automationDetailScheduleLabel(automation);
  if (label === null) return null;
  if (!label.startsWith("Next ")) return label;
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1">
      <span>Next run:</span>
      <span className="min-w-0 truncate">{label.slice("Next ".length)}</span>
    </span>
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
              // The composer's footer leads with the model and keeps the
              // provider as supporting text, with no decorative glyph per item.
              // Environment and permission carry no composer analogue, so they
              // lose their icons and read as plain trailing metadata.
              context={[
                {
                  label: (
                    <span className="inline-flex min-w-0 items-baseline gap-1.5">
                      <span className="min-w-0 truncate text-foreground">
                        {formatAutomationModelLabel(
                          execution.model,
                          execution.providerId,
                        )}
                      </span>
                      <span className="min-w-0 truncate">
                        {formatAutomationProviderLabel(execution.providerId)}
                      </span>
                    </span>
                  ),
                },
                {
                  icon:
                    execution.environment.type === "host" &&
                    execution.environment.workspace.type === "personal"
                      ? "Laptop"
                      : "Folder",
                  label: automationEnvironmentLabel(execution),
                },
                { label: formatPermissionMode(execution.permissionMode) },
              ]}
            >
              {execution.prompt}
            </ResourcePromptPreview>
          ) : (
            // Same container as ResourcePromptPreview and the Runs collection:
            // a script definition is the same kind of object as a prompt
            // definition, so it should not sit on a recessed surface while its
            // sibling sits on a flat bordered one.
            <ResourceDetailPanel
              surface="flat"
              className="rounded-md border border-border bg-background"
            >
              <div
                className={cn(
                  "px-3 py-3",
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
              <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border px-3 py-2 text-xs text-muted-foreground">
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
