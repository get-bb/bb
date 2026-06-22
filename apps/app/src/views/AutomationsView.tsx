import { Fragment, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type {
  Automation,
  AutomationsOverviewResponse,
} from "@bb/server-contract";
import { Button } from "@/components/ui/button.js";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { Icon } from "@/components/ui/icon.js";
import { PageShell } from "@/components/ui/page-shell.js";
import { Pill } from "@/components/ui/pill.js";
import { CREATE_LOOP_PROMPT } from "@/components/promptbox/PromptBoxActionsMenu";
import { useDialogState } from "@/hooks/useDialogState";
import {
  useAutomations,
  useDeleteAutomation,
  usePauseAutomation,
  useResumeAutomation,
  useRunAutomation,
} from "@/hooks/queries/automation-queries";
import { formatScheduleStatusLabel } from "@/lib/format-schedule";
import {
  getAutomationDetailRoutePath,
  getRootComposeRoutePath,
} from "@/lib/route-paths";
import { cn } from "@/lib/utils";

interface AutomationOverviewEntry {
  automation: Automation;
  project: { id: string; name: string };
}

interface AutomationStatusGroup {
  status: "active" | "paused";
  label: string;
  entries: AutomationOverviewEntry[];
}

/** Per-row action callbacks, supplied by the container so the presentational
 * overview stays free of mutation hooks (and renderable in tests). */
export interface AutomationRowActions {
  onPause: (entry: AutomationOverviewEntry) => void;
  onResume: (entry: AutomationOverviewEntry) => void;
  onRun: (entry: AutomationOverviewEntry) => void;
  onDelete: (entry: AutomationOverviewEntry) => void;
}

interface AutomationRowProps {
  entry: AutomationOverviewEntry;
  actions: AutomationRowActions;
}

export interface AutomationsOverviewProps {
  entries: readonly AutomationOverviewEntry[];
  isLoading: boolean;
  hasInitialLoadError: boolean;
  actions: AutomationRowActions;
  onCreateAutomation: () => void;
}

/**
 * Group automations into an insertion-ordered set of status groups: enabled
 * automations under "Active", disabled ones under "Paused". Empty groups are
 * omitted so the view only renders sections that have rows.
 */
function groupAutomationsByStatus(
  entries: readonly AutomationOverviewEntry[],
): AutomationStatusGroup[] {
  const active: AutomationOverviewEntry[] = [];
  const paused: AutomationOverviewEntry[] = [];
  for (const entry of entries) {
    if (entry.automation.enabled) {
      active.push(entry);
    } else {
      paused.push(entry);
    }
  }
  const groups: AutomationStatusGroup[] = [];
  if (active.length > 0) {
    groups.push({ status: "active", label: "Active", entries: active });
  }
  if (paused.length > 0) {
    groups.push({ status: "paused", label: "Paused", entries: paused });
  }
  return groups;
}

export interface AutomationRowMenuItem {
  key: "pause" | "resume" | "run" | "delete";
  label: string;
  destructive: boolean;
  run: () => void;
}

/**
 * Pure description of a row's action-menu items, keyed off the automation's
 * enabled state. Exported so tests assert the item set (Pause vs Resume, Run,
 * Delete) without mounting the portaled Radix menu, which `renderToStaticMarkup`
 * cannot capture.
 */
export function buildAutomationRowMenuItems(
  entry: AutomationOverviewEntry,
  actions: AutomationRowActions,
): AutomationRowMenuItem[] {
  const { automation } = entry;
  return [
    automation.enabled
      ? {
          key: "pause",
          label: "Pause",
          destructive: false,
          run: () => actions.onPause(entry),
        }
      : {
          key: "resume",
          label: "Resume",
          destructive: false,
          run: () => actions.onResume(entry),
        },
    {
      key: "run",
      label: "Run now",
      destructive: false,
      run: () => actions.onRun(entry),
    },
    {
      key: "delete",
      label: "Delete",
      destructive: true,
      run: () => actions.onDelete(entry),
    },
  ];
}

function AutomationRowActionItems({ entry, actions }: AutomationRowProps) {
  const items = buildAutomationRowMenuItems(entry, actions);
  return (
    <>
      {items.map((item) => (
        <Fragment key={item.key}>
          {item.key === "delete" ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem
            className={
              item.destructive
                ? "text-destructive focus:text-destructive"
                : undefined
            }
            onSelect={() => {
              item.run();
            }}
          >
            {item.label}
          </DropdownMenuItem>
        </Fragment>
      ))}
    </>
  );
}

function AutomationRow({ entry, actions }: AutomationRowProps) {
  const { automation, project } = entry;
  const projectLabel =
    project.id === PERSONAL_PROJECT_ID ? null : project.name;
  return (
    <div className="group flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors hover:bg-state-hover">
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          automation.enabled ? "bg-success" : "bg-muted-foreground/50",
        )}
      />
      <Link
        to={getAutomationDetailRoutePath({
          projectId: automation.projectId,
          automationId: automation.id,
        })}
        className="min-w-0 flex-1 truncate hover:underline"
      >
        {automation.name}
      </Link>
      {projectLabel ? (
        <Pill variant="outline" className="shrink-0">
          {projectLabel}
        </Pill>
      ) : null}
      {automation.execution.mode === "script" ? (
        <Pill variant="outline" className="shrink-0">
          Script
        </Pill>
      ) : null}
      {automation.origin === "agent" ? (
        <Pill variant="secondary" className="shrink-0">
          API
        </Pill>
      ) : null}
      <span className="shrink-0 text-xs text-muted-foreground">
        {formatScheduleStatusLabel({
          enabled: automation.enabled,
          nextRunAt: automation.nextRunAt,
        })}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 rounded-md p-0 text-muted-foreground data-[state=open]:bg-state-active data-[state=open]:text-foreground"
            aria-label={`${automation.name} actions`}
            title={`${automation.name} actions`}
          >
            <Icon name="MoreHorizontal" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-40"
          mobileTitle={`${automation.name} actions`}
        >
          <AutomationRowActionItems entry={entry} actions={actions} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function AutomationsOverview({
  entries,
  isLoading,
  hasInitialLoadError,
  actions,
  onCreateAutomation,
}: AutomationsOverviewProps) {
  const groups = groupAutomationsByStatus(entries);
  const isEmpty =
    !isLoading && !hasInitialLoadError && entries.length === 0;

  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="flex items-center justify-end">
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={onCreateAutomation}
          >
            <Icon name="MessageSquarePlus" className="size-4" />
            Create via chat
          </Button>
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : hasInitialLoadError ? (
          <p className="text-sm text-destructive">
            Failed to load automations.
          </p>
        ) : isEmpty ? (
          <EmptyStatePanel className="py-6">
            No automations yet.
          </EmptyStatePanel>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.status}>
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  {group.label}
                </p>
                <div className="mt-1.5 space-y-1">
                  {group.entries.map((entry) => (
                    <AutomationRow
                      key={entry.automation.id}
                      entry={entry}
                      actions={actions}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}

export function AutomationsView() {
  const automationsQuery = useAutomations();
  const navigate = useNavigate();
  const pauseAutomation = usePauseAutomation();
  const resumeAutomation = useResumeAutomation();
  const runAutomation = useRunAutomation();
  const deleteAutomation = useDeleteAutomation();
  const deleteDialog = useDialogState<AutomationOverviewEntry>();
  const { mutate: pauseMutate } = pauseAutomation;
  const { mutate: resumeMutate } = resumeAutomation;
  const { mutate: runMutate } = runAutomation;
  const { mutate: deleteMutate } = deleteAutomation;
  const { onClose: closeDeleteDialog, onOpen: openDeleteDialog } = deleteDialog;

  const data: AutomationsOverviewResponse | undefined = automationsQuery.data;
  const entries = data?.automations ?? [];
  const hasInitialLoadError =
    automationsQuery.isError && data === undefined;
  const isLoading =
    automationsQuery.isFetching && data === undefined && !hasInitialLoadError;

  const actions: AutomationRowActions = {
    onPause: useCallback(
      (entry: AutomationOverviewEntry) => {
        pauseMutate({
          projectId: entry.automation.projectId,
          automationId: entry.automation.id,
        });
      },
      [pauseMutate],
    ),
    onResume: useCallback(
      (entry: AutomationOverviewEntry) => {
        resumeMutate({
          projectId: entry.automation.projectId,
          automationId: entry.automation.id,
        });
      },
      [resumeMutate],
    ),
    onRun: useCallback(
      (entry: AutomationOverviewEntry) => {
        runMutate({
          projectId: entry.automation.projectId,
          automationId: entry.automation.id,
        });
      },
      [runMutate],
    ),
    onDelete: useCallback(
      (entry: AutomationOverviewEntry) => {
        openDeleteDialog(entry);
      },
      [openDeleteDialog],
    ),
  };

  const confirmDelete = useCallback(() => {
    const entry = deleteDialog.target;
    if (!entry) {
      return;
    }
    deleteMutate(
      {
        projectId: entry.automation.projectId,
        automationId: entry.automation.id,
      },
      { onSuccess: () => closeDeleteDialog() },
    );
  }, [closeDeleteDialog, deleteDialog.target, deleteMutate]);

  const handleCreateAutomation = useCallback(() => {
    navigate(getRootComposeRoutePath(), {
      state: { focusPrompt: true, initialPrompt: CREATE_LOOP_PROMPT },
    });
  }, [navigate]);

  return (
    <>
      <AutomationsOverview
        entries={entries}
        isLoading={isLoading}
        hasInitialLoadError={hasInitialLoadError}
        actions={actions}
        onCreateAutomation={handleCreateAutomation}
      />
      <ConfirmDeleteDialog
        open={deleteDialog.isOpen}
        onOpenChange={deleteDialog.onOpenChange}
      >
        <ConfirmDeleteDialogContent
          title="Delete automation?"
          description={
            deleteDialog.target
              ? `"${deleteDialog.target.automation.name}" and its run history will be permanently removed.`
              : ""
          }
          confirmLabel="Delete"
          pending={deleteAutomation.isPending}
          onConfirm={confirmDelete}
          onCancel={closeDeleteDialog}
        />
      </ConfirmDeleteDialog>
    </>
  );
}
