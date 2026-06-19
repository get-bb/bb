import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ThreadListEntry } from "@bb/domain";
import type { ProjectResponse } from "@bb/server-contract";
import {
  BRANCH_NAMES,
  HOST_IDS,
  PROJECT_IDS,
  makeProject as makeSharedProject,
  makeThreadListEntry,
} from "../../../.ladle/story-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { ProjectActionsProvider } from "@/components/project/ProjectActionsProvider";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import {
  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
  COARSE_POINTER_GLYPH_BOX_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
  COARSE_POINTER_ROW_HEIGHT_CLASS,
} from "@/components/ui/coarse-pointer-sizing.js";
import { Icon, type IconName } from "@/components/ui/icon.js";
import { SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar.js";
import { cn } from "@/lib/utils";
import { ProjectListShell } from "./ProjectList";
import type { ProjectThreadListState } from "./ProjectRow";
import {
  ProjectListProjects,
  type ProjectListRowModel,
} from "./ProjectListProjects";
import { compareStandardThreads } from "./projectThreadGroups";
import {
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_ROW_GLYPH_SLOT_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  SIDEBAR_ROW_SELECTED_STATE_CLASS,
  SIDEBAR_SUCCESS_STATUS_COLOR_CLASS,
  SIDEBAR_SUCCESS_STATUS_DOT_CLASS,
  SIDEBAR_WORKING_STATUS_COLOR_CLASS,
  getSidebarThreadRowPaddingLeft,
} from "./sidebarRowClasses";
import { ThreadRow, type ThreadRowOptions } from "./ThreadRow";

export default {
  title: "sidebar/Status Notifications",
};

const noop = () => {};

const makeProject = (overrides: Partial<ProjectResponse> = {}) =>
  makeSharedProject({ id: PROJECT_IDS.bb, name: "bb", ...overrides });

const makeThread = (overrides: Partial<ThreadListEntry> = {}) =>
  makeThreadListEntry({ id: "thr_default", ...overrides });

const defaultThreadOption: ThreadRowOptions = {
  kind: "default",
  depth: 1,
  isCompact: false,
};

function SidebarFrame({ children }: { children: ReactNode }) {
  return (
    <ProjectActionsProvider>
      <ThreadActionsProvider>
        <div className="w-full max-w-[460px] min-w-0 rounded-md bg-sidebar p-2 text-sidebar-foreground">
          {children}
        </div>
      </ThreadActionsProvider>
    </ProjectActionsProvider>
  );
}

function ThreadRowStage({ children }: { children: ReactNode }) {
  return (
    <SidebarFrame>
      <SidebarMenu className="gap-2">
        <SidebarMenuItem>
          <div className="space-y-0.5">{children}</div>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFrame>
  );
}

function PrototypeStage({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-[460px] min-w-0 rounded-md bg-sidebar p-2 text-sidebar-foreground">
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

type ToggleStoryCollapsedId = (id: string) => void;

function toggleStoryCollapsedId(
  current: ReadonlySet<string>,
  id: string,
): Set<string> {
  const next = new Set(current);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

interface StoryProjectRow {
  project?: ProjectResponse;
  threadListState: ProjectThreadListState;
  isActive?: boolean;
  initiallyCollapsed?: boolean;
}

interface InteractiveProjectListArgs {
  rows: StoryProjectRow[];
  initialCollapsedThreadIds?: ReadonlySet<string>;
  initialCollapsedEnvironmentIds?: ReadonlySet<string>;
}

function InteractiveProjectList({
  rows,
  initialCollapsedThreadIds,
  initialCollapsedEnvironmentIds,
}: InteractiveProjectListArgs) {
  const resolvedRows: ProjectListRowModel[] = rows.map((row) => ({
    project: row.project ?? makeProject(),
    threadListState: row.threadListState,
    isActive: row.isActive ?? false,
    isLocalPathInvalid: false,
  }));
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(
    () =>
      new Set(
        rows.flatMap((row, index) =>
          row.initiallyCollapsed ? [resolvedRows[index].project.id] : [],
        ),
      ),
  );
  const [collapsedThreadIds, setCollapsedThreadIds] = useState<Set<string>>(
    () => new Set(initialCollapsedThreadIds ?? []),
  );
  const [collapsedEnvironmentIds, setCollapsedEnvironmentIds] = useState<
    Set<string>
  >(() => new Set(initialCollapsedEnvironmentIds ?? []));
  const onToggleProjectCollapsed = useCallback<ToggleStoryCollapsedId>((id) => {
    setCollapsedProjectIds((current) => toggleStoryCollapsedId(current, id));
  }, []);
  const onToggleThreadCollapsed = useCallback<ToggleStoryCollapsedId>((id) => {
    setCollapsedThreadIds((current) => toggleStoryCollapsedId(current, id));
  }, []);
  const onToggleEnvironmentCollapsed = useCallback<ToggleStoryCollapsedId>(
    (id) => {
      setCollapsedEnvironmentIds((current) =>
        toggleStoryCollapsedId(current, id),
      );
    },
    [],
  );

  return (
    <ProjectListProjects
      status="ready"
      rows={resolvedRows}
      collapsedProjectIds={collapsedProjectIds}
      collapsedThreadIds={collapsedThreadIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      compareThreads={compareStandardThreads}
      onCreateProjectThread={noop}
      onToggleProjectCollapsed={onToggleProjectCollapsed}
      onToggleThreadCollapsed={onToggleThreadCollapsed}
      onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
    />
  );
}

function ProjectListStage(props: InteractiveProjectListArgs) {
  return (
    <SidebarFrame>
      <ProjectListShell>
        <InteractiveProjectList {...props} />
      </ProjectListShell>
    </SidebarFrame>
  );
}

interface StoryThreadRowProps {
  thread: ThreadListEntry;
  isActive?: boolean;
  hasComposerDraft?: boolean;
  options?: ThreadRowOptions;
}

function StoryThreadRow({
  thread,
  isActive = false,
  hasComposerDraft = false,
  options = defaultThreadOption,
}: StoryThreadRowProps) {
  return (
    <ThreadRow
      projectId={PROJECT_IDS.bb}
      thread={thread}
      isActive={isActive}
      hasComposerDraft={hasComposerDraft}
      options={options}
    />
  );
}

type StatusId = "idle" | "working" | "needsUser" | "unreadDone" | "unreadError";

interface StatusRule {
  id: StatusId;
  visualWeight: string;
  label: string;
  userMeaning: string;
  currentTreatment: string;
  proposedTreatment: string;
  ariaLabel: string;
}

const STATUS_RULES: readonly StatusRule[] = [
  {
    id: "idle",
    visualWeight: "0 - none",
    label: "Idle",
    userMeaning: "Nothing new is happening.",
    currentTreatment: "No mark",
    proposedTreatment: "No mark",
    ariaLabel: "Thread idle",
  },
  {
    id: "working",
    visualWeight: "1 - most subtle",
    label: "Working",
    userMeaning: "The agent is still running; no action is needed.",
    currentTreatment: "Muted spinner",
    proposedTreatment: "Faint muted Spinner icon",
    ariaLabel: "Thread working",
  },
  {
    id: "unreadDone",
    visualWeight: "2 - subtle",
    label: "Unread success",
    userMeaning: "The agent succeeded; the user can read it when convenient.",
    currentTreatment: "Foreground dot",
    proposedTreatment: "Subtle CircleCheck, then muted unread dot",
    ariaLabel: "Unread thread succeeded",
  },
  {
    id: "needsUser",
    visualWeight: "3 - clear",
    label: "Input needed",
    userMeaning: "The agent is stuck until the user answers or approves.",
    currentTreatment: "Attention dot",
    proposedTreatment: "Lighter grey MessageQuestion icon",
    ariaLabel: "Thread needs user input",
  },
  {
    id: "unreadError",
    visualWeight: "4 - loudest",
    label: "Failed",
    userMeaning: "The latest unread result failed.",
    currentTreatment: "Destructive dot",
    proposedTreatment: "Destructive CircleX icon",
    ariaLabel: "Unread thread failed",
  },
];

const idleThread = makeThread({
  id: "thr_status_idle",
  title: "Audit permission failure reports",
  titleFallback: "Audit permission failure reports",
});

const workingThread = makeThread({
  id: "thr_status_working",
  title: "Refactor sidebar grouping",
  titleFallback: "Refactor sidebar grouping",
  status: "active",
  runtime: {
    displayStatus: "active",
    hostReconnectGraceExpiresAt: null,
  },
});

const needsUserThread = makeThread({
  id: "thr_status_needs_user",
  title: "Approve migration cleanup",
  titleFallback: "Approve migration cleanup",
  status: "active",
  hasPendingInteraction: true,
  runtime: {
    displayStatus: "active",
    hostReconnectGraceExpiresAt: null,
  },
});

const unreadDoneThread = makeThread({
  id: "thr_status_unread_done",
  title: "Summarize release notes",
  titleFallback: "Summarize release notes",
  lastReadAt: 50,
  latestAttentionAt: 200,
});

const unreadErrorThread = makeThread({
  id: "thr_status_unread_error",
  title: "Run integration test sweep",
  titleFallback: "Run integration test sweep",
  status: "error",
  lastReadAt: 50,
  latestAttentionAt: 200,
});

const longDraftThread = makeThread({
  id: "thr_status_long_draft",
  title:
    "Write a careful follow-up about the intermittent sidebar grouping bug after the next deploy",
  titleFallback:
    "Write a careful follow-up about the intermittent sidebar grouping bug",
  lastReadAt: 50,
  latestAttentionAt: 200,
});

const parentThread = makeThread({
  id: "thr_status_parent",
  title: "Codex parent",
  titleFallback: "Codex parent",
});

const parentWorkingChild = makeThread({
  id: "thr_status_parent_working_child",
  title: "Trace prompt queue ordering",
  titleFallback: "Trace prompt queue ordering",
  parentThreadId: parentThread.id,
  status: "active",
  runtime: {
    displayStatus: "active",
    hostReconnectGraceExpiresAt: null,
  },
});

const parentNeedsUserChild = makeThread({
  id: "thr_status_parent_needs_user_child",
  title: "Answer permission prompt",
  titleFallback: "Answer permission prompt",
  parentThreadId: parentThread.id,
  hasPendingInteraction: true,
});

const worktreeThreadA = makeThread({
  id: "thr_status_worktree_a",
  title: "Update sidebar state stories",
  titleFallback: "Update sidebar state stories",
  environmentId: "env_status_worktree",
  environmentHostId: HOST_IDS.local,
  environmentBranchName: "bb/sidebar-status-notification-redo",
  environmentWorkspaceDisplayKind: "managed-worktree",
});

const worktreeThreadB = makeThread({
  id: "thr_status_worktree_b",
  title: "Validate dense sidebar rollups",
  titleFallback: "Validate dense sidebar rollups",
  environmentId: "env_status_worktree",
  environmentHostId: HOST_IDS.local,
  environmentBranchName: "bb/sidebar-status-notification-redo",
  environmentWorkspaceDisplayKind: "managed-worktree",
  status: "error",
  lastReadAt: 50,
  latestAttentionAt: 200,
});

const productionRollupThreads: ThreadListEntry[] = [
  {
    ...parentThread,
    projectId: PROJECT_IDS.bb,
    environmentHostId: HOST_IDS.local,
    environmentBranchName: BRANCH_NAMES.default,
    environmentWorkspaceDisplayKind: "managed-worktree",
  },
  { ...parentWorkingChild, projectId: PROJECT_IDS.bb },
  { ...parentNeedsUserChild, projectId: PROJECT_IDS.bb },
  {
    ...workingThread,
    id: "thr_status_root_working",
    projectId: PROJECT_IDS.bb,
  },
  { ...unreadDoneThread, projectId: PROJECT_IDS.bb },
];

const productionWorktreeThreads: ThreadListEntry[] = [
  { ...worktreeThreadA, projectId: PROJECT_IDS.bb },
  { ...worktreeThreadB, projectId: PROJECT_IDS.bb },
];

export function StateTaxonomy() {
  return (
    <StoryCard labelWidth="160px">
      <StoryRow
        label="First-principles hierarchy"
        hint="The taxonomy is the source of truth for every prototype below."
      >
        <div className="w-full max-w-[900px] overflow-hidden rounded-md border border-border bg-background text-sm">
          <table className="w-full border-collapse">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Weight</th>
                <th className="px-3 py-2 font-medium">State</th>
                <th className="px-3 py-2 font-medium">Meaning</th>
                <th className="px-3 py-2 font-medium">Current</th>
                <th className="px-3 py-2 font-medium">Target</th>
              </tr>
            </thead>
            <tbody>
              {STATUS_RULES.map((rule) => (
                <tr key={rule.id} className="border-t border-border">
                  <td className="px-3 py-2 text-muted-foreground">
                    {rule.visualWeight}
                  </td>
                  <td className="px-3 py-2 font-medium">{rule.label}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {rule.userMeaning}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {rule.currentTreatment}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {rule.proposedTreatment}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </StoryRow>
    </StoryCard>
  );
}

export function ProductionBaseline() {
  return (
    <StoryCard labelWidth="230px">
      <StoryRow
        label="leaf rows"
        hint="Real ThreadRow today: one trailing slot, pending > working > unread."
      >
        <ThreadRowStage>
          <StoryThreadRow thread={idleThread} />
          <StoryThreadRow thread={workingThread} />
          <StoryThreadRow thread={needsUserThread} />
          <StoryThreadRow thread={unreadDoneThread} />
          <StoryThreadRow thread={unreadErrorThread} />
        </ThreadRowStage>
      </StoryRow>
      <StoryRow
        label="active + draft + long title"
        hint="Real geometry constraint: title truncates before draft and status marks."
      >
        <ThreadRowStage>
          <StoryThreadRow thread={longDraftThread} isActive hasComposerDraft />
        </ThreadRowStage>
      </StoryRow>
      <StoryRow
        label="collapsed parent rollup"
        hint="Real ProjectList path: hidden child pending wins over hidden child working."
      >
        <ProjectListStage
          rows={[
            {
              threadListState: {
                status: "ready",
                threads: productionRollupThreads,
              },
            },
          ]}
          initialCollapsedThreadIds={new Set([parentThread.id])}
        />
      </StoryRow>
      <StoryRow
        label="collapsed worktree rollup"
        hint="Real ProjectList path: hidden unread failure paints the worktree header red."
      >
        <ProjectListStage
          rows={[
            {
              threadListState: {
                status: "ready",
                threads: productionWorktreeThreads,
              },
            },
          ]}
          initialCollapsedEnvironmentIds={new Set(["env_status_worktree"])}
        />
      </StoryRow>
    </StoryCard>
  );
}

type PrototypeKind = "thread" | "parent" | "worktree";

interface PrototypeRowData {
  id: string;
  title: string;
  kind: PrototypeKind;
  state: StatusId;
  active?: boolean;
  count?: number;
}

const PROTOTYPE_ROWS: readonly PrototypeRowData[] = [
  {
    id: "needs-user",
    title: "Approve migration cleanup",
    kind: "thread",
    state: "needsUser",
  },
  {
    id: "working",
    title: "Refactor sidebar grouping",
    kind: "thread",
    state: "working",
    active: true,
  },
  {
    id: "parent-needs-user",
    title: "Codex parent",
    kind: "parent",
    state: "needsUser",
    count: 1,
  },
  {
    id: "parent-working",
    title: "Timeline workers",
    kind: "parent",
    state: "working",
    count: 4,
  },
  {
    id: "worktree-error",
    title: "bb/sidebar-status-notification-redo",
    kind: "worktree",
    state: "unreadError",
    count: 2,
  },
  {
    id: "unread-done",
    title: "Summarize release notes",
    kind: "thread",
    state: "unreadDone",
  },
  {
    id: "idle",
    title: "Draft launch checklist",
    kind: "thread",
    state: "idle",
  },
];

type HiddenRollupSignal = Exclude<StatusId, "idle">;

const HIDDEN_ROLLUP_COMBOS: readonly (readonly HiddenRollupSignal[])[] = [
  ["working"],
  ["unreadDone"],
  ["needsUser"],
  ["unreadError"],
  ["working", "unreadDone"],
  ["working", "needsUser"],
  ["working", "unreadError"],
  ["unreadDone", "needsUser"],
  ["unreadDone", "unreadError"],
  ["needsUser", "unreadError"],
  ["working", "unreadDone", "needsUser"],
  ["working", "unreadDone", "unreadError"],
  ["working", "needsUser", "unreadError"],
  ["unreadDone", "needsUser", "unreadError"],
  ["working", "unreadDone", "needsUser", "unreadError"],
];

const HIDDEN_SIGNAL_LABEL: Record<HiddenRollupSignal, string> = {
  working: "Working",
  unreadDone: "Unread success",
  needsUser: "Input needed",
  unreadError: "Failed",
};

const HIDDEN_SIGNAL_ICON: Record<HiddenRollupSignal, IconName> = {
  working: "Spinner",
  unreadDone: "CircleCheck",
  needsUser: "MessageQuestion",
  unreadError: "CircleX",
};

const HIDDEN_SIGNAL_CLASS: Record<HiddenRollupSignal, string> = {
  working: SIDEBAR_WORKING_STATUS_COLOR_CLASS,
  unreadDone: SIDEBAR_SUCCESS_STATUS_COLOR_CLASS,
  needsUser: "text-muted-foreground/75",
  unreadError: "text-destructive",
};

const QUESTION_ICON_CLASS = "text-muted-foreground/75";
const SUCCESS_ICON_CLASS = SIDEBAR_SUCCESS_STATUS_COLOR_CLASS;
const SUCCESS_CHECK_DELAY_MS = 1200;
const SUCCESS_TRANSITION_WORKING_MS = 500;
const SUCCESS_TRANSITION_SUCCESS_MS = 1600;
const SUCCESS_TRANSITION_SETTLED_MS = 650;

type SuccessTransitionPhase = "working" | "success" | "settled";

const SUCCESS_TRANSITION_STEPS: readonly {
  phase: SuccessTransitionPhase;
  durationMs: number;
}[] = [
  { phase: "working", durationMs: SUCCESS_TRANSITION_WORKING_MS },
  { phase: "success", durationMs: SUCCESS_TRANSITION_SUCCESS_MS },
  { phase: "settled", durationMs: SUCCESS_TRANSITION_SETTLED_MS },
];

function StatusIcon({
  name,
  className,
  title,
  sizeClassName = COARSE_POINTER_ICON_SIZE_CLASS,
  spin = false,
}: {
  name: IconName;
  className: string;
  title: string;
  sizeClassName?: string;
  spin?: boolean;
}) {
  return (
    <span
      role="status"
      title={title}
      aria-label={title}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center"
    >
      <Icon
        name={name}
        className={cn(sizeClassName, spin && "animate-spin", className)}
        aria-hidden="true"
      />
    </span>
  );
}

function Spinner({ subtle = false }: { subtle?: boolean }) {
  return (
    <StatusIcon
      name="Spinner"
      className={
        subtle ? SIDEBAR_WORKING_STATUS_COLOR_CLASS : "text-muted-foreground"
      }
      spin
      title="Thread working"
    />
  );
}

function SuccessDot({ title }: { title: string }) {
  return (
    <span
      role="status"
      title={title}
      aria-label={title}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center"
    >
      <span
        className={SIDEBAR_SUCCESS_STATUS_DOT_CLASS}
        aria-hidden="true"
      />
    </span>
  );
}

function SuccessIndicator({ title }: { title: string }) {
  const [showCheck, setShowCheck] = useState(true);

  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => setShowCheck(false),
      SUCCESS_CHECK_DELAY_MS,
    );
    return () => window.clearTimeout(timeoutId);
  }, []);

  if (!showCheck) {
    return <SuccessDot title={title} />;
  }

  return (
    <StatusIcon
      name="CircleCheck"
      className={SUCCESS_ICON_CLASS}
      title={title}
    />
  );
}

function SuccessTransitionStatus({ phase }: { phase: SuccessTransitionPhase }) {
  switch (phase) {
    case "working":
      return <Spinner subtle />;
    case "success":
      return (
        <StatusIcon
          name="CircleCheck"
          className={SUCCESS_ICON_CLASS}
          title="Thread succeeded"
        />
      );
    case "settled":
      return <SuccessDot title="Unread success" />;
  }
}

function rowIconName(kind: PrototypeKind): IconName | null {
  switch (kind) {
    case "parent":
      return "ChevronRight";
    case "worktree":
      return "FolderGit";
    case "thread":
      return null;
  }
}

function rowDepth(kind: PrototypeKind): number {
  return kind === "thread" ? 1 : 1;
}

function rollupLabel(row: PrototypeRowData, singular: string, plural: string) {
  if (!row.count || row.kind === "thread") {
    return singular;
  }
  return `${row.count} ${row.count === 1 ? singular : plural}`;
}

function strongestHiddenSignal(
  signals: readonly HiddenRollupSignal[],
): HiddenRollupSignal {
  if (signals.includes("unreadError")) {
    return "unreadError";
  }
  if (signals.includes("needsUser")) {
    return "needsUser";
  }
  if (signals.includes("unreadDone")) {
    return "unreadDone";
  }
  return "working";
}

function hiddenSignalIcons(signals: readonly HiddenRollupSignal[]) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      {signals.map((signal) => (
        <span key={signal} className="inline-flex">
          {signal === "unreadDone" ? (
            <SuccessIndicator title={HIDDEN_SIGNAL_LABEL[signal]} />
          ) : (
            <StatusIcon
              name={HIDDEN_SIGNAL_ICON[signal]}
              className={HIDDEN_SIGNAL_CLASS[signal]}
              spin={signal === "working"}
              title={HIDDEN_SIGNAL_LABEL[signal]}
            />
          )}
        </span>
      ))}
    </span>
  );
}

function RollupPreview({
  kind,
  combo,
}: {
  kind: Extract<PrototypeKind, "parent" | "worktree">;
  combo: readonly HiddenRollupSignal[];
}) {
  const strongest = strongestHiddenSignal(combo);
  const row: PrototypeRowData = {
    id: `${kind}-${combo.join("-")}`,
    title: kind === "parent" ? "Collapsed parent" : "Worktree header",
    kind,
    state: strongest,
  };

  return (
    <div className="w-[300px] min-w-0 rounded-md bg-sidebar p-1 text-sidebar-foreground">
      <PrototypeRow row={row} status={renderRecommendedStatus(row)} />
    </div>
  );
}

function renderOptionAStatus(row: PrototypeRowData) {
  switch (row.state) {
    case "needsUser":
      return (
        <StatusIcon
          name="MessageQuestion"
          className={QUESTION_ICON_CLASS}
          title={rollupLabel(row, "needs user input", "need user input")}
        />
      );
    case "unreadError":
      return (
        <StatusIcon
          name="CircleX"
          className="text-destructive"
          title={rollupLabel(row, "failed", "failed")}
        />
      );
    case "working":
      return <Spinner subtle />;
    case "unreadDone":
      return (
        <SuccessIndicator
          title={rollupLabel(row, "unread success", "unread successes")}
        />
      );
    case "idle":
      return null;
  }
}

function renderOptionBStatus(row: PrototypeRowData) {
  switch (row.state) {
    case "needsUser":
      return (
        <StatusIcon
          name="MessageQuestion"
          className={QUESTION_ICON_CLASS}
          title={rollupLabel(row, "needs user input", "need user input")}
        />
      );
    case "unreadError":
      return (
        <StatusIcon
          name="CircleX"
          className="text-destructive"
          title={rollupLabel(row, "failed", "failed")}
        />
      );
    case "working":
      return <Spinner subtle />;
    case "unreadDone":
      return (
        <SuccessIndicator
          title={rollupLabel(row, "unread success", "unread successes")}
        />
      );
    case "idle":
      return null;
  }
}

function renderOptionCStatus(row: PrototypeRowData) {
  return renderRecommendedStatus(row);
}

function renderRecommendedStatus(row: PrototypeRowData) {
  switch (row.state) {
    case "needsUser":
      return (
        <StatusIcon
          name="MessageQuestion"
          className={QUESTION_ICON_CLASS}
          title={rollupLabel(row, "needs user input", "need user input")}
        />
      );
    case "unreadError":
      return (
        <StatusIcon
          name="CircleX"
          className="text-destructive"
          title={rollupLabel(row, "failed", "failed")}
        />
      );
    case "working":
      return <Spinner subtle />;
    case "unreadDone":
      return <SuccessIndicator title="Unread success" />;
    case "idle":
      return null;
  }
}

function railClassForState(state: StatusId): string | null {
  switch (state) {
    case "needsUser":
      return "bg-attention";
    case "unreadError":
      return "bg-destructive";
    case "working":
      return "bg-foreground/25";
    case "unreadDone":
      return "bg-foreground/35";
    case "idle":
      return null;
  }
}

interface PrototypeRowProps {
  row: PrototypeRowData;
  status: ReactNode;
  rail?: boolean;
  showRowState?: boolean;
  wideStatus?: boolean;
}

function PrototypeRow({
  row,
  status,
  rail = false,
  showRowState = true,
  wideStatus = false,
}: PrototypeRowProps) {
  const iconName = rowIconName(row.kind);
  const railClassName = rail ? railClassForState(row.state) : null;

  return (
    <div
      className={cn(
        SIDEBAR_ROW_BASE_CLASS,
        COARSE_POINTER_ROW_HEIGHT_CLASS,
        showRowState &&
          (row.active
            ? SIDEBAR_ROW_SELECTED_STATE_CLASS
            : SIDEBAR_ROW_INTERACTIVE_STATE_CLASS),
        "relative overflow-hidden",
      )}
      style={{
        paddingLeft: getSidebarThreadRowPaddingLeft(rowDepth(row.kind)),
      }}
    >
      {railClassName ? (
        <span
          className={cn(
            "absolute bottom-1 left-0 top-1 w-[2px] rounded-full",
            railClassName,
          )}
          aria-hidden="true"
        />
      ) : null}
      {iconName ? (
        <span
          className={cn(
            SIDEBAR_ROW_GLYPH_SLOT_CLASS,
            COARSE_POINTER_GLYPH_BOX_CLASS,
          )}
          aria-hidden="true"
        >
          <Icon
            name={iconName}
            className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
          />
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="min-w-0 truncate">{row.title}</span>
      </span>
      <span
        className={cn(
          "ml-auto flex shrink-0 items-center justify-end pr-1",
          wideStatus
            ? "h-7 min-w-[5.5rem]"
            : COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
        )}
      >
        <span
          className={cn(
            "inline-flex items-center justify-center",
            !wideStatus && COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
          )}
        >
          {status}
        </span>
      </span>
    </div>
  );
}

interface PrototypeListProps {
  renderStatus: (row: PrototypeRowData) => ReactNode;
  rail?: boolean;
  wideStatus?: boolean;
}

function PrototypeList({ renderStatus, rail, wideStatus }: PrototypeListProps) {
  return (
    <PrototypeStage>
      {PROTOTYPE_ROWS.map((row) => (
        <PrototypeRow
          key={row.id}
          row={row}
          status={renderStatus(row)}
          rail={rail}
          wideStatus={wideStatus}
        />
      ))}
    </PrototypeStage>
  );
}

function SuccessTransitionAnimationPreview() {
  const [stepIndex, setStepIndex] = useState(0);
  const step = SUCCESS_TRANSITION_STEPS[stepIndex];
  const row: PrototypeRowData = {
    id: "success-transition",
    title: "Summarize release notes",
    kind: "thread",
    state: step.phase === "working" ? "working" : "unreadDone",
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setStepIndex(
        (current) => (current + 1) % SUCCESS_TRANSITION_STEPS.length,
      );
    }, step.durationMs);
    return () => window.clearTimeout(timeoutId);
  }, [step.durationMs, step.phase, stepIndex]);

  return (
    <PrototypeStage>
      <PrototypeRow
        row={row}
        status={<SuccessTransitionStatus phase={step.phase} />}
        showRowState={false}
      />
    </PrototypeStage>
  );
}

export function Alternatives() {
  return (
    <StoryCard labelWidth="180px">
      <StoryRow
        label="A. Icon only"
        hint="Colored icons only: quiet working, subtle unread success, clearer input-needed, loud failure."
      >
        <PrototypeList renderStatus={renderOptionAStatus} />
      </StoryRow>
      <StoryRow
        label="B. Timeline glyphs"
        hint="Question, success, failure, and spinner icons borrowed from timeline states."
      >
        <PrototypeList renderStatus={renderOptionBStatus} />
      </StoryRow>
      <StoryRow
        label="C. Hidden rollups"
        hint="Collapsed parents and worktrees use the strongest hidden state icon, with no count container."
      >
        <PrototypeList renderStatus={renderOptionCStatus} />
      </StoryRow>
    </StoryCard>
  );
}

export function WorkingToSuccessAnimation() {
  return (
    <StoryCard labelWidth="210px">
      <StoryRow
        label="working -> success -> settle"
        hint="Loops 500ms muted spinner, 1600ms subtle CircleCheck, then 650ms muted unread dot."
      >
        <SuccessTransitionAnimationPreview />
      </StoryRow>
    </StoryCard>
  );
}

export function RecommendedDirection() {
  return (
    <StoryCard labelWidth="210px">
      <StoryRow
        label="recommended system"
        hint="Use colored icons only. Input needed borrows the timeline question icon."
      >
        <PrototypeList renderStatus={renderRecommendedStatus} />
      </StoryRow>
      <StoryRow
        label="build spec"
        hint="Concrete rules for the production pass after approval."
      >
        <div className="max-w-[720px] rounded-md border border-border bg-background p-4 text-sm text-muted-foreground">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <h3 className="mb-1 text-sm font-medium text-foreground">
                Leaf rows
              </h3>
              <ul className="space-y-1">
                <li>Idle: no marker.</li>
                <li>Working: faint muted `Spinner` icon.</li>
                <li>
                  Unread success: subtle muted `CircleCheck`, then a muted dot
                  after 1200ms.
                </li>
                <li>Input needed: lighter grey `MessageQuestion` icon.</li>
                <li>Failed: destructive `CircleX` icon only.</li>
              </ul>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-medium text-foreground">
                Hidden rollups
              </h3>
              <ul className="space-y-1">
                <li>
                  Preserve visual weight: working, unread success, input needed,
                  failed.
                </li>
                <li>
                  Roll up to the strongest hidden state and render that icon
                  only.
                </li>
                <li>
                  Use one fixed trailing status column before hover actions.
                </li>
                <li>Keep current aria labels, adding counts where present.</li>
                <li>Keep red reserved for actual failure.</li>
              </ul>
            </div>
          </div>
        </div>
      </StoryRow>
    </StoryCard>
  );
}

export function HiddenRollupCombinations() {
  return (
    <StoryCard labelWidth="190px">
      <StoryRow
        label="all hidden combos"
        hint="Winner is the strongest hidden state present: working < unread success < input needed < failed."
      >
        <div className="w-full max-w-[1120px] overflow-x-auto rounded-md border border-border bg-background text-sm">
          <div className="grid min-w-[900px] grid-cols-[minmax(180px,1fr)_96px_300px_300px] items-center gap-x-3 border-b border-border bg-muted/35 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>Hidden children</span>
            <span>Rollup state</span>
            <span>Collapsed parent</span>
            <span>Worktree header</span>
          </div>
          <div className="divide-y divide-border">
            {HIDDEN_ROLLUP_COMBOS.map((combo) => {
              const strongest = strongestHiddenSignal(combo);
              return (
                <div
                  key={combo.join("-")}
                  className="grid min-w-[900px] grid-cols-[minmax(180px,1fr)_96px_300px_300px] items-center gap-x-3 px-3 py-2"
                >
                  {hiddenSignalIcons(combo)}
                  <span className="inline-flex items-center justify-start">
                    {strongest === "unreadDone" ? (
                      <SuccessIndicator
                        title={HIDDEN_SIGNAL_LABEL[strongest]}
                      />
                    ) : (
                      <StatusIcon
                        name={HIDDEN_SIGNAL_ICON[strongest]}
                        className={HIDDEN_SIGNAL_CLASS[strongest]}
                        spin={strongest === "working"}
                        title={HIDDEN_SIGNAL_LABEL[strongest]}
                      />
                    )}
                  </span>
                  <RollupPreview kind="parent" combo={combo} />
                  <RollupPreview kind="worktree" combo={combo} />
                </div>
              );
            })}
          </div>
        </div>
      </StoryRow>
    </StoryCard>
  );
}
