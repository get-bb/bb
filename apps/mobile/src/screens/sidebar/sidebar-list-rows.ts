import {
  hasActiveBackgroundAgentActivity,
  hasActiveBackgroundCommandActivity,
  hasActiveGoalActivity,
  hasActivePlanModeActivity,
  hasActiveWorkflowActivity,
  isRuntimeBusyThread,
  isUnreadDoneThread,
  NO_COLLAPSED_CHILD_ACTIVITY,
  resolveThreadListIndicator,
  type CollapsedChildActivity,
  type ProjectThreadItem,
  type ProjectThreadNode,
  type SidebarSectionDefinition,
  type SidebarSectionId,
  type ThreadListIndicatorKind,
  type ThreadListIndicatorState,
} from "@bb/client-core";
import type { ThreadListEntry } from "@bb/domain";
import type {
  SidebarGroup,
  SidebarModel,
  SidebarProject,
} from "@/data/sidebar/sidebar-model";

/**
 * Pure projection of a `SidebarModel` plus the collapse state onto the flat
 * row list a virtualized list renders (mirrors the nesting rules of
 * apps/app/src/components/sidebar/ProjectList.tsx: built-in sections, one
 * header per group, environment groups, parent threads with children,
 * sections). Renderers switch on `row.type`; keys are stable per entity so
 * realtime refreshes keep row identity.
 */

export interface SidebarCollapsedState {
  projectIds: ReadonlySet<string>;
  threadIds: ReadonlySet<string>;
  environmentIds: ReadonlySet<string>;
  sectionKeys: ReadonlySet<string>;
  machineKeys: ReadonlySet<string>;
  builtInSections: ReadonlySet<string>;
}

type SidebarHeaderTarget =
  | { kind: "pinned" }
  | { kind: "project"; project: SidebarProject }
  | { kind: "machine"; key: string }
  | { kind: "section"; section: SidebarSectionDefinition; sectionKey: string }
  | { kind: "threads" };

export interface SidebarHeaderRow {
  type: "header";
  key: string;
  label: string;
  target: SidebarHeaderTarget;
  /** 0 for top-level groups; nested sections indent like their siblings. */
  depth: number;
  collapsed: boolean;
  /** Every thread the group covers (roots and descendants). */
  threadCount: number;
  /** Rolled-up activity shown in place of the hidden rows while collapsed. */
  activity: CollapsedChildActivity;
}

export interface SidebarThreadRow {
  type: "thread";
  key: string;
  thread: ThreadListEntry;
  depth: number;
  childCount: number;
  /** Whether the children are hidden (only meaningful with `childCount > 0`). */
  collapsed: boolean;
  /** The single trailing status glyph for this row (own state + hidden children). */
  indicator: ThreadListIndicatorKind;
}

export interface SidebarEnvironmentRow {
  type: "environment";
  key: string;
  environmentId: string;
  label: string;
  depth: number;
  collapsed: boolean;
  threadCount: number;
  activity: CollapsedChildActivity;
  representativeThread: ThreadListEntry;
}

export interface SidebarEmptyRow {
  type: "empty";
  key: string;
  label: string;
  depth: number;
}

export type SidebarListRow =
  | SidebarHeaderRow
  | SidebarThreadRow
  | SidebarEnvironmentRow
  | SidebarEmptyRow;

const PINNED_SECTION_KEY = "pinned";
const THREADS_SECTION_KEY = "threads";

/** Label of an environment group row (web `EnvironmentThreadGroupHeader`). */
function getEnvironmentGroupLabel(
  representativeThread: Pick<
    ThreadListEntry,
    "environmentName" | "environmentBranchName"
  >,
): string {
  return (
    representativeThread.environmentName ||
    representativeThread.environmentBranchName ||
    "Worktree"
  );
}

/** The indicator state of a thread row on its own (no hidden children). */
function getThreadIndicatorState(
  thread: ThreadListEntry,
  hasUnsubmittedDraft = false,
): ThreadListIndicatorState {
  const unreadDone = isUnreadDoneThread(thread);
  const unreadError = unreadDone && thread.status === "error";
  return {
    hasPendingInteraction: thread.hasPendingInteraction,
    hasUnsubmittedDraft,
    hasUnreadError: unreadError,
    hasUnreadSuccess: unreadDone && !unreadError,
    isBackgroundAgentActive: hasActiveBackgroundAgentActivity(thread),
    isBackgroundCommandActive: hasActiveBackgroundCommandActivity(thread),
    isGoalActive: hasActiveGoalActivity(thread),
    isPlanModeActive: hasActivePlanModeActivity(thread),
    isRuntimeActive: isRuntimeBusyThread(thread),
    isWorkflowActive: hasActiveWorkflowActivity(thread),
  };
}

/** Indicator state for a collapsed container standing in for hidden rows. */
export function getCollapsedActivityIndicatorState(
  activity: CollapsedChildActivity,
): ThreadListIndicatorState {
  return {
    hasPendingInteraction: activity.pending,
    hasUnsubmittedDraft: activity.hasUnsubmittedDraft,
    hasUnreadError: activity.unreadError,
    hasUnreadSuccess: activity.unread,
    isBackgroundAgentActive: activity.backgroundAgent,
    isBackgroundCommandActive: activity.backgroundCommand,
    isGoalActive: activity.goal,
    isPlanModeActive: activity.planMode,
    isRuntimeActive: activity.runtimeWorking,
    isWorkflowActive: activity.workflow,
  };
}

function mergeIndicatorStates(
  own: ThreadListIndicatorState,
  hidden: ThreadListIndicatorState,
): ThreadListIndicatorState {
  return {
    hasPendingInteraction:
      own.hasPendingInteraction || hidden.hasPendingInteraction,
    hasUnsubmittedDraft: own.hasUnsubmittedDraft || hidden.hasUnsubmittedDraft,
    hasUnreadError: own.hasUnreadError || hidden.hasUnreadError,
    hasUnreadSuccess: own.hasUnreadSuccess || hidden.hasUnreadSuccess,
    isBackgroundAgentActive:
      own.isBackgroundAgentActive || hidden.isBackgroundAgentActive,
    isBackgroundCommandActive:
      own.isBackgroundCommandActive || hidden.isBackgroundCommandActive,
    isGoalActive: own.isGoalActive || hidden.isGoalActive,
    isPlanModeActive: own.isPlanModeActive || hidden.isPlanModeActive,
    isRuntimeActive: own.isRuntimeActive || hidden.isRuntimeActive,
    isWorkflowActive: own.isWorkflowActive || hidden.isWorkflowActive,
  };
}

/**
 * The one trailing glyph of a thread row. A collapsed parent surfaces its own
 * status combined with the rolled-up child activity (the children are hidden
 * behind it); expanded parents and leaves show only their own status.
 */
export function resolveThreadRowIndicator({
  thread,
  hasHiddenChildren,
  childActivity,
}: {
  thread: ThreadListEntry;
  hasHiddenChildren: boolean;
  childActivity: CollapsedChildActivity;
}): ThreadListIndicatorKind {
  const own = getThreadIndicatorState(thread);
  return resolveThreadListIndicator(
    hasHiddenChildren
      ? mergeIndicatorStates(
          own,
          getCollapsedActivityIndicatorState(childActivity),
        )
      : own,
  );
}

/** A flat, depth-0 thread row (search results, archived lists). */
export function flatThreadRow(thread: ThreadListEntry): SidebarThreadRow {
  return {
    type: "thread",
    key: `thread:${thread.id}`,
    thread,
    depth: 0,
    childCount: 0,
    collapsed: false,
    indicator: resolveThreadRowIndicator({
      thread,
      hasHiddenChildren: false,
      childActivity: NO_COLLAPSED_CHILD_ACTIVITY,
    }),
  };
}

interface FlattenContext {
  collapsed: SidebarCollapsedState;
  rows: SidebarListRow[];
}

function pushThreadNode(
  node: ProjectThreadNode,
  depth: number,
  context: FlattenContext,
): void {
  const childCount = node.stats.childCount;
  const collapsed =
    childCount > 0 && context.collapsed.threadIds.has(node.thread.id);
  context.rows.push({
    type: "thread",
    key: `thread:${node.thread.id}`,
    thread: node.thread,
    depth,
    childCount,
    collapsed,
    indicator: resolveThreadRowIndicator({
      thread: node.thread,
      hasHiddenChildren: collapsed,
      childActivity: node.stats.childActivity,
    }),
  });
  if (childCount > 0 && !collapsed) {
    pushItems(node.children, depth + 1, context);
  }
}

function pushItems(
  items: readonly ProjectThreadItem[],
  depth: number,
  context: FlattenContext,
): void {
  for (const item of items) {
    switch (item.kind) {
      case "thread":
        pushThreadNode(item.node, depth, context);
        break;
      case "environment": {
        const group = item.group;
        const collapsed = context.collapsed.environmentIds.has(
          group.environmentId,
        );
        const representativeThread = group.nodes[0].thread;
        context.rows.push({
          type: "environment",
          key: `environment:${group.environmentId}`,
          environmentId: group.environmentId,
          label: getEnvironmentGroupLabel(representativeThread),
          depth,
          collapsed,
          // Environment stats already cover the nodes and their descendants.
          threadCount: group.stats.childCount,
          activity: collapsed
            ? group.stats.childActivity
            : NO_COLLAPSED_CHILD_ACTIVITY,
          representativeThread,
        });
        if (!collapsed) {
          for (const node of group.nodes) {
            pushThreadNode(node, depth + 1, context);
          }
        }
        break;
      }
      case "section": {
        const group = item.group;
        const collapsed = context.collapsed.sectionKeys.has(group.key);
        context.rows.push({
          type: "header",
          key: `section:${group.key}`,
          label: group.name,
          target: {
            kind: "section",
            section: { id: group.id, name: group.name },
            sectionKey: group.key,
          },
          depth,
          collapsed,
          threadCount: group.threadCount,
          activity: collapsed ? group.activity : NO_COLLAPSED_CHILD_ACTIVITY,
        });
        if (!collapsed) {
          pushItems(group.items, depth + 1, context);
        }
        break;
      }
    }
  }
}

function isGroupCollapsed(
  group: SidebarGroup,
  collapsed: SidebarCollapsedState,
): boolean {
  switch (group.kind) {
    case "project":
      return collapsed.projectIds.has(group.project.id);
    case "machine":
      return collapsed.machineKeys.has(group.key);
    case "section":
      return collapsed.sectionKeys.has(group.sectionKey);
    case "threads":
      return collapsed.builtInSections.has(THREADS_SECTION_KEY);
  }
}

function headerTarget(group: SidebarGroup): SidebarHeaderTarget {
  switch (group.kind) {
    case "project":
      return { kind: "project", project: group.project };
    case "machine":
      return { kind: "machine", key: group.key };
    case "section":
      return {
        kind: "section",
        section: group.section,
        sectionKey: group.sectionKey,
      };
    case "threads":
      return { kind: "threads" };
  }
}

interface BuildSidebarListRowsArgs {
  model: SidebarModel;
  collapsed: SidebarCollapsedState;
  /**
   * Top-level section order (`resolveSidebarSectionOrder`). Sections the
   * order does not name keep the model's order after the named ones.
   */
  sectionOrder: readonly SidebarSectionId[];
  /** Copy under an expanded project with no threads. */
  emptyProjectLabel?: string;
}

/** Flatten the model into the rows the list renders, honoring collapse state. */
export function buildSidebarListRows({
  model,
  collapsed,
  sectionOrder,
  emptyProjectLabel = "No threads yet",
}: BuildSidebarListRowsArgs): SidebarListRow[] {
  const rows: SidebarListRow[] = [];
  if (!model.isReady) return rows;

  for (const sectionId of orderTopLevelSections(model, sectionOrder)) {
    if (sectionId === "pinned") pushPinnedRows(model, collapsed, rows);
    else pushGroupRows(model, sectionId, collapsed, emptyProjectLabel, rows);
  }
  return rows;
}

/** Pinned (when shown) plus every group, sorted by the section order. */
function orderTopLevelSections(
  model: SidebarModel,
  sectionOrder: readonly SidebarSectionId[],
): SidebarSectionId[] {
  const present: SidebarSectionId[] = [
    ...(model.pinned ? (["pinned"] as const) : []),
    ...model.groups.map((group) => group.id),
  ];
  const rank = new Map(sectionOrder.map((id, index) => [id, index]));
  return present
    .map((id, index) => ({ id, index }))
    .sort((left, right) => {
      const leftRank = rank.get(left.id) ?? Number.POSITIVE_INFINITY;
      const rightRank = rank.get(right.id) ?? Number.POSITIVE_INFINITY;
      return leftRank === rightRank
        ? left.index - right.index
        : leftRank - rightRank;
    })
    .map((entry) => entry.id);
}

function pushPinnedRows(
  model: SidebarModel,
  collapsed: SidebarCollapsedState,
  rows: SidebarListRow[],
): void {
  if (!model.pinned) return;
  const pinnedCollapsed = collapsed.builtInSections.has(PINNED_SECTION_KEY);
  rows.push({
    type: "header",
    key: "header:pinned",
    label: "Pinned",
    target: { kind: "pinned" },
    depth: 0,
    collapsed: pinnedCollapsed,
    threadCount: model.pinned.threads.length,
    activity: pinnedCollapsed
      ? model.pinned.activity
      : NO_COLLAPSED_CHILD_ACTIVITY,
  });
  if (pinnedCollapsed) return;
  const context: FlattenContext = { collapsed, rows };
  for (const node of model.pinned.rootNodes) {
    pushThreadNode(node, 0, context);
  }
}

function pushGroupRows(
  model: SidebarModel,
  sectionId: SidebarSectionId,
  collapsed: SidebarCollapsedState,
  emptyProjectLabel: string,
  rows: SidebarListRow[],
): void {
  const group = model.groups.find((candidate) => candidate.id === sectionId);
  if (!group) return;
  // The built-in trailing bucket only earns a header when it has rows, except
  // when it is the only thing the sidebar could show.
  if (
    group.kind === "threads" &&
    group.items.length === 0 &&
    (model.groups.length > 1 || model.pinned !== null)
  ) {
    return;
  }
  const isCollapsed = isGroupCollapsed(group, collapsed);
  rows.push({
    type: "header",
    key: `header:${group.id}`,
    label: group.label,
    target: headerTarget(group),
    depth: 0,
    collapsed: isCollapsed,
    threadCount: group.threads.length,
    activity: isCollapsed ? group.activity : NO_COLLAPSED_CHILD_ACTIVITY,
  });
  if (isCollapsed) return;
  if (group.items.length === 0) {
    rows.push({
      type: "empty",
      key: `empty:${group.id}`,
      label: emptyProjectLabel,
      depth: 0,
    });
    return;
  }
  pushItems(group.items, 0, { collapsed, rows });
}

/** Collapse toggle target for a header row (kind + persisted id). */
export function getHeaderCollapseTarget(row: SidebarHeaderRow): {
  kind: "project" | "machine" | "section" | "builtIn";
  id: string;
} {
  switch (row.target.kind) {
    case "pinned":
      return { kind: "builtIn", id: PINNED_SECTION_KEY };
    case "threads":
      return { kind: "builtIn", id: THREADS_SECTION_KEY };
    case "project":
      return { kind: "project", id: row.target.project.id };
    case "machine":
      return { kind: "machine", id: row.target.key };
    case "section":
      return { kind: "section", id: row.target.sectionKey };
  }
}
