import { type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import type {
  EnvironmentStatus,
  GitBranchRefClassification,
  ThreadRuntimeDisplayStatus,
  ThreadTimelinePendingTodoItem,
  ThreadTimelinePendingTodoItemStatus,
  ThreadTimelinePendingTodos,
} from "@bb/domain";
import {
  BranchPicker,
  getMergeBaseBranchCandidateGroups,
} from "@/components/pickers/BranchPicker";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { WorkspaceChangesList } from "@/components/thread/WorkspaceChangesList";
import {
  formatChangeSummary,
  renderChangeSummary,
  toChangeTally,
  type WorkspaceChangedFileSelection,
  type WorkspaceChangedFilesSection,
} from "@/components/workspace/workspace-change-summary";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "@/components/ui/icon.js";

export interface ContextBannerMergeBaseConfig {
  branch: string;
  branchRef?: GitBranchRefClassification | null;
  options?: readonly string[];
  remoteOptions?: readonly string[];
  optionsLoading?: boolean;
  onChange: (branch: string) => void;
  onPickerOpenChange?: (open: boolean) => void;
  onSearchQueryChange?: (query: string) => void;
}

export interface ThreadPromptTodoSection {
  pendingTodos: ThreadTimelinePendingTodos;
}

export interface ThreadPromptGitSection {
  changedFiles: WorkspaceChangedFilesSection;
  mergeBase: ContextBannerMergeBaseConfig | null;
  onPromptBannerFileClick: (selection: WorkspaceChangedFileSelection) => void;
}

export interface ThreadPromptParentThreadSection {
  parentThreadTitle: string;
  href: string;
  /**
   * How the current thread relates to the linked thread: a fork renders
   * "Forked from …", a side chat renders "Side chat of …", any other child
   * renders "Parent …".
   */
  relationship: "parent" | "fork" | "side-chat";
}

/**
 * Single active child surfaced in the parent thread's context banner. The
 * caller is responsible for filtering down to active children — the banner
 * just renders what it's given.
 */
export interface ThreadPromptChildThreadItem {
  id: string;
  title: string;
  href: string;
}

export interface ThreadPromptChildThreadsSection {
  items: readonly ThreadPromptChildThreadItem[];
}

/**
 * Archived-state segment for the banner. When present, the banner renders
 * only this row — archived threads are read-only, so suppressing the other
 * sections keeps the surface focused on "you are looking at a frozen thread".
 */
export interface ThreadPromptArchivedSection {
  archivedAt: number;
}

/**
 * Environment-gone segment for the banner. When present, the banner renders
 * only this row — a destroying/destroyed environment is not a recoverable
 * context for this thread, so live-work sections no longer apply.
 */
export interface ThreadPromptEnvironmentGoneSection {
  status: Extract<EnvironmentStatus, "destroying" | "destroyed">;
}

/**
 * Runtime statuses that count as active child work for the banner's
 * children section. These are the children the banner surfaces and (when the
 * bulk-stop slice lands) the children `Stop all` will target. Keep the set in
 * one place so future status additions don't drift across callers.
 */
const THREAD_BANNER_ACTIVE_CHILD_RUNTIME_STATUSES: ReadonlySet<ThreadRuntimeDisplayStatus> =
  new Set([
    "active",
    "host-reconnecting",
    "provisioning",
    "starting",
    "waiting-for-host",
  ]);

export function isThreadDisplayStatusBannerActive(
  status: ThreadRuntimeDisplayStatus,
): boolean {
  return THREAD_BANNER_ACTIVE_CHILD_RUNTIME_STATUSES.has(status);
}

export type ThreadPromptContextBannerExpandedSection =
  | "todos"
  | "git"
  | "parentThread"
  | "childThreads";

/**
 * Pixel height of the banner's collapsed (single-row) state. Pinned via the
 * outer PromptStackCard's `min-height` so the height is a contract, not a
 * computed coincidence of text size + paddings + border. Imported by
 * FollowUpPromptBox to derive its elastic textarea target — keeping both
 * sides on the same constant means tweaking banner chrome only requires
 * updating this number in one place.
 */
export const THREAD_PROMPT_CONTEXT_BANNER_ROW_HEIGHT = 32;

export interface ThreadPromptContextBannerProps {
  todoSection: ThreadPromptTodoSection | null;
  gitSection: ThreadPromptGitSection | null;
  /**
   * True while the workspace status query for this thread is in flight. Holds
   * banner rendering until the result settles so first paint is the final
   * form — without this, parentThread would render inline then collapse to its
   * icon-only sibling form when git pills arrive.
   */
  gitSectionPending: boolean;
  /**
   * When set, the banner renders the "Thread is archived" row and suppresses
   * todos, git, and child-threads — those represent live work that no
   * longer applies. parentThread still renders alongside if provided, since the
   * parent relationship remains relevant context for a frozen thread.
   */
  archivedSection: ThreadPromptArchivedSection | null;
  /**
   * When set, the banner renders the "environment is no longer available" row
   * and suppresses todos, git, and child-threads. parentThread still renders
   * alongside if provided, since the relationship remains useful context.
   */
  environmentGoneSection: ThreadPromptEnvironmentGoneSection | null;
  parentThreadSection: ThreadPromptParentThreadSection | null;
  childThreadsSection: ThreadPromptChildThreadsSection | null;
  expandedSection: ThreadPromptContextBannerExpandedSection | null;
  onToggleSection: (section: ThreadPromptContextBannerExpandedSection) => void;
}

const KIND_PREFIX: Record<WorkspaceChangedFilesSection["kind"], string> = {
  uncommitted: "Uncommitted",
  untracked: "Untracked",
  committed: "Committed",
};

const ARCHIVED_THREAD_STATUS_LABEL = "Thread is archived";
const ENVIRONMENT_GONE_STATUS_LABEL = "Environment is no longer available";
const ENVIRONMENT_GONE_ARIA_LABEL =
  "Environment is no longer available. This thread can't run any more work.";

// Stable ids for aria-controls / aria-labelledby pairing between each
// section's toggle button and its expanded body region.
const SECTION_IDS = {
  parentThread: {
    toggle: "thread-prompt-banner-parent-thread-toggle",
    body: "thread-prompt-banner-parent-thread-body",
  },
  childThreads: {
    toggle: "thread-prompt-banner-child-threads-toggle",
    body: "thread-prompt-banner-child-threads-body",
  },
  todos: {
    toggle: "thread-prompt-banner-todos-toggle",
    body: "thread-prompt-banner-todos-body",
  },
  git: {
    toggle: "thread-prompt-banner-git-toggle",
    body: "thread-prompt-banner-git-body",
  },
} as const;

const STATUS_SORT_RANK: Record<ThreadTimelinePendingTodoItemStatus, number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
};

function hasObservedTodoItems(
  pendingTodos: ThreadTimelinePendingTodos,
): boolean {
  return pendingTodos.items.length > 0;
}

function renderTodoCounts(
  items: readonly ThreadTimelinePendingTodoItem[],
): ReactNode {
  if (items.length === 0) return null;
  let completedCount = 0;
  for (const item of items) {
    if (item.status === "completed") completedCount += 1;
  }
  if (completedCount === 0) {
    return `${items.length}`;
  }
  return `${completedCount}/${items.length}`;
}

function ChildThreadIcon({ className }: { className?: string }) {
  return (
    <Icon
      name="ChevronDown"
      className={cn("size-3.5 shrink-0 rotate-45", className)}
      aria-hidden="true"
    />
  );
}

interface SectionToggleButtonProps {
  id: string;
  controlsId: string;
  ariaLabel?: string;
  icon: ReactNode;
  label: ReactNode;
  hideLabelInCompact?: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}

function SectionToggleButton({
  id,
  controlsId,
  ariaLabel,
  icon,
  label,
  hideLabelInCompact = true,
  isExpanded,
  onToggle,
}: SectionToggleButtonProps) {
  return (
    <button
      type="button"
      id={id}
      aria-expanded={isExpanded}
      aria-controls={controlsId}
      aria-label={ariaLabel}
      onClick={onToggle}
      className={cn(
        "flex min-w-0 items-center rounded px-1 py-0.5 text-xs transition-colors hover:bg-state-hover",
        // When a label sits between the icon and the chevron we space the row
        // for legibility (6px). With no label the chevron sits right after the
        // icon — the icons' own internal padding provides enough separation,
        // and a gap here makes the pair look untethered.
        label !== null && label !== undefined ? "gap-1.5" : "gap-0",
        isExpanded ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {icon}
      {label !== null && label !== undefined ? (
        <span
          className="min-w-0 truncate"
          data-promptbox-hide-compact={
            hideLabelInCompact ? "" : undefined
          }
        >
          {label}
        </span>
      ) : null}
      <Icon
        name="ChevronDown"
        className={cn(
          "size-3.5 shrink-0 text-subtle-foreground transition-transform duration-200",
          isExpanded && "rotate-180",
        )}
        aria-hidden="true"
      />
    </button>
  );
}

function TodoStatusIcon({
  status,
}: {
  status: ThreadTimelinePendingTodoItemStatus;
}) {
  const className = "size-3.5 shrink-0";
  switch (status) {
    case "in_progress":
      return (
        <Icon
          name="Square"
          className={cn(className, "fill-current text-muted-foreground/30")}
          aria-hidden="true"
        />
      );
    case "completed":
      return (
        <Icon
          name="Check"
          className={cn(className, "text-muted-foreground/60")}
          aria-hidden="true"
        />
      );
    case "pending":
      return (
        <Icon
          name="Square"
          className={cn(className, "text-muted-foreground/45")}
          aria-hidden="true"
        />
      );
  }
}

function TodoBody({
  items,
}: {
  items: readonly ThreadTimelinePendingTodoItem[];
}) {
  const ordered = [...items].sort(
    (a, b) => STATUS_SORT_RANK[a.status] - STATUS_SORT_RANK[b.status],
  );
  return (
    <ul className="max-h-40 space-y-0.5 overflow-y-auto px-3 pb-2 pt-1.5">
      {ordered.map((item) => (
        <li
          key={item.id}
          className="flex min-w-0 items-center gap-2 py-0.5 text-xs"
        >
          <TodoStatusIcon status={item.status} />
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              item.status === "in_progress" && "font-medium text-foreground",
              item.status === "pending" && "text-muted-foreground",
              item.status === "completed" &&
                "text-subtle-foreground line-through decoration-subtle-foreground",
            )}
            title={item.text}
          >
            {item.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Single source of truth for how the linked source thread is described across
// the banner's three render surfaces (inline label, expanded body, aria).
const PARENT_SECTION_COPY: Record<
  ThreadPromptParentThreadSection["relationship"],
  { verb: string; bodyLead: string; ariaPrefix: string }
> = {
  parent: {
    verb: "Parent",
    bodyLead: "This thread is a child of ",
    ariaPrefix: "Parent thread",
  },
  fork: {
    verb: "Forked from",
    bodyLead: "This thread was forked from ",
    ariaPrefix: "Forked from",
  },
  "side-chat": {
    verb: "Side chat of",
    bodyLead: "This thread is a side chat of ",
    ariaPrefix: "Side chat of",
  },
};

function parentSectionAriaLabel(
  section: ThreadPromptParentThreadSection,
): string {
  return `${PARENT_SECTION_COPY[section.relationship].ariaPrefix} ${section.parentThreadTitle}`;
}

function ParentThreadBody({
  parentThreadTitle,
  href,
  relationship,
}: {
  parentThreadTitle: string;
  href: string;
  relationship: ThreadPromptParentThreadSection["relationship"];
}) {
  return (
    <div className="px-3 pb-2 pt-1.5 text-xs leading-relaxed text-muted-foreground">
      {PARENT_SECTION_COPY[relationship].bodyLead}
      <NavLink
        to={href}
        className="text-foreground/90 underline-offset-2 hover:underline"
      >
        {parentThreadTitle}
      </NavLink>
      .
    </div>
  );
}

function ChildThreadsBody({
  items,
}: {
  items: readonly ThreadPromptChildThreadItem[];
}) {
  return (
    <ul className="max-h-40 space-y-0.5 overflow-y-auto px-3 pb-2 pt-1.5">
      {items.map((item) => (
        <li key={item.id} className="text-xs">
          <NavLink
            to={item.href}
            title={item.title}
            className="flex min-w-0 items-center gap-2 py-0.5 text-foreground/90 underline-offset-2 hover:underline"
          >
            <ChildThreadIcon className="text-subtle-foreground no-underline" />
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

function AnimatedBody({
  id,
  labelledBy,
  isExpanded,
  children,
}: {
  id: string;
  labelledBy: string;
  isExpanded: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      role="region"
      aria-labelledby={labelledBy}
      aria-hidden={!isExpanded}
      className={cn(
        "grid overflow-hidden transition-[grid-template-rows,opacity,border-color] duration-200 ease-out",
        isExpanded
          ? "grid-rows-[1fr] border-t border-border opacity-100"
          : "pointer-events-none grid-rows-[0fr] border-t border-transparent opacity-0",
      )}
    >
      <div className="overflow-hidden bg-popover">{children}</div>
    </section>
  );
}

interface ReadOnlyContextBannerProps {
  iconName: IconName;
  statusAriaLabel: string;
  statusLabel: string;
  parentThreadSection: ThreadPromptParentThreadSection | null;
  expandedSection: ThreadPromptContextBannerExpandedSection | null;
  onToggleSection: (section: ThreadPromptContextBannerExpandedSection) => void;
}

function ReadOnlyContextBanner({
  iconName,
  statusAriaLabel,
  statusLabel,
  parentThreadSection,
  expandedSection,
  onToggleSection,
}: ReadOnlyContextBannerProps) {
  const isParentThreadExpanded =
    expandedSection === "parentThread" && parentThreadSection !== null;
  const hasMultipleSegments = parentThreadSection !== null;
  return (
    <PromptStackCard
      ariaLabel="Thread context before sending"
      className="overflow-hidden"
      style={{ minHeight: THREAD_PROMPT_CONTEXT_BANNER_ROW_HEIGHT }}
    >
      <div className="flex items-center gap-0.5 px-2 py-1 text-xs text-muted-foreground">
        {parentThreadSection ? (
          <SectionToggleButton
            id={SECTION_IDS.parentThread.toggle}
            controlsId={SECTION_IDS.parentThread.body}
            ariaLabel={parentSectionAriaLabel(parentThreadSection)}
            icon={
              <Icon
                name="UserRound"
                className="size-3.5 shrink-0"
                aria-hidden="true"
              />
            }
            label={null}
            isExpanded={isParentThreadExpanded}
            onToggle={() => onToggleSection("parentThread")}
          />
        ) : null}
        <div
          className="flex min-w-0 items-center gap-1.5 px-1 py-0.5"
          role="status"
          aria-label={statusAriaLabel}
          title={statusAriaLabel}
        >
          <Icon
            name={iconName}
            className="size-3.5 shrink-0"
            aria-hidden="true"
          />
          <span
            className="min-w-0 truncate"
            data-promptbox-hide-compact={
              hasMultipleSegments ? "" : undefined
            }
            aria-hidden="true"
          >
            {statusLabel}
          </span>
        </div>
      </div>
      {parentThreadSection ? (
        <AnimatedBody
          id={SECTION_IDS.parentThread.body}
          labelledBy={SECTION_IDS.parentThread.toggle}
          isExpanded={isParentThreadExpanded}
        >
          <ParentThreadBody
            parentThreadTitle={parentThreadSection.parentThreadTitle}
            href={parentThreadSection.href}
            relationship={parentThreadSection.relationship}
          />
        </AnimatedBody>
      ) : null}
    </PromptStackCard>
  );
}

/**
 * Single rounded strip rendered above the FollowUp prompt input. Hosts the
 * thread's high-signal context as inline section toggles (TODO, git) plus
 * the merge-base picker pinned to the right. Only one section can be
 * expanded at a time; the caller owns expandedSection state. See
 * plans/thread-prompt-context-banner.md.
 */
export function ThreadPromptContextBanner({
  todoSection,
  gitSection,
  gitSectionPending,
  archivedSection,
  environmentGoneSection,
  parentThreadSection,
  childThreadsSection,
  expandedSection,
  onToggleSection,
}: ThreadPromptContextBannerProps) {
  if (archivedSection || environmentGoneSection) {
    return (
      <ReadOnlyContextBanner
        iconName={archivedSection ? "Archive" : "CircleX"}
        statusAriaLabel={
          archivedSection
            ? ARCHIVED_THREAD_STATUS_LABEL
            : ENVIRONMENT_GONE_ARIA_LABEL
        }
        statusLabel={
          archivedSection
            ? ARCHIVED_THREAD_STATUS_LABEL
            : ENVIRONMENT_GONE_STATUS_LABEL
        }
        parentThreadSection={parentThreadSection}
        expandedSection={expandedSection}
        onToggleSection={onToggleSection}
      />
    );
  }
  if (gitSectionPending) {
    return null;
  }
  const showTodo =
    todoSection !== null && hasObservedTodoItems(todoSection.pendingTodos);
  const showGit = gitSection !== null;
  const showParentThread = parentThreadSection !== null;
  const showChildThreads =
    childThreadsSection !== null && childThreadsSection.items.length > 0;
  if (!showTodo && !showGit && !showParentThread && !showChildThreads) {
    return null;
  }
  const visibleSegmentCount =
    Number(showParentThread) +
    Number(showChildThreads) +
    Number(showTodo) +
    Number(showGit);
  const hasSingleVisibleSegment = visibleSegmentCount === 1;
  const todoItems =
    showTodo && todoSection ? todoSection.pendingTodos.items : [];
  const todoCountLabel = renderTodoCounts(todoItems);
  const isTodoExpanded = expandedSection === "todos" && showTodo;
  // selectWorkspaceChangedFilesSection only emits a section when files exist,
  // so showGit implies a non-empty file list.
  const isGitExpanded = expandedSection === "git" && showGit;
  const isParentThreadExpanded = expandedSection === "parentThread" && showParentThread;
  const isChildThreadsExpanded =
    expandedSection === "childThreads" && showChildThreads;

  const gitTally = showGit ? toChangeTally(gitSection.changedFiles.stats) : null;
  const gitSummaryText = gitTally ? formatChangeSummary(gitTally) : "";
  const gitSummary: ReactNode =
    showGit && gitTally ? (
      <>
        {showTodo ? null : <>{KIND_PREFIX[gitSection.changedFiles.kind]} · </>}
        {renderChangeSummary(gitTally)}
      </>
    ) : null;

  const mergeBaseCandidates =
    showGit && gitSection.mergeBase
      ? getMergeBaseBranchCandidateGroups({
          mergeBaseBranch: gitSection.mergeBase.branch,
          mergeBaseBranchRef: gitSection.mergeBase.branchRef,
          mergeBaseBranchOptions: gitSection.mergeBase.options,
          remoteMergeBaseBranchOptions: gitSection.mergeBase.remoteOptions,
        })
      : { options: [], remoteOptions: [] };

  // When the parent segment is the only item in the banner, render it
  // inline as "Parent <name>" with the name as a link. There's no other
  // context to compete for the row, so the icon-only toggle would be a strict
  // downgrade in legibility.
  const isParentThreadOnly =
    showParentThread && !showTodo && !showGit && !showChildThreads;

  return (
    <PromptStackCard
      ariaLabel="Thread context before sending"
      className="overflow-hidden bg-surface-recessed"
      style={{ minHeight: THREAD_PROMPT_CONTEXT_BANNER_ROW_HEIGHT }}
    >
      <div className="flex items-center gap-0.5 px-2 py-1 text-xs text-muted-foreground">
        {showParentThread && parentThreadSection && isParentThreadOnly ? (
          <div
            className="flex min-w-0 items-center gap-1.5 px-1 py-0.5"
            title={parentSectionAriaLabel(parentThreadSection)}
          >
            <Icon
              name="UserRound"
              className="size-3.5 shrink-0"
              aria-hidden="true"
            />
            <span className="min-w-0 truncate">
              {PARENT_SECTION_COPY[parentThreadSection.relationship].verb}{" "}
              <NavLink
                to={parentThreadSection.href}
                className="text-foreground/90 underline underline-offset-2"
              >
                {parentThreadSection.parentThreadTitle}
              </NavLink>
            </span>
          </div>
        ) : null}
        {showParentThread && parentThreadSection && !isParentThreadOnly ? (
          <SectionToggleButton
            id={SECTION_IDS.parentThread.toggle}
            controlsId={SECTION_IDS.parentThread.body}
            ariaLabel={parentSectionAriaLabel(parentThreadSection)}
            icon={
              <Icon
                name="UserRound"
                className="size-3.5 shrink-0"
                aria-hidden="true"
              />
            }
            label={null}
            isExpanded={isParentThreadExpanded}
            onToggle={() => onToggleSection("parentThread")}
          />
        ) : null}
        {showChildThreads && childThreadsSection ? (
          <SectionToggleButton
            id={SECTION_IDS.childThreads.toggle}
            controlsId={SECTION_IDS.childThreads.body}
            icon={
              <Icon
                name="CircleDashed"
                className="size-3.5 shrink-0 animate-spin"
                aria-hidden="true"
              />
            }
            label={`${childThreadsSection.items.length} active child ${
              childThreadsSection.items.length === 1 ? "thread" : "threads"
            }`}
            hideLabelInCompact={!hasSingleVisibleSegment}
            ariaLabel={`${childThreadsSection.items.length} active child ${
              childThreadsSection.items.length === 1 ? "thread" : "threads"
            }`}
            isExpanded={isChildThreadsExpanded}
            onToggle={() => onToggleSection("childThreads")}
          />
        ) : null}
        {showTodo ? (
          <SectionToggleButton
            id={SECTION_IDS.todos.toggle}
            controlsId={SECTION_IDS.todos.body}
            icon={
              <Icon
                name="ListTodo"
                className="size-3.5 shrink-0"
                aria-hidden="true"
              />
            }
            label={todoCountLabel}
            hideLabelInCompact={!hasSingleVisibleSegment}
            ariaLabel={`Todos: ${todoCountLabel ?? todoItems.length}`}
            isExpanded={isTodoExpanded}
            onToggle={() => onToggleSection("todos")}
          />
        ) : null}
        {showGit && gitSummary ? (
          <SectionToggleButton
            id={SECTION_IDS.git.toggle}
            controlsId={SECTION_IDS.git.body}
            icon={
              <Icon
                name="FileDiff"
                className="size-3.5 shrink-0"
                aria-hidden="true"
              />
            }
            label={gitSummary}
            hideLabelInCompact={!hasSingleVisibleSegment}
            ariaLabel={`Changed files: ${gitSummaryText}`}
            isExpanded={isGitExpanded}
            onToggle={() => onToggleSection("git")}
          />
        ) : null}
        {showGit && gitSection.mergeBase ? (
          <div
            className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
            data-promptbox-hide-compact=""
          >
            <Icon
              name="GitMerge"
              className="size-3.5 shrink-0"
              aria-hidden="true"
            />
            <span className="shrink-0">Merge base</span>
            <BranchPicker
              value={gitSection.mergeBase.branch}
              options={mergeBaseCandidates.options}
              remoteOptions={mergeBaseCandidates.remoteOptions}
              selectedOptionKind={mergeBaseCandidates.selectedOptionKind}
              variant="minimal"
              loading={gitSection.mergeBase.optionsLoading}
              onChange={gitSection.mergeBase.onChange}
              onOpenChange={gitSection.mergeBase.onPickerOpenChange}
              onSearchQueryChange={gitSection.mergeBase.onSearchQueryChange}
              className="max-w-[10rem]"
              muted
              popoverAlign="end"
            />
          </div>
        ) : null}
      </div>
      {showParentThread && parentThreadSection && !isParentThreadOnly ? (
        <AnimatedBody
          id={SECTION_IDS.parentThread.body}
          labelledBy={SECTION_IDS.parentThread.toggle}
          isExpanded={isParentThreadExpanded}
        >
          <ParentThreadBody
            parentThreadTitle={parentThreadSection.parentThreadTitle}
            href={parentThreadSection.href}
            relationship={parentThreadSection.relationship}
          />
        </AnimatedBody>
      ) : null}
      {showChildThreads && childThreadsSection ? (
        <AnimatedBody
          id={SECTION_IDS.childThreads.body}
          labelledBy={SECTION_IDS.childThreads.toggle}
          isExpanded={isChildThreadsExpanded}
        >
          <ChildThreadsBody items={childThreadsSection.items} />
        </AnimatedBody>
      ) : null}
      {showTodo ? (
        <AnimatedBody
          id={SECTION_IDS.todos.body}
          labelledBy={SECTION_IDS.todos.toggle}
          isExpanded={isTodoExpanded}
        >
          <TodoBody items={todoItems} />
        </AnimatedBody>
      ) : null}
      {showGit ? (
        <AnimatedBody
          id={SECTION_IDS.git.body}
          labelledBy={SECTION_IDS.git.toggle}
          isExpanded={isGitExpanded}
        >
          <WorkspaceChangesList
            files={gitSection.changedFiles.files}
            className="max-h-32 px-3 pb-2 pt-1"
            onFileClick={(file) =>
              gitSection.onPromptBannerFileClick({
                file,
                section: gitSection.changedFiles,
              })
            }
          />
        </AnimatedBody>
      ) : null}
    </PromptStackCard>
  );
}
