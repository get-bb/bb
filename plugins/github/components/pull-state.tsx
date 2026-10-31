import { useState } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  diffSizeBlocks,
  pullStateActions,
  type PullStateName,
} from "../app-logic.js";
import type { PullStateTarget } from "../pull-status.js";
import { copyText, PullStateItems } from "./pull-actions.js";
import { SpinnerIcon } from "./shared.js";

const PULL_STATE_DISPLAY: Record<
  PullStateName,
  { icon: string; tone: string; label: string }
> = {
  OPEN: { icon: "GitPullRequest", tone: "text-success", label: "Open" },
  DRAFT: {
    icon: "GitPullRequestDraft",
    tone: "text-muted-foreground",
    label: "Draft",
  },
  MERGED: { icon: "GitMerge", tone: "text-pr-merged", label: "Merged" },
  CLOSED: {
    icon: "GitPullRequestClosed",
    tone: "text-destructive",
    label: "Closed",
  },
};

const PILL_CLASS =
  "h-6 gap-1.5 rounded-full px-2 text-xs font-normal max-md:pointer-coarse:h-9";

export interface PullStateSubject {
  number: number;
  state: PullStateName;
  isDraft: boolean;
  viewerCanUpdate: boolean;
  viewerCanClose: boolean;
  viewerCanReopen: boolean;
}

export function PullStateMenu({
  subject,
  pending,
  openRequest,
  onChange,
}: {
  subject: PullStateSubject;
  pending: string | null;
  openRequest: number;
  onChange: (target: PullStateTarget) => void;
}) {
  const compact = useIsCompactViewport();
  const [open, setOpen] = useState(false);
  const [seenRequest, setSeenRequest] = useState(openRequest);
  const actions = pullStateActions(subject);
  if (pending !== null && open) setOpen(false);
  if (seenRequest !== openRequest) {
    setSeenRequest(openRequest);
    if (pending === null && actions.length > 0) setOpen(true);
  }
  const display = PULL_STATE_DISPLAY[subject.state];
  const content =
    pending === null ? (
      <>
        <Icon
          name={display.icon}
          className={`size-3.5 shrink-0 ${display.tone}`}
        />
        {display.label}
      </>
    ) : (
      <>
        <SpinnerIcon className="size-3.5 shrink-0" />
        {pending}
      </>
    );
  if (actions.length === 0) {
    return (
      <span
        role="status"
        aria-label={`Status: ${display.label}`}
        className={`inline-flex items-center border border-border ${PILL_CLASS}`}
      >
        {content}
      </span>
    );
  }
  return (
    <DropdownMenu
      open={open && pending === null}
      onOpenChange={(next) => setOpen(next && pending === null)}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-keyshortcuts="S"
          aria-disabled={pending !== null || undefined}
          aria-label={pending ?? `Status: ${display.label}. Change the status`}
          className={`${PILL_CLASS} data-[state=open]:bg-state-active`}
        >
          {content}
          {pending === null ? (
            <Icon
              name="ChevronDown"
              className="size-3 shrink-0 text-muted-foreground"
            />
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-56"
        mobileTitle={`Status of #${subject.number}`}
      >
        <DropdownMenuLabel aria-hidden={compact || undefined}>
          Status of #{subject.number}
        </DropdownMenuLabel>
        <PullStateItems
          state={subject.state}
          isDraft={subject.isDraft}
          canUpdate={subject.viewerCanUpdate}
          canClose={subject.viewerCanClose}
          canReopen={subject.viewerCanReopen}
          onChange={onChange}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function IssueStateMenu({
  number,
  open,
  canChange,
  pending,
  onChange,
}: {
  number: number;
  open: boolean;
  canChange: boolean;
  pending: string | null;
  onChange: (state: "open" | "closed") => void;
}) {
  const compact = useIsCompactViewport();
  const [menuOpen, setMenuOpen] = useState(false);
  if (pending !== null && menuOpen) setMenuOpen(false);
  const label = open ? "Open" : "Closed";
  const content =
    pending === null ? (
      <>
        <Icon
          name={open ? "Circle" : "CircleCheck"}
          className={`size-3.5 shrink-0 ${open ? "text-success" : "text-pr-merged"}`}
        />
        {label}
      </>
    ) : (
      <>
        <SpinnerIcon className="size-3.5 shrink-0" />
        {pending}
      </>
    );
  if (!canChange) {
    return (
      <span
        role="status"
        aria-label={`Status: ${label}`}
        className={`inline-flex items-center border border-border ${PILL_CLASS}`}
      >
        {content}
      </span>
    );
  }
  return (
    <DropdownMenu
      open={menuOpen && pending === null}
      onOpenChange={(next) => setMenuOpen(next && pending === null)}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-disabled={pending !== null || undefined}
          aria-label={pending ?? `Status: ${label}. Change the status`}
          className={`${PILL_CLASS} data-[state=open]:bg-state-active`}
        >
          {content}
          {pending === null ? (
            <Icon
              name="ChevronDown"
              className="size-3 shrink-0 text-muted-foreground"
            />
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-56"
        mobileTitle={`Status of #${number}`}
      >
        <DropdownMenuLabel aria-hidden={compact || undefined}>
          Status of #{number}
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onChange(open ? "closed" : "open")}>
          <Icon name={open ? "CircleCheck" : "Circle"} />
          {open ? "Close issue" : "Reopen issue"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const COUNT_FORMAT = new Intl.NumberFormat("en-US");

export function formatCount(value: number): string {
  return COUNT_FORMAT.format(value);
}

export function PullDiffStat({
  additions,
  deletions,
  changedFiles,
  onShowFiles,
}: {
  additions: number;
  deletions: number;
  changedFiles: number;
  onShowFiles: () => void;
}) {
  return (
    <button
      type="button"
      className="-mx-1 inline-flex items-center gap-1.5 rounded-md px-1 tabular-nums hover:bg-state-hover hover:text-foreground max-md:pointer-coarse:h-9"
      aria-label={`${formatCount(additions)} lines added and ${formatCount(deletions)} removed in ${changedFiles} file${changedFiles === 1 ? "" : "s"}. Show the files`}
      onClick={onShowFiles}
    >
      <span className="text-diff-added">+{formatCount(additions)}</span>
      <span className="text-diff-removed">-{formatCount(deletions)}</span>
      <span className="flex shrink-0 gap-px" aria-hidden>
        {diffSizeBlocks(additions, deletions).map((block, index) => (
          <span
            key={index}
            className={`size-1.5 rounded-[1px] ${
              block === "added"
                ? "bg-diff-added"
                : block === "removed"
                  ? "bg-diff-removed"
                  : "bg-muted"
            }`}
          />
        ))}
      </span>
    </button>
  );
}

export function BranchCopyChip({ name }: { name: string }) {
  return (
    <button
      type="button"
      className="-mx-1 inline-flex min-w-0 items-center gap-1 rounded-md px-1 text-left font-mono hover:bg-state-hover hover:text-foreground max-md:pointer-coarse:min-h-9"
      title={`Copy ${name}`}
      aria-label={`Copy the branch name ${name}`}
      onClick={() => copyText(name, "branch name")}
    >
      <span className="min-w-0 truncate @max-[35rem]/github:break-all @max-[35rem]/github:whitespace-normal">
        {name}
      </span>
      <Icon name="Copy" className="size-3 shrink-0 text-muted-foreground" />
    </button>
  );
}
