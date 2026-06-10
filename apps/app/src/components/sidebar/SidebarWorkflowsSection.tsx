import { memo, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { isTerminalWorkflowRunStatus, type WorkflowRunStatus } from "@bb/domain";
import type { WorkflowRunResponse } from "@bb/server-contract";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog";
import { Button } from "@/components/ui/button.js";
import {
  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
} from "@/components/ui/coarse-pointer-sizing.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { Icon } from "@/components/ui/icon.js";
import { Pill } from "@/components/ui/pill.js";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions.js";
import { workflowRunStatusPillVariant } from "@/components/workflow/workflow-run-status.js";
import {
  useArchiveWorkflowRun,
  useDeleteWorkflowRun,
} from "@/hooks/mutations/workflow-run-mutations";
import { useAppRoute } from "@/hooks/useAppRoute";
import { useDialogState } from "@/hooks/useDialogState";
import { getWorkflowRunRoutePath } from "@/lib/app-route-paths";
import { cn } from "@/lib/utils";
import { wsManager } from "@/lib/ws";
import {
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  SIDEBAR_STANDARD_ROW_PADDING_CLASS,
} from "./sidebarRowClasses";

interface SidebarWorkflowsSectionProps {
  runs: readonly WorkflowRunResponse[];
}

interface SidebarWorkflowRunRowProps {
  isActive: boolean;
  onArchive: (run: WorkflowRunResponse) => void;
  onRequestDelete: (run: WorkflowRunResponse) => void;
  run: WorkflowRunResponse;
}

/**
 * Archive/delete eligibility mirrors the server's `requireSettledWorkflowRun`
 * guard (409 `workflow_run_not_settled` otherwise): terminal runs and
 * `interrupted` runs are settled; `created`/`starting`/`running` must be
 * cancelled first.
 */
function isSettledWorkflowRunStatus(status: WorkflowRunStatus): boolean {
  return isTerminalWorkflowRunStatus(status) || status === "interrupted";
}

const SidebarWorkflowRunRow = memo(function SidebarWorkflowRunRow({
  isActive,
  onArchive,
  onRequestDelete,
  run,
}: SidebarWorkflowRunRowProps) {
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const isSettled = isSettledWorkflowRunStatus(run.status);

  return (
    <div
      className={cn(
        SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
        "group/workflow-run-row",
        SIDEBAR_ROW_BASE_CLASS,
        "relative",
        COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
        SIDEBAR_STANDARD_ROW_PADDING_CLASS,
        isActive
          ? "bg-sidebar-border text-sidebar-foreground"
          : SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
      )}
    >
      <NavLink
        to={getWorkflowRunRoutePath(run.id)}
        aria-label={`Open ${run.workflowName} workflow run`}
        title={`Open ${run.workflowName} workflow run`}
        aria-current={isActive ? "page" : undefined}
        className="absolute inset-0 rounded-md outline-none ring-sidebar-ring focus-visible:ring-2"
      />
      <span className="relative z-10 min-w-0 flex-1 truncate">
        {run.workflowName}
      </span>
      <Pill
        variant={workflowRunStatusPillVariant(run.status)}
        className="relative z-10 shrink-0"
      >
        {run.status}
      </Pill>
      <span
        className={cn("relative shrink-0", COARSE_POINTER_ROW_ACTION_SIZE_CLASS)}
      >
        {!isSettled ? (
          // Active runs surface the sidebar's live "working" glyph (shared
          // with busy thread rows); it fades out when the hover actions show.
          <span
            data-sidebar-hover-actions-open={isActionsOpen ? "true" : undefined}
            className={cn(
              SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
              "absolute inset-0 flex items-center justify-center",
            )}
          >
            <Icon
              name="CircleDashed"
              className={cn(
                "animate-spin text-muted-foreground",
                COARSE_POINTER_ICON_SIZE_CLASS,
              )}
              aria-label="Workflow run working"
            />
          </span>
        ) : null}
        <div
          data-sidebar-hover-actions-open={isActionsOpen ? "true" : undefined}
          className={cn(
            SIDEBAR_HOVER_ACTIONS_CLASS,
            "absolute inset-0 z-10 flex items-center justify-end",
          )}
        >
          <DropdownMenu onOpenChange={setIsActionsOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  "rounded-md p-0 text-muted-foreground",
                  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
                )}
                aria-label={`Workflow run actions for ${run.workflowName}`}
                title="Workflow run actions"
                onClick={(event) => {
                  event.stopPropagation();
                }}
              >
                <Icon
                  name="MoreHorizontal"
                  className={COARSE_POINTER_ICON_SIZE_CLASS}
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                disabled={!isSettled}
                onSelect={() => {
                  onArchive(run);
                }}
              >
                Archive
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!isSettled}
                className="text-destructive focus:text-destructive"
                onSelect={() => {
                  onRequestDelete(run);
                }}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </span>
    </div>
  );
});

/**
 * Top-level sidebar list of recent workflow runs across all projects (the
 * caller sources it from `useRecentWorkflowRuns()` and hides the section when
 * empty). Workflow-run realtime is opt-in by design, so the section
 * subscribes entity-wide while mounted — mirroring the project Workflows tab
 * — and unsubscribes on leave so the hub key never leaks.
 */
export const SidebarWorkflowsSection = memo(function SidebarWorkflowsSection({
  runs,
}: SidebarWorkflowsSectionProps) {
  const { workflowRunId: activeWorkflowRunId } = useAppRoute();
  const archiveRun = useArchiveWorkflowRun();
  const deleteRun = useDeleteWorkflowRun();
  const deleteDialog = useDialogState<WorkflowRunResponse>();
  const deleteTarget = deleteDialog.target;

  useEffect(() => {
    wsManager.subscribe("workflow-run");
    return () => {
      wsManager.unsubscribe("workflow-run");
    };
  }, []);

  return (
    <div className="space-y-px group-data-[collapsible=icon]:hidden">
      {runs.map((run) => (
        <SidebarWorkflowRunRow
          key={run.id}
          run={run}
          isActive={run.id === activeWorkflowRunId}
          onArchive={(target) => {
            archiveRun.mutate({ runId: target.id });
          }}
          onRequestDelete={deleteDialog.onOpen}
        />
      ))}
      <ConfirmDeleteDialog
        open={deleteDialog.isOpen}
        onOpenChange={deleteDialog.onOpenChange}
      >
        {deleteTarget ? (
          <ConfirmDeleteDialogContent
            title="Delete workflow run?"
            description={`The ${deleteTarget.workflowName} run and its journal will no longer be accessible. This action cannot be undone.`}
            confirmLabel="Delete run"
            pending={deleteRun.isPending}
            onConfirm={() => {
              deleteRun.mutate(
                { runId: deleteTarget.id },
                { onSuccess: deleteDialog.onClose },
              );
            }}
            onCancel={deleteDialog.onClose}
          />
        ) : null}
      </ConfirmDeleteDialog>
    </div>
  );
});
