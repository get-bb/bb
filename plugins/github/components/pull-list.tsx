import { useEffect, useRef, useState, type ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { DelayedLoading } from "@/components/ui/delayed-loading";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OverflowFade } from "@/components/ui/overflow-fade";
import { Skeleton } from "@/components/ui/skeleton";
import {
  queryChips,
  splitTitle,
  type PullRowGroup,
  type PullRowModel,
  type PullStateName,
} from "../app-logic.js";
import {
  checksWords,
  PULL_VIEWS,
  pullGlyph,
  pullNextStep,
  type PullGlyph,
  type PullView,
} from "../pull-status.js";
import { snoozeLabel } from "../snooze.js";
import { activityLabel, isInFlight, type Activity } from "./pull-actions.js";
import {
  isLive,
  PullRowLongPress,
  PullRowMenu,
  rowMergeable,
  rowState,
  type PullRowMenuActions,
  type PullRowPermissions,
  type RowMenuStep,
} from "./row-menu.js";
import {
  AgentGlyph,
  compactAge,
  PULL_TONE_CLASS,
  PullAuthor,
  SectionHeading,
  TipButton,
  useReturnFocus,
  type AgentInfo,
} from "./shared.js";

export type InboxView = PullView | "issues";

export const INBOX_VIEWS: ReadonlyArray<{ id: InboxView; label: string }> = [
  ...PULL_VIEWS,
  { id: "issues", label: "Issues" },
];

export const TAB_LIST_CLASS =
  "h-auto justify-start gap-0.5 rounded-none bg-transparent p-0 text-subtle-foreground";
export const TAB_TRIGGER_CLASS =
  "h-7 gap-1.5 rounded-md px-2 text-sm font-medium text-subtle-foreground ring-offset-0 hover:bg-state-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-offset-0 data-[state=active]:bg-state-active data-[state=active]:text-foreground data-[state=active]:shadow-none max-md:pointer-coarse:h-9";

export const HEADER_CLASS =
  "flex h-12 shrink-0 items-center gap-1 border-b border-border px-2";

export interface PullListActions extends PullRowMenuActions {
  open: (row: PullRowModel) => void;
  point: (row: PullRowModel) => void;
  focus: (row: PullRowModel) => void;
  menu: (row: PullRowModel, step: RowMenuStep | null) => void;
}

export interface PullListContext {
  viewer: string | null;
  showRepo: boolean;
  split: boolean;
  now: number;
  cursor: string | null;
  openKey: string | null;
  tabbableKey: string | null;
  menu: { key: string; step: RowMenuStep } | null;
  activities: ReadonlyMap<string, Activity>;
  agents: ReadonlyMap<string, AgentInfo>;
  permissions: (row: PullRowModel) => PullRowPermissions;
  touch: boolean;
  compact: boolean;
  actions: PullListActions;
  registerRow: (key: string, element: HTMLButtonElement | null) => void;
}

const CHANGED_GLYPH: Record<PullStateName, PullGlyph> = {
  OPEN: { icon: "GitPullRequestArrow", tone: "ready", label: "Open" },
  DRAFT: { icon: "GitPullRequestDraft", tone: "waiting", label: "Draft" },
  CLOSED: { icon: "GitPullRequestClosed", tone: "closed", label: "Closed" },
  MERGED: { icon: "GitMerge", tone: "merged", label: "Merged" },
};

export function rowGlyph(
  row: PullRowModel,
  activity: Activity | null,
): PullGlyph {
  switch (activity?.kind) {
    case undefined:
      return pullGlyph(row.pr, row.group);
    case "merged":
      return CHANGED_GLYPH.MERGED;
    case "changed":
      return CHANGED_GLYPH[activity.state];
    case "merging":
    case "changing":
      return {
        icon: "Spinner",
        tone: "working",
        label: activityLabel(activity),
      };
  }
}

export function rowFailing(
  row: PullRowModel,
  activity: Activity | null,
): string | null {
  const { pr } = row;
  if (activity !== null || row.group === "snoozed") return null;
  if (pr.checks.state !== "failing") return null;
  const reviewing = row.group === "you" && pr.attention !== "changes_requested";
  if (!reviewing && pr.attention !== "conflicts") return null;
  return checksWords("failing");
}

export function rowReason(
  row: PullRowModel,
  activity: Activity | null,
  now: number,
): string {
  if (activity !== null) return activityLabel(activity);
  if (row.group === "snoozed" && row.item.snooze !== null) {
    return `Snoozed ${snoozeLabel(row.item.snooze, new Date(now))}`;
  }
  return pullNextStep(row.pr, row.group);
}

export function FailingAside({ text }: { text: string | null }) {
  if (text === null) return null;
  return (
    <span className="shrink-0 whitespace-pre">
      {" · "}
      <span className="text-destructive-text">{text}</span>
    </span>
  );
}

function quickAction(
  row: PullRowModel,
  permissions: PullRowPermissions,
): {
  label: string;
  key: string;
  icon: string;
  step: RowMenuStep | null;
} | null {
  if (!isLive(row)) return null;
  if (rowMergeable(row, permissions)) {
    return { label: "Merge", key: "M", icon: "GitMerge", step: "merge" };
  }
  if (row.pr.state === "draft" && permissions.canEdit) {
    return {
      label: "Mark ready",
      key: "R",
      icon: "GitPullRequestArrow",
      step: null,
    };
  }
  return null;
}

function RowTitle({ title }: { title: string }) {
  const { prefix, text } = splitTitle(title);
  return (
    <>
      {prefix === null ? null : (
        <span className="font-normal text-subtle-foreground">{prefix} </span>
      )}
      {text}
    </>
  );
}

export function PullListRow({
  row,
  context,
}: {
  row: PullRowModel;
  context: PullListContext;
}) {
  const { actions } = context;
  const activity = context.activities.get(row.key) ?? null;
  const agent = context.agents.get(`pr:${row.key}`) ?? null;
  const permissions = context.permissions(row);
  const isCursor = context.cursor === row.key;
  const isOpen = context.openKey === row.key;
  const step = context.menu?.key === row.key ? context.menu.step : null;
  const [pressed, setPressed] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const state = rowState(row, activity);
  const glyph = rowGlyph(row, activity);
  const reason = rowReason(row, activity, context.now);
  const failing = rowFailing(row, activity);
  const busy = isInFlight(activity);
  const quick =
    activity !== null || context.touch ? null : quickAction(row, permissions);
  const revealed = isCursor || step !== null;
  const showMenu =
    !busy && activity?.kind !== "merged" && !(context.touch && context.compact);
  const age = compactAge(
    row.pr.state === "merged" && row.pr.mergedAt !== null
      ? row.pr.mergedAt
      : row.item.updatedAt,
    context.now,
  );
  const mine =
    context.viewer !== null &&
    row.item.author.toLowerCase() === context.viewer.toLowerCase();
  const actionsClass = context.touch
    ? "relative flex"
    : `absolute top-1.5 right-1.5 ${revealed ? "flex" : "hidden group-hover/row:flex"}`;
  return (
    <PullRowLongPress
      row={row}
      state={state}
      permissions={permissions}
      actions={actions}
      enabled={context.compact && !busy && activity?.kind !== "merged"}
      onOpenChange={setPressed}
    >
      <div
        data-row-key={row.key}
        aria-busy={busy ? true : undefined}
        onPointerMove={(event) => {
          if (
            isCursor ||
            context.split ||
            event.pointerType !== "mouse" ||
            (event.movementX === 0 && event.movementY === 0)
          ) {
            return;
          }
          actions.point(row);
        }}
        className={`group/row relative flex select-none items-start gap-2 rounded-md px-2 py-1.5 @max-[35rem]/github:py-2.5 ${
          isOpen
            ? "bg-state-active"
            : isCursor || step !== null || pressed
              ? "bg-state-hover"
              : context.split
                ? "hover:bg-state-hover"
                : ""
        }`}
      >
        <button
          ref={(element) => {
            buttonRef.current = element;
            context.registerRow(row.key, element);
          }}
          type="button"
          data-row-button=""
          tabIndex={context.tabbableKey === row.key ? 0 : -1}
          aria-current={isOpen ? "true" : undefined}
          aria-label={`#${row.item.number} ${row.item.title}: ${reason}${failing === null ? "" : ` · ${failing}`}`}
          onClick={() => actions.open(row)}
          onFocus={() => actions.focus(row)}
          className="absolute inset-0 scroll-mt-9 cursor-default rounded-md outline-none focus-visible:ring-1 focus-visible:ring-ring max-md:pointer-coarse:scroll-mt-11"
        />
        <span
          title={glyph.label}
          className="mt-0.5 flex size-4 shrink-0 items-center justify-center"
        >
          <Icon
            name={glyph.icon}
            aria-hidden
            className={`size-4 ${PULL_TONE_CLASS[glyph.tone]}`}
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-foreground @max-[35rem]/github:line-clamp-2 @max-[35rem]/github:whitespace-normal">
            <RowTitle title={row.item.title} />
          </span>
          <span className="flex min-w-0 text-xs text-subtle-foreground">
            <span className="truncate">
              {context.showRepo ? row.item.repo : ""}#{row.item.number}
              {" · "}
              <span className={busy ? "animate-shine" : undefined}>
                {reason}
              </span>
              {row.pr.state === "draft" && row.group !== "draft"
                ? " · Draft"
                : ""}
            </span>
            <FailingAside text={failing} />
          </span>
        </span>
        <span
          className={`flex h-5 shrink-0 items-center gap-2 text-xs text-subtle-foreground tabular-nums ${
            context.touch
              ? ""
              : revealed
                ? "invisible"
                : "group-hover/row:invisible"
          }`}
        >
          {agent === null ? null : (
            <span title={agent.title} className="flex">
              <AgentGlyph agent={agent} />
            </span>
          )}
          {mine ? null : (
            <span className="flex @max-[35rem]/github:hidden">
              <PullAuthor login={row.item.author} />
            </span>
          )}
          <span className="min-w-6 text-right">{age}</span>
        </span>
        {quick === null && !showMenu ? null : (
          <span className={`${actionsClass} items-center gap-0.5`}>
            {quick === null ? null : (
              <TipButton
                label={quick.label}
                keys={isCursor ? [quick.key] : undefined}
                icon={quick.icon}
                tabIndex={-1}
                onClick={() =>
                  quick.step === null
                    ? actions.setState(row, "open")
                    : actions.menu(row, quick.step)
                }
              />
            )}
            {showMenu ? (
              <PullRowMenu
                row={row}
                state={state}
                permissions={permissions}
                actions={actions}
                step={step}
                onStepChange={(next) => actions.menu(row, next)}
                rowButton={buttonRef}
              />
            ) : null}
          </span>
        )}
      </div>
    </PullRowLongPress>
  );
}

export function GroupHeader({
  label,
  count,
  collapsed,
  onToggle,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="sticky top-0 z-10 flex h-8 items-center bg-sidebar px-2 max-md:pointer-coarse:h-10">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md text-left text-xs font-medium text-subtle-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          <Icon
            name="ChevronDown"
            className={`size-3 transition-transform motion-reduce:transition-none ${collapsed ? "-rotate-90" : ""}`}
          />
        </span>
        <span className="truncate">{label}</span>
        <span className="font-normal tabular-nums">{count}</span>
      </button>
    </div>
  );
}

export function PullList({
  groups,
  collapsed,
  onToggleGroup,
  context,
  empty,
}: {
  groups: PullRowGroup[];
  collapsed: (groupId: string) => boolean;
  onToggleGroup: (groupId: string) => void;
  context: PullListContext;
  empty: ReactNode;
}) {
  if (groups.length === 0) return <>{empty}</>;
  return (
    <div className="flex flex-col gap-3 pt-1.5">
      {groups.map((group) => {
        const isCollapsed = collapsed(group.id);
        return (
          <section
            key={group.id}
            aria-label={group.label}
            className="flex flex-col gap-0.5"
          >
            <GroupHeader
              label={group.label}
              count={group.rows.length}
              collapsed={isCollapsed}
              onToggle={() => onToggleGroup(group.id)}
            />
            {isCollapsed
              ? null
              : group.rows.map((row) => (
                  <PullListRow key={row.key} row={row} context={context} />
                ))}
          </section>
        );
      })}
    </div>
  );
}

const SKELETON_GROUPS = [2, 4, 3];

export function ListSkeleton() {
  return (
    <DelayedLoading>
      <div aria-hidden className="flex flex-col gap-3 pt-1.5">
        {SKELETON_GROUPS.map((rows, group) => (
          <div key={group} className="flex flex-col gap-0.5">
            <div className="flex h-8 items-center gap-2 px-2">
              <span className="size-4" />
              <Skeleton className="h-2.5 w-20" />
            </div>
            {Array.from({ length: rows }, (_, row) => (
              <div
                key={row}
                className="flex items-start gap-2 px-2 py-1.5 @max-[35rem]/github:py-2.5"
              >
                <Skeleton className="mt-0.5 size-4 rounded-full" />
                <span className="flex flex-1 flex-col gap-2 pt-1">
                  <Skeleton
                    className="h-3"
                    style={{ width: `${44 + ((row * 17 + group * 11) % 36)}%` }}
                  />
                  <Skeleton
                    className="h-2.5"
                    style={{ width: `${26 + ((row * 13 + group * 7) % 24)}%` }}
                  />
                </span>
                <Skeleton className="mt-1 h-2.5 w-6" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </DelayedLoading>
  );
}

export function ListMessage({
  icon,
  title,
  detail,
  action,
}: {
  icon: string;
  title: string;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1 px-6 py-20 text-center">
      <Icon name={icon} className="size-5 text-subtle-foreground" />
      <p className="mt-2 text-sm font-medium text-foreground">{title}</p>
      {detail === undefined ? null : (
        <p className="max-w-72 text-xs text-subtle-foreground">{detail}</p>
      )}
      {action === undefined ? null : <div className="mt-2">{action}</div>}
    </div>
  );
}

export function NoMatch({
  noun,
  query,
  viewer,
  onClear,
}: {
  noun: string;
  query: string;
  viewer: string | null;
  onClear: () => void;
}) {
  const several = queryChips(query, viewer).length > 1;
  return (
    <ListMessage
      icon="Search"
      title={`No ${noun} match`}
      detail={several ? "Try fewer conditions." : undefined}
      action={
        several ? (
          <Button type="button" size="sm" variant="ghost" onClick={onClear}>
            Clear the filter
          </Button>
        ) : undefined
      }
    />
  );
}

export function ViewTabs({
  view,
  count,
  onView,
}: {
  view: InboxView;
  count: number | null;
  onView: (view: InboxView) => void;
}) {
  const listRef = useRef<HTMLElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>("[aria-current='page']")
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [view]);
  useEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    const update = () =>
      setMore(list.scrollLeft + list.clientWidth < list.scrollWidth - 1);
    update();
    list.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      list.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return (
    <div className="relative min-w-0 flex-1">
      <nav
        ref={listRef}
        aria-label="Views"
        className={`${TAB_LIST_CLASS} flex min-w-0 items-center overflow-x-auto pr-6 [scrollbar-width:none] scroll-pr-6`}
      >
        {INBOX_VIEWS.map((entry) => {
          const active = entry.id === view;
          return (
            <button
              key={entry.id}
              type="button"
              aria-current={active ? "page" : undefined}
              data-state={active ? "active" : "inactive"}
              onClick={() => onView(entry.id)}
              className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap outline-none ${TAB_TRIGGER_CLASS}`}
            >
              {entry.label}
              {entry.id === "inbox" && count !== null && count > 0 ? (
                <span className="text-xs font-normal tabular-nums">
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
      {more ? <OverflowFade placement="right" /> : null}
    </div>
  );
}

const SHORTCUTS: ReadonlyArray<{
  title: string;
  keys: ReadonlyArray<[label: string, keys: string[]]>;
}> = [
  {
    title: "Everywhere",
    keys: [
      ["Previous or next view", ["[", "]"]],
      ["Filter", ["/"]],
      ["Keyboard shortcuts", ["?"]],
    ],
  },
  {
    title: "Pull requests",
    keys: [
      ["Move between pull requests", ["J", "K"]],
      ["Open, close", ["↵", "Esc"]],
      ["Merge", ["M"]],
      ["Mark ready", ["R"]],
      ["Change the status", ["S"]],
      ["Snooze", ["Z"]],
      ["Start an agent", ["A"]],
      ["Open the agent's thread", ["T"]],
      ["Copy the branch name", ["C"]],
      ["Open on GitHub", ["O"]],
    ],
  },
];

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const returnFocus = useReturnFocus(open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" onCloseAutoFocus={returnFocus}>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        {SHORTCUTS.map((group) => (
          <section key={group.title} className="flex flex-col">
            <SectionHeading>{group.title}</SectionHeading>
            <dl className="flex flex-col">
              {group.keys.map(([label, keys]) => (
                <div
                  key={label}
                  className="flex h-8 items-center gap-3 text-sm text-foreground"
                >
                  <dt className="min-w-0 flex-1 truncate">{label}</dt>
                  <dd className="flex shrink-0 gap-1">
                    {keys.map((key) => (
                      <kbd
                        key={key}
                        className="min-w-5 rounded border border-border px-1 text-center font-sans text-xs text-muted-foreground"
                      >
                        {key}
                      </kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}
