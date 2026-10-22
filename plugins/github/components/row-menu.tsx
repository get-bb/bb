import { useState, type ReactNode, type RefObject } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { COARSE_POINTER_ROW_ACTION_SIZE_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { CompactLongPressMenu } from "@/components/ui/compact-long-press-menu";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  splitTitle,
  stateNameOf,
  type PullRowModel,
  type PullStateName,
} from "../app-logic.js";
import {
  hardMergeBlock,
  mergeBlockedReason,
  type PullStateTarget,
} from "../pull-status.js";
import { MergeMethodItems, type MergeTarget } from "./merge.js";
import {
  MenuKey,
  PullStateItems,
  SnoozeItems,
  StepHeader,
  type Activity,
  type SnoozeChoice,
} from "./pull-actions.js";
import type { MergeMethod } from "./shared.js";

export type RowMenuStep = "main" | "merge" | "snooze";

export interface PullRowMenuActions {
  merge: (
    row: PullRowModel,
    method: MergeMethod,
    deleteBranch: boolean,
  ) => void;
  openMerge: (row: PullRowModel) => void;
  setState: (row: PullRowModel, target: PullStateTarget) => void;
  snooze: (row: PullRowModel, choice: SnoozeChoice) => void;
  unsnooze: (row: PullRowModel) => void;
  startAgent: (row: PullRowModel) => void;
  openThread: (row: PullRowModel) => void;
  copyBranch: (row: PullRowModel) => void;
  openOnGitHub: (row: PullRowModel) => void;
}

export interface PullRowPermissions {
  canEdit: boolean;
  canMerge: boolean | null;
  hasAgent: boolean;
}

export function rowState(
  row: PullRowModel,
  activity: Activity | null,
): PullStateName {
  if (activity?.kind === "changed") return activity.state;
  if (activity?.kind === "merged") return "MERGED";
  return stateNameOf(row.pr);
}

export function isLive(
  row: PullRowModel,
  activity: Activity | null = null,
): boolean {
  const state = rowState(row, activity);
  return state === "OPEN" || state === "DRAFT";
}

export function rowMergeTarget(
  row: PullRowModel,
  canDeleteBranch: boolean,
): MergeTarget {
  return {
    repo: row.item.repo,
    number: row.item.number,
    baseRefName: row.pr.baseRefName,
    headRefName: row.pr.headRefName,
    headRefOid: row.pr.headRefOid,
    isCrossRepository: row.pr.isCrossRepository,
    canDeleteBranch,
  };
}

export function rowMergeable(
  row: PullRowModel,
  permissions: PullRowPermissions,
): boolean {
  return permissions.canMerge === true && mergeBlockedReason(row.pr) === null;
}

export function rowMayMerge(
  row: PullRowModel,
  permissions: PullRowPermissions,
): boolean {
  return permissions.canMerge !== false && hardMergeBlock(row.pr) === null;
}

export function StepKey({ children }: { children: string }) {
  const compact = useIsCompactViewport();
  return compact ? (
    <Icon name="ChevronRight" className="ml-auto text-muted-foreground" />
  ) : (
    <MenuKey>{children}</MenuKey>
  );
}

export function MenuHeading({ children }: { children: ReactNode }) {
  const compact = useIsCompactViewport();
  if (!compact) return null;
  return (
    <>
      <DropdownMenuLabel className="line-clamp-2 text-foreground">
        {children}
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
    </>
  );
}

function PullRowMenuItems({
  row,
  state,
  permissions,
  actions,
  step,
  nested,
  onStep,
}: {
  row: PullRowModel;
  state: PullStateName;
  permissions: PullRowPermissions;
  actions: PullRowMenuActions;
  step: RowMenuStep;
  nested: boolean;
  onStep: (step: RowMenuStep) => void;
}) {
  const header = nested ? <StepHeader onBack={() => onStep("main")} /> : null;
  if (step === "merge") {
    return (
      <>
        {header}
        <MergeMethodItems
          target={rowMergeTarget(row, permissions.canEdit)}
          known={null}
          onMerge={(method, deleteBranch) =>
            actions.merge(row, method, deleteBranch)
          }
        />
      </>
    );
  }
  if (step === "snooze") {
    return (
      <>
        {header}
        <DropdownMenuLabel>Snooze #{row.item.number}</DropdownMenuLabel>
        <SnoozeItems
          snoozed={row.item.snooze !== null}
          onSnooze={(choice) => actions.snooze(row, choice)}
          onUnsnooze={() => actions.unsnooze(row)}
        />
      </>
    );
  }
  const live = state === "OPEN" || state === "DRAFT";
  const openStep = (next: RowMenuStep) => (event: Event) => {
    event.preventDefault();
    onStep(next);
  };
  return (
    <>
      <MenuHeading>
        #{row.item.number} · {splitTitle(row.item.title).text}
      </MenuHeading>
      {live && rowMayMerge(row, permissions) ? (
        <DropdownMenuItem
          onSelect={
            rowMergeable(row, permissions)
              ? openStep("merge")
              : () => actions.openMerge(row)
          }
        >
          <Icon name="GitMerge" />
          Merge…
          <StepKey>M</StepKey>
        </DropdownMenuItem>
      ) : null}
      <PullStateItems
        state={state}
        isDraft={state === "DRAFT"}
        canUpdate={permissions.canEdit}
        canClose={permissions.canEdit}
        canReopen={permissions.canEdit}
        onChange={(target) => actions.setState(row, target)}
      />
      {live ? (
        <DropdownMenuItem onSelect={openStep("snooze")}>
          <Icon name="TimeSchedule" />
          Snooze…
          <StepKey>Z</StepKey>
        </DropdownMenuItem>
      ) : null}
      {live || permissions.hasAgent ? <DropdownMenuSeparator /> : null}
      {live ? (
        <DropdownMenuItem onSelect={() => actions.startAgent(row)}>
          <Icon name="Zap" />
          Start an agent…
          <MenuKey>A</MenuKey>
        </DropdownMenuItem>
      ) : null}
      {permissions.hasAgent ? (
        <DropdownMenuItem onSelect={() => actions.openThread(row)}>
          <Icon name="MessageSquare" />
          Open the agent's thread
          <MenuKey>T</MenuKey>
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => actions.copyBranch(row)}>
        <Icon name="Copy" />
        Copy branch name
        <MenuKey>C</MenuKey>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => actions.openOnGitHub(row)}>
        <Icon name="ExternalLink" />
        Open on GitHub
        <MenuKey>O</MenuKey>
      </DropdownMenuItem>
    </>
  );
}

export function PullRowMenu({
  row,
  state,
  permissions,
  actions,
  step,
  onStepChange,
  rowButton,
}: {
  row: PullRowModel;
  state: PullStateName;
  permissions: PullRowPermissions;
  actions: PullRowMenuActions;
  step: RowMenuStep | null;
  onStepChange: (step: RowMenuStep | null) => void;
  rowButton: RefObject<HTMLButtonElement | null>;
}) {
  const [nested, setNested] = useState(false);
  return (
    <DropdownMenu
      open={step !== null}
      onOpenChange={(open) => {
        setNested(false);
        onStepChange(open ? "main" : null);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          tabIndex={-1}
          className={`${COARSE_POINTER_ROW_ACTION_SIZE_CLASS} text-muted-foreground hover:text-foreground data-[state=open]:bg-state-active [@media(hover:none)]:size-9`}
          aria-label={`Actions for #${row.item.number}`}
        >
          <Icon name="MoreHorizontal" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56"
        mobileTitle={`Actions for #${row.item.number}`}
        onCloseAutoFocus={(event) => {
          if (event.defaultPrevented) return;
          event.preventDefault();
          rowButton.current?.focus({ preventScroll: true });
        }}
      >
        <PullRowMenuItems
          row={row}
          state={state}
          permissions={permissions}
          actions={actions}
          step={step ?? "main"}
          nested={nested}
          onStep={(next) => {
            setNested(next !== "main");
            onStepChange(next);
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PullRowLongPress({
  row,
  state,
  permissions,
  actions,
  enabled,
  onOpenChange,
  children,
}: {
  row: PullRowModel;
  state: PullStateName;
  permissions: PullRowPermissions;
  actions: PullRowMenuActions;
  enabled: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const [step, setStep] = useState<RowMenuStep>("main");
  if (!enabled) return <>{children}</>;
  return (
    <CompactLongPressMenu
      label={`Actions for #${row.item.number}`}
      onOpenChange={(open) => {
        if (!open) setStep("main");
        onOpenChange(open);
      }}
      items={
        <PullRowMenuItems
          row={row}
          state={state}
          permissions={permissions}
          actions={actions}
          step={step}
          nested
          onStep={setStep}
        />
      }
    >
      {children}
    </CompactLongPressMenu>
  );
}
