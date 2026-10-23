import type {
  ExperimentalThreadContextSegmentInput,
  ExperimentalThreadContextSegmentProps,
} from "@get-bb/plugin-sdk";
import { CONTEXT_CARD_TOGGLE_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import {
  CORE_THREAD_CONTEXT_OWNER,
  ThreadContextSegmentMount,
  threadContextSegmentKey,
  threadContextSegmentMountKey,
  useThreadContextSegments,
  type CoreThreadContextSegment,
  type ThreadContextSegmentEntry,
} from "@/components/plugin/PluginThreadContextSegments";
import {
  collectPluginAppRegistrations,
  definePluginApp,
} from "@/lib/plugin-app-definition";
import {
  machineRemovalDescriptions,
  machineRemovalLabels,
  type MachineRemovalStatus,
} from "@/lib/machine-removal-display";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { NavLink } from "react-router-dom";
import type {
  EnvironmentStatus,
  PendingInteraction,
  GitBranchRefClassification,
  ThreadRuntimeDisplayStatus,
} from "@bb/domain";
import {
  BranchPicker,
  getMergeBaseBranchCandidateGroups,
} from "@/components/pickers/BranchPicker";
import {
  PromptStackCard,
  PROMPT_STACK_CARD_HEADER_BUTTON_CLASS,
  PROMPT_STACK_CARD_ROW_HEIGHT,
  PROMPT_CONTEXT_BANNER_COLLAPSED_HEIGHT,
  PROMPT_STACK_INLAY_INSET_CLASS,
  PROMPT_STACK_INLAY_SEGMENT_CLASS,
} from "@/components/promptbox/banner/PromptStackCard";
import {
  activityIconClass,
  activityRowClass,
  activityTextClass,
} from "@bb/shared-ui/activity-row-styles";
import { WorkspaceChangesList } from "@/components/thread/WorkspaceChangesList";
import { formatPendingInteractionSummary } from "@bb/core-ui";
import { InlinePendingInteractionContext } from "@/components/thread/pending-interactions/PendingInteractionShell";
import { ThreadPendingInteractionBanners } from "@/components/thread/pending-interactions/ThreadPendingInteractionBanner";
import {
  formatChangeSummary,
  renderChangeSummary,
  toChangeTally,
  type WorkspaceChangedFileSelection,
  type WorkspaceChangedFilesSection,
} from "@/components/workspace/workspace-change-summary";
import { cn } from "@bb/shared-ui/lib/utils";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import {
  AnimatedBody,
  AnimatedDisclosureBody,
} from "@/components/promptbox/banner/AnimatedBody";
import {
  PROMPT_STACK_DISCLOSURE_TRIGGER_CLASS,
  PromptStackCollapseRow,
  PromptStackCountSlot,
  PromptStackHoverChevron,
  useDisclosureFocusHandoff,
} from "@bb/shared-ui/prompt-stack-disclosure";
import {
  BannerActionSlot,
  PromptBannerActionButton,
} from "@bb/shared-ui/prompt-banner-actions";
import {
  ThreadTitle,
  useThreadTitleDisplayText,
} from "@/components/thread/ThreadTitleMentions";
import { childThreadNoun } from "@/lib/child-thread-copy";
import { SIDEBAR_WORKING_STATUS_COLOR_CLASS } from "@bb/shared-ui/sidebar-row-classes";

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

export interface ThreadPromptGitSection {
  changedFiles: WorkspaceChangedFilesSection;
  mergeBase: ContextBannerMergeBaseConfig | null;
  onPromptBannerFileClick: (selection: WorkspaceChangedFileSelection) => void;
}

export interface ThreadPromptParentThreadSection {
  parentThreadTitle: string;
  href: string;
  relationship: "parent" | "fork";
}

interface ThreadPromptChildThreadItem {
  id: string;
  title: string;
  href: string;
  hasPendingInteraction: boolean;
}

export interface ChildThreadQuestion {
  childThreadId: string;
  childTitle: string;
  href: string;
  interaction: PendingInteraction;
}

export interface ThreadPromptChildThreadsSection {
  items: readonly ThreadPromptChildThreadItem[];
  pendingInteractions: readonly ChildThreadQuestion[];
}

export interface ThreadPromptArchivedSection {
  archivedAt: number;
  onUnarchive?: () => void;
  unarchivePending?: boolean;
}

export interface ThreadPromptEnvironmentGoneSection {
  status: Extract<EnvironmentStatus, "destroyed"> | MachineRemovalStatus;
  onRestore?: () => void;
  restorePending?: boolean;
}

const THREAD_BANNER_ACTIVE_CHILD_RUNTIME_STATUSES: ReadonlySet<ThreadRuntimeDisplayStatus> =
  new Set(["active", "provisioning", "starting", "waiting-for-host"]);

export function isThreadDisplayStatusBannerActive(
  status: ThreadRuntimeDisplayStatus,
): boolean {
  return THREAD_BANNER_ACTIVE_CHILD_RUNTIME_STATUSES.has(status);
}

export interface CoreThreadContext {
  git: ThreadPromptGitSection | null;
  gitPending: boolean;
  parentThread: ThreadPromptParentThreadSection | null;
  childThreads: ThreadPromptChildThreadsSection | null;
}

interface ThreadPromptContextBannerProps {
  input: ExperimentalThreadContextSegmentInput;
  core: CoreThreadContext;
  archivedSection: ThreadPromptArchivedSection | null;
  environmentGoneSection: ThreadPromptEnvironmentGoneSection | null;
  showInlineSegments: boolean;
  expandedSegment: string | null;
  onToggleSegment: (key: string) => void;
}

const KIND_PREFIX: Record<WorkspaceChangedFilesSection["kind"], string> = {
  uncommitted: "Uncommitted",
  untracked: "Untracked",
  committed: "Committed",
};

const ARCHIVED_THREAD_STATUS_LABEL = "Thread is archived";
const ENVIRONMENT_GONE_STATUS_COPY: Record<
  ThreadPromptEnvironmentGoneSection["status"],
  { description: string; label: string }
> = {
  destroyed: {
    description:
      "Environment unavailable. You can still view this thread’s history.",
    label: "Environment unavailable",
  },
  removed: {
    label: machineRemovalLabels.removed,
    description: machineRemovalDescriptions.removed,
  },
  removing: {
    label: machineRemovalLabels.removing,
    description: machineRemovalDescriptions.removing,
  },
  "cleanup-failed": {
    label: machineRemovalLabels["cleanup-failed"],
    description: machineRemovalDescriptions["cleanup-failed"],
  },
};

const SECTION_IDS = {
  parentThread: {
    toggle: "thread-prompt-banner-parent-thread-toggle",
    body: "thread-prompt-banner-parent-thread-body",
  },
  childThreads: {
    toggle: "thread-prompt-banner-child-threads-toggle",
    body: "thread-prompt-banner-child-threads-body",
  },
  git: {
    toggle: "thread-prompt-banner-git-toggle",
    body: "thread-prompt-banner-git-body",
  },
  status: {
    toggle: "thread-prompt-banner-status-toggle",
    body: "thread-prompt-banner-status-body",
  },
} as const;

const SEGMENT_SHRINK_CLASS = "min-w-0 overflow-hidden";

interface SectionToggleButtonProps {
  buttonRef: RefObject<HTMLButtonElement | null>;
  fillRow: boolean;
  id: string;
  controlsId: string;
  ariaLabel?: string;
  icon: ReactNode;
  label: ReactNode;
  compactLabel?: ReactNode;
  hideLabelInCompact?: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}

function SectionToggleButton({
  buttonRef,
  fillRow,
  id,
  controlsId,
  ariaLabel,
  icon,
  label,
  compactLabel,
  hideLabelInCompact = true,
  isExpanded,
  onToggle,
}: SectionToggleButtonProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      id={id}
      aria-expanded={isExpanded}
      aria-controls={controlsId}
      aria-label={ariaLabel}
      onClick={onToggle}
      className={cn(
        CONTEXT_CARD_TOGGLE_CLASS,
        PROMPT_STACK_INLAY_SEGMENT_CLASS,
        SEGMENT_SHRINK_CLASS,
        label !== null && label !== undefined ? "gap-1.5" : "gap-0",
        fillRow && "flex-1 justify-start text-left",
        PROMPT_STACK_DISCLOSURE_TRIGGER_CLASS,
        isExpanded ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {icon}
      {label !== null && label !== undefined ? (
        <span
          className="min-w-0 truncate"
          data-promptbox-hide-compact={hideLabelInCompact ? "" : undefined}
        >
          {label}
        </span>
      ) : null}
      {hideLabelInCompact &&
      compactLabel !== null &&
      compactLabel !== undefined ? (
        <span className="min-w-0 truncate" data-promptbox-compact-label="">
          {compactLabel}
        </span>
      ) : null}
      {fillRow ? <PromptStackHoverChevron isExpanded={isExpanded} /> : null}
    </button>
  );
}

const PARENT_SECTION_COPY: Record<
  ThreadPromptParentThreadSection["relationship"],
  { verb: string; bodyLead: string; ariaPrefix: string }
> = {
  parent: {
    verb: "Parent",
    bodyLead: "This thread is a child of ",
    ariaPrefix: "Parent",
  },
  fork: {
    verb: "Forked from",
    bodyLead: "This thread was forked from ",
    ariaPrefix: "Forked from",
  },
};

const PARENT_SECTION_ICON: Record<
  ThreadPromptParentThreadSection["relationship"],
  IconName
> = {
  parent: "UserRound",
  fork: "Fork",
};

function useParentSectionAriaLabel(
  section: ThreadPromptParentThreadSection,
): string {
  const parentThreadTitle = useThreadTitleDisplayText(
    section.parentThreadTitle,
  );
  return `${PARENT_SECTION_COPY[section.relationship].ariaPrefix} ${parentThreadTitle}`;
}

const PARENT_THREAD_TITLE_CLASS =
  "text-foreground/90 underline underline-offset-2";

function ParentThreadInlineSegment({
  section,
}: {
  section: ThreadPromptParentThreadSection;
}) {
  const ariaLabel = useParentSectionAriaLabel(section);
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-xs",
        PROMPT_STACK_INLAY_SEGMENT_CLASS,
      )}
      title={ariaLabel}
    >
      <Icon
        name={PARENT_SECTION_ICON[section.relationship]}
        className="size-3.5 shrink-0"
        aria-hidden="true"
      />
      <span className="min-w-0 truncate">
        {PARENT_SECTION_COPY[section.relationship].verb}{" "}
        <NavLink to={section.href}>
          <ThreadTitle
            title={section.parentThreadTitle}
            className={PARENT_THREAD_TITLE_CLASS}
            inline
          />
        </NavLink>
      </span>
    </div>
  );
}

function ParentThreadSectionToggle({
  section,
  buttonRef,
  isExpanded,
  onToggle,
}: {
  section: ThreadPromptParentThreadSection;
  buttonRef: RefObject<HTMLButtonElement | null>;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const ariaLabel = useParentSectionAriaLabel(section);
  return (
    <SectionToggleButton
      buttonRef={buttonRef}
      fillRow={false}
      id={SECTION_IDS.parentThread.toggle}
      controlsId={SECTION_IDS.parentThread.body}
      ariaLabel={ariaLabel}
      icon={
        <Icon
          name={PARENT_SECTION_ICON[section.relationship]}
          className="size-3.5 shrink-0"
          aria-hidden="true"
        />
      }
      label={null}
      isExpanded={isExpanded}
      onToggle={onToggle}
    />
  );
}

function ParentThreadSectionBody({
  section,
  isExpanded,
  collapseRef,
  onCollapse,
}: {
  section: ThreadPromptParentThreadSection;
  isExpanded: boolean;
  collapseRef: RefObject<HTMLButtonElement | null>;
  onCollapse: () => void;
}) {
  return (
    <AnimatedDisclosureBody
      collapsedBorder="reserve"
      id={SECTION_IDS.parentThread.body}
      labelledBy={SECTION_IDS.parentThread.toggle}
      isExpanded={isExpanded}
      collapseLabel="Collapse parent thread"
      collapseRef={collapseRef}
      onCollapse={onCollapse}
    >
      <div className="px-3 pb-2 pt-1.5 text-xs leading-relaxed text-muted-foreground">
        {PARENT_SECTION_COPY[section.relationship].bodyLead}
        <NavLink to={section.href}>
          <ThreadTitle
            title={section.parentThreadTitle}
            className={PARENT_THREAD_TITLE_CLASS}
            inline
          />
        </NavLink>
        .
      </div>
    </AnimatedDisclosureBody>
  );
}

const CHILD_THREAD_ROW_CLASS =
  "flex w-full min-w-0 items-center gap-2 py-0.5 text-left text-foreground/90 underline-offset-2 hover:underline";

const CHILD_QUESTION_STEP_BUTTON_CLASS =
  "flex size-6 shrink-0 items-center justify-center rounded-md text-subtle-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function ChildThreadsBody({
  items,
  pendingInteractions,
  onOpenQuestion,
}: {
  items: readonly ThreadPromptChildThreadItem[];
  pendingInteractions: readonly ChildThreadQuestion[];
  onOpenQuestion: (interactionId: string) => void;
}) {
  return (
    <ul className="max-h-40 space-y-0.5 overflow-y-auto px-3 pt-1.5">
      {items.map((item) => {
        const pending = item.hasPendingInteraction
          ? pendingInteractions.find(
              (candidate) => candidate.childThreadId === item.id,
            )
          : undefined;
        const content = (
          <>
            {item.hasPendingInteraction ? (
              <Icon
                name="CircleQuestion"
                className="size-3.5 shrink-0 text-muted-foreground/75 no-underline"
                aria-label="Needs input"
              />
            ) : (
              <Icon
                name="Loading"
                className={cn(
                  "size-3.5 shrink-0 animate-spin no-underline motion-reduce:animate-none",
                  SIDEBAR_WORKING_STATUS_COLOR_CLASS,
                )}
                aria-label="Working"
              />
            )}
            {pending ? (
              <ChildQuestionSummary
                childTitle={<ThreadTitle title={item.title} tooltip />}
                question={formatPendingInteractionSummary({
                  interaction: pending.interaction,
                })}
              />
            ) : (
              <ThreadTitle title={item.title} tooltip className="flex-1" />
            )}
          </>
        );
        return (
          <li key={item.id} className="text-xs">
            {pending ? (
              <button
                type="button"
                data-child-question-row={item.id}
                onClick={() => onOpenQuestion(pending.interaction.id)}
                className={CHILD_THREAD_ROW_CLASS}
              >
                {content}
              </button>
            ) : (
              <NavLink to={item.href} className={CHILD_THREAD_ROW_CLASS}>
                {content}
              </NavLink>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ChildQuestionSummary({
  childTitle,
  question,
}: {
  childTitle: ReactNode;
  question: string;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-baseline">
      <span className="min-w-0 max-w-[70%] shrink-0 truncate text-foreground">
        {childTitle}
      </span>
      <span className="shrink-0 whitespace-pre text-foreground">: </span>
      <span
        title={question}
        className="min-w-0 flex-1 truncate text-muted-foreground"
      >
        {question}
      </span>
    </span>
  );
}

function ChildThreadsHeaderIcon({ needsInput }: { needsInput: boolean }) {
  return needsInput ? (
    <span className="relative mr-1 inline-flex shrink-0">
      <Icon
        name="ChildThread"
        className="size-3.5 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="absolute -bottom-1.5 -right-1.5 inline-flex rounded-full bg-background">
        <Icon
          name="CircleQuestion"
          className="size-3 text-foreground/80"
          aria-label="Needs input"
        />
      </span>
    </span>
  ) : (
    <Icon
      name="ChildThread"
      className={activityIconClass("active", "size-3.5 shrink-0")}
      aria-hidden="true"
    />
  );
}

function ChildQuestionBackHeader({
  backButtonRef,
  needsInput,
  onBack,
}: {
  backButtonRef: RefObject<HTMLButtonElement | null>;
  needsInput: boolean;
  onBack: () => void;
}) {
  return (
    <button
      ref={backButtonRef}
      type="button"
      id={SECTION_IDS.childThreads.toggle}
      aria-label="Back to active child threads"
      onClick={onBack}
      className={activityRowClass(
        "active",
        cn(
          PROMPT_STACK_CARD_HEADER_BUTTON_CLASS,
          PROMPT_STACK_DISCLOSURE_TRIGGER_CLASS,
        ),
      )}
    >
      <Icon
        name="ChevronLeft"
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <ChildThreadsHeaderIcon needsInput={needsInput} />
      <span
        className={activityTextClass(
          "active",
          "min-w-0 flex-1 truncate text-left font-normal",
        )}
      >
        Active child threads
      </span>
    </button>
  );
}

function ChildQuestionBody({
  titleLinkRef,
  current,
  index,
  total,
  onStep,
  onClose,
}: {
  titleLinkRef: RefObject<HTMLAnchorElement | null>;
  current: ChildThreadQuestion;
  index: number;
  total: number;
  onStep: (offset: 1 | -1) => void;
  onClose: (childThreadId: string) => void;
}) {
  const position = `${index + 1} of ${total}`;
  const childTitle = useThreadTitleDisplayText(current.childTitle);
  const question = formatPendingInteractionSummary({
    interaction: current.interaction,
  });
  const form = useMemo(
    () => (
      <InlinePendingInteractionContext.Provider
        value={{
          promptShownAbove: question,
          close: () => onClose(current.childThreadId),
        }}
      >
        <ThreadPendingInteractionBanners
          interactions={[current.interaction]}
          threadId={current.childThreadId}
        />
      </InlinePendingInteractionContext.Provider>
    ),
    [current.interaction, current.childThreadId, question, onClose],
  );
  return (
    <div className="px-3 pb-2 pt-2">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <p className="max-h-[calc(5lh+0.125rem)] min-w-0 flex-1 overflow-y-auto overscroll-contain break-words px-2.5 pt-0.5 text-xs text-foreground">
          <NavLink
            ref={titleLinkRef}
            to={current.href}
            className="underline underline-offset-2"
          >
            {childTitle}
          </NavLink>
          : <span className="text-muted-foreground">{question}</span>
        </p>
        {total > 1 ? (
          <div className="-mr-1.5 flex shrink-0 items-center text-xs">
            <button
              type="button"
              aria-label="Previous question"
              onClick={() => onStep(-1)}
              className={CHILD_QUESTION_STEP_BUTTON_CLASS}
            >
              <Icon
                name="ChevronLeft"
                className="size-3.5"
                aria-hidden="true"
              />
            </button>
            <span className="whitespace-nowrap tabular-nums text-subtle-foreground">
              {position}
            </span>
            <button
              type="button"
              aria-label="Next question"
              onClick={() => onStep(1)}
              className={CHILD_QUESTION_STEP_BUTTON_CLASS}
            >
              <Icon
                name="ChevronRight"
                className="size-3.5"
                aria-hidden="true"
              />
            </button>
          </div>
        ) : null}
      </div>
      <span aria-live="polite" className="sr-only">
        {total > 1 ? `Question ${position}` : ""}
      </span>
      <div className="mt-1.5">{form}</div>
    </div>
  );
}

function PendingBannerActionButton({
  pending,
  label,
  pendingLabel,
  onClick,
}: {
  pending: boolean;
  label: string;
  pendingLabel: string;
  onClick: () => void;
}) {
  return (
    <PromptBannerActionButton onClick={onClick} disabled={pending}>
      {pending ? pendingLabel : label}
    </PromptBannerActionButton>
  );
}

const NO_CHILD_THREAD_ITEMS: readonly ThreadPromptChildThreadItem[] = [];

function useExpandForNewNeedsInput(
  items: readonly ThreadPromptChildThreadItem[],
  expandedSegment: string | null,
  onExpand: () => void,
) {
  const needsInputKey = items
    .filter((item) => item.hasPendingInteraction)
    .map((item) => item.id)
    .join(" ");
  const seenNeedsInputKey = useRef("");
  useEffect(() => {
    const seen = new Set(seenNeedsInputKey.current.split(" "));
    seenNeedsInputKey.current = needsInputKey;
    const hasNewNeedsInput =
      needsInputKey !== "" &&
      needsInputKey.split(" ").some((id) => !seen.has(id));
    if (hasNewNeedsInput && expandedSegment === null) {
      onExpand();
    }
  }, [needsInputKey, expandedSegment, onExpand]);
}

function ActiveChildThreadsCard({
  childThreadsSection,
  isExpanded,
  onToggle,
}: {
  childThreadsSection: ThreadPromptChildThreadsSection;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const focus = useDisclosureFocusHandoff(isExpanded, onToggle);
  const cardRef = useRef<HTMLElement>(null);
  const [openQuestion, setOpenQuestion] = useState<{
    interactionId: string;
    index: number;
  } | null>(null);
  const returnFocusChildId = useRef<string | null>(null);
  useEffect(() => {
    const childId = returnFocusChildId.current;
    if (openQuestion !== null || childId === null) {
      return;
    }
    returnFocusChildId.current = null;
    cardRef.current
      ?.querySelector<HTMLElement>(`[data-child-question-row="${childId}"]`)
      ?.focus();
  }, [openQuestion]);
  const closeQuestion = useCallback((childThreadId: string) => {
    returnFocusChildId.current = childThreadId;
    setOpenQuestion(null);
  }, []);
  const items = childThreadsSection.items;
  const pendingInteractions = childThreadsSection.pendingInteractions;
  const matchedIndex = openQuestion
    ? pendingInteractions.findIndex(
        (item) => item.interaction.id === openQuestion.interactionId,
      )
    : -1;
  const questionIndex =
    matchedIndex >= 0
      ? matchedIndex
      : Math.min(openQuestion?.index ?? 0, pendingInteractions.length - 1);
  const currentQuestion =
    openQuestion && isExpanded ? pendingInteractions[questionIndex] : undefined;
  if (openQuestion && !currentQuestion) {
    setOpenQuestion(null);
  } else if (
    currentQuestion &&
    (openQuestion?.interactionId !== currentQuestion.interaction.id ||
      openQuestion.index !== questionIndex)
  ) {
    setOpenQuestion({
      interactionId: currentQuestion.interaction.id,
      index: questionIndex,
    });
  }
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const titleLinkRef = useRef<HTMLAnchorElement>(null);
  const focusBackOnOpen = useRef(false);
  const openChildThreadId = currentQuestion?.childThreadId ?? null;
  useEffect(() => {
    if (openChildThreadId !== null && focusBackOnOpen.current) {
      focusBackOnOpen.current = false;
      (backButtonRef.current ?? titleLinkRef.current)?.focus();
    }
  }, [openChildThreadId]);
  const focusWasInCard = useRef(false);
  const hasItems = items.length > 0;
  useEffect(() => {
    const card = cardRef.current;
    if (!card) {
      return;
    }
    const handleFocusIn = () => {
      focusWasInCard.current = true;
    };
    const handleFocusOut = (event: FocusEvent) => {
      if (
        event.relatedTarget instanceof Node &&
        !card.contains(event.relatedTarget)
      ) {
        focusWasInCard.current = false;
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !card.contains(event.target)) {
        focusWasInCard.current = false;
      }
    };
    card.addEventListener("focusin", handleFocusIn);
    card.addEventListener("focusout", handleFocusOut);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      card.removeEventListener("focusin", handleFocusIn);
      card.removeEventListener("focusout", handleFocusOut);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [hasItems]);
  const currentInteractionId = currentQuestion?.interaction.id ?? null;
  const shownInteractionId = useRef<string | null>(null);
  useEffect(() => {
    const previous = shownInteractionId.current;
    shownInteractionId.current = currentInteractionId;
    if (
      !focusWasInCard.current ||
      previous === null ||
      previous === currentInteractionId ||
      pendingInteractions.some((item) => item.interaction.id === previous)
    ) {
      return;
    }
    const active = document.activeElement;
    if (active !== null && active !== document.body) {
      return;
    }
    (
      backButtonRef.current ??
      titleLinkRef.current ??
      focus.triggerRef.current
    )?.focus();
  }, [currentInteractionId, pendingInteractions, focus.triggerRef]);
  const newestQuestionTitle = useThreadTitleDisplayText(
    pendingInteractions[0]?.childTitle ?? "",
  );
  if (items.length === 0) {
    return null;
  }
  const closeQuestionOnEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (
      event.key !== "Escape" ||
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      !currentQuestion
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    closeQuestion(currentQuestion.childThreadId);
  };
  const openQuestionAt = (index: number) => {
    const next = pendingInteractions[index];
    if (next) {
      setOpenQuestion({ interactionId: next.interaction.id, index });
    }
  };
  const newestQuestion = isExpanded ? undefined : pendingInteractions[0];
  const collapsedQuestion = newestQuestion
    ? {
        childTitle: newestQuestion.childTitle,
        text: formatPendingInteractionSummary({
          interaction: newestQuestion.interaction,
        }),
      }
    : null;
  const backToChildThreads = () => {
    if (currentQuestion) {
      closeQuestion(currentQuestion.childThreadId);
    }
  };
  const showBackHeader = currentQuestion !== undefined && items.length > 1;
  const needsInput = items.some((item) => item.hasPendingInteraction);
  return (
    <PromptStackCard
      rootRef={cardRef}
      ariaLabel="Child threads"
      onKeyDown={closeQuestionOnEscape}
      className="overflow-hidden"
      style={{ minHeight: PROMPT_STACK_CARD_ROW_HEIGHT }}
    >
      {showBackHeader ? (
        <ChildQuestionBackHeader
          backButtonRef={backButtonRef}
          needsInput={needsInput}
          onBack={backToChildThreads}
        />
      ) : (
        <button
          ref={focus.triggerRef}
          type="button"
          id={SECTION_IDS.childThreads.toggle}
          aria-expanded={isExpanded}
          aria-controls={SECTION_IDS.childThreads.body}
          aria-label={
            collapsedQuestion
              ? `${items.length} active ${childThreadNoun(items.length)}, needs input: ${newestQuestionTitle}: ${collapsedQuestion.text}`
              : `${items.length} active ${childThreadNoun(items.length)}`
          }
          onClick={focus.onTriggerClick}
          className={activityRowClass(
            "active",
            cn(
              PROMPT_STACK_CARD_HEADER_BUTTON_CLASS,
              PROMPT_STACK_DISCLOSURE_TRIGGER_CLASS,
            ),
          )}
        >
          <ChildThreadsHeaderIcon needsInput={needsInput} />
          {collapsedQuestion ? (
            <span className="flex min-w-0 flex-1 text-left">
              <ChildQuestionSummary
                childTitle={
                  <ThreadTitle title={collapsedQuestion.childTitle} tooltip />
                }
                question={collapsedQuestion.text}
              />
            </span>
          ) : (
            <span
              className={activityTextClass(
                "active",
                "min-w-0 flex-1 truncate text-left font-normal",
              )}
            >
              Active child threads
            </span>
          )}
          <PromptStackCountSlot count={items.length} />
        </button>
      )}
      <AnimatedBody
        collapsedBorder="reserve"
        id={SECTION_IDS.childThreads.body}
        labelledBy={SECTION_IDS.childThreads.toggle}
        isExpanded={isExpanded}
      >
        {currentQuestion ? (
          <ChildQuestionBody
            titleLinkRef={titleLinkRef}
            current={currentQuestion}
            index={questionIndex}
            total={pendingInteractions.length}
            onStep={(offset) =>
              openQuestionAt(
                (questionIndex + offset + pendingInteractions.length) %
                  pendingInteractions.length,
              )
            }
            onClose={closeQuestion}
          />
        ) : (
          <ChildThreadsBody
            items={items}
            pendingInteractions={pendingInteractions}
            onOpenQuestion={(interactionId) => {
              focusBackOnOpen.current = true;
              openQuestionAt(
                pendingInteractions.findIndex(
                  (item) => item.interaction.id === interactionId,
                ),
              );
            }}
          />
        )}
        {currentQuestion ? null : (
          <PromptStackCollapseRow
            buttonRef={focus.collapseRef}
            className="rounded-none"
            controlsId={SECTION_IDS.childThreads.body}
            label={`Collapse ${items.length} ${childThreadNoun(items.length)}`}
            onCollapse={focus.onCollapseClick}
          />
        )}
      </AnimatedBody>
    </PromptStackCard>
  );
}

type DisclosureFocusHandoff = ReturnType<typeof useDisclosureFocusHandoff>;

interface CoreThreadContextValue extends CoreThreadContext {
  parentFocus: DisclosureFocusHandoff;
  gitFocus: DisclosureFocusHandoff;
}

const CoreThreadContextContext = createContext<CoreThreadContextValue | null>(
  null,
);

function useCoreThreadContext(): CoreThreadContextValue {
  const value = useContext(CoreThreadContextContext);
  if (value === null) {
    throw new Error("Core thread context segments render inside the banner");
  }
  return value;
}

function ParentThreadSegment({
  part,
  segments,
  isExpanded,
}: ExperimentalThreadContextSegmentProps) {
  const { parentThread, parentFocus } = useCoreThreadContext();
  if (parentThread === null) return null;
  const isAlone = segments.length === 1;
  if (part === "summary") {
    return isAlone ? (
      <ParentThreadInlineSegment section={parentThread} />
    ) : (
      <ParentThreadSectionToggle
        section={parentThread}
        buttonRef={parentFocus.triggerRef}
        isExpanded={isExpanded}
        onToggle={parentFocus.onTriggerClick}
      />
    );
  }
  if (part === "details" && !isAlone) {
    return (
      <ParentThreadSectionBody
        section={parentThread}
        isExpanded={isExpanded}
        collapseRef={parentFocus.collapseRef}
        onCollapse={parentFocus.onCollapseClick}
      />
    );
  }
  return null;
}

function ChangedFilesMergeBaseAction({
  mergeBase,
}: {
  mergeBase: ContextBannerMergeBaseConfig;
}) {
  const candidates = getMergeBaseBranchCandidateGroups({
    mergeBaseBranch: mergeBase.branch,
    mergeBaseBranchRef: mergeBase.branchRef,
    mergeBaseBranchOptions: mergeBase.options,
    remoteMergeBaseBranchOptions: mergeBase.remoteOptions,
  });
  return (
    <BannerActionSlot hideInCompact>
      <Icon name="GitMerge" className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="shrink-0">Merge base</span>
      <BranchPicker
        value={mergeBase.branch}
        options={candidates.options}
        remoteOptions={candidates.remoteOptions}
        variant="minimal"
        emphasizeTriggerValue={false}
        loading={mergeBase.optionsLoading}
        onChange={mergeBase.onChange}
        onOpenChange={mergeBase.onPickerOpenChange}
        onSearchQueryChange={mergeBase.onSearchQueryChange}
        className="max-w-[10rem]"
        muted
        popoverAlign="end"
      />
    </BannerActionSlot>
  );
}

function ChangedFilesSegment({
  part,
  segments,
  isExpanded,
}: ExperimentalThreadContextSegmentProps) {
  const { git, gitFocus } = useCoreThreadContext();
  if (git === null) return null;
  if (part === "summary") {
    const tally = toChangeTally(git.changedFiles.stats);
    const prefix = KIND_PREFIX[git.changedFiles.kind];
    return (
      <SectionToggleButton
        buttonRef={gitFocus.triggerRef}
        fillRow
        id={SECTION_IDS.git.toggle}
        controlsId={SECTION_IDS.git.body}
        icon={
          <Icon
            name="FileDiff"
            className="size-3.5 shrink-0"
            aria-hidden="true"
          />
        }
        label={
          <>
            {prefix} · {renderChangeSummary(tally)}
          </>
        }
        compactLabel={renderChangeSummary(tally)}
        hideLabelInCompact={segments.length > 2}
        ariaLabel={`Changed files: ${prefix}, ${formatChangeSummary(tally)}`}
        isExpanded={isExpanded}
        onToggle={gitFocus.onTriggerClick}
      />
    );
  }
  if (part === "action") {
    return segments.length === 1 && git.mergeBase ? (
      <ChangedFilesMergeBaseAction mergeBase={git.mergeBase} />
    ) : null;
  }
  return (
    <AnimatedDisclosureBody
      collapsedBorder="reserve"
      id={SECTION_IDS.git.body}
      labelledBy={SECTION_IDS.git.toggle}
      isExpanded={isExpanded}
      collapseLabel="Collapse changed files"
      collapseRef={gitFocus.collapseRef}
      onCollapse={gitFocus.onCollapseClick}
    >
      <WorkspaceChangesList
        files={git.changedFiles.files}
        fileCount={git.changedFiles.stats.fileCount}
        className="max-h-32 px-3 pb-2 pt-1"
        onFileClick={(file) =>
          git.onPromptBannerFileClick({ file, section: git.changedFiles })
        }
      />
    </AnimatedDisclosureBody>
  );
}

function ChildThreadsCard({
  part,
  isExpanded,
  onToggle,
}: ExperimentalThreadContextSegmentProps) {
  const { childThreads } = useCoreThreadContext();
  if (part !== "summary" || childThreads === null) return null;
  return (
    <ActiveChildThreadsCard
      childThreadsSection={childThreads}
      isExpanded={isExpanded}
      onToggle={onToggle}
    />
  );
}

const coreThreadContextSegments: readonly CoreThreadContextSegment[] =
  collectPluginAppRegistrations(
    definePluginApp((app) => {
      app.slots.experimental_threadContextSegment({
        id: "child-threads",
        title: "Child threads",
        placement: "before",
        component: ChildThreadsCard,
        useVisible: () =>
          (useCoreThreadContext().childThreads?.items.length ?? 0) > 0,
      });
      app.slots.experimental_threadContextSegment({
        id: "parent-thread",
        title: "Parent thread",
        order: 100,
        component: ParentThreadSegment,
        useVisible: () => useCoreThreadContext().parentThread !== null,
      });
      app.slots.experimental_threadContextSegment({
        id: "changed-files",
        title: "Changed files",
        order: 300,
        component: ChangedFilesSegment,
        useVisible: () => useCoreThreadContext().git !== null,
      });
    }),
  ).threadContextSegments.map((slot) => ({
    ...slot,
    pluginId: CORE_THREAD_CONTEXT_OWNER,
  }));

function coreSlot(id: string): CoreThreadContextSegment {
  const slot = coreThreadContextSegments.find(
    (candidate) => candidate.id === id,
  );
  if (slot === undefined) throw new Error(`Missing core segment ${id}`);
  return slot;
}

const PARENT_THREAD_SLOT = coreSlot("parent-thread");
const PARENT_THREAD_ENTRY: ThreadContextSegmentEntry = {
  owner: "core",
  slot: PARENT_THREAD_SLOT,
};
const CHILD_THREADS_KEY = threadContextSegmentKey(coreSlot("child-threads"));
const PARENT_THREAD_KEY = threadContextSegmentKey(PARENT_THREAD_SLOT);
const CHANGED_FILES_KEY = threadContextSegmentKey(coreSlot("changed-files"));
const STATUS_KEY = `${CORE_THREAD_CONTEXT_OWNER}/status`;
const READ_ONLY_SEGMENTS = [
  { pluginId: CORE_THREAD_CONTEXT_OWNER, id: PARENT_THREAD_SLOT.id },
  { pluginId: CORE_THREAD_CONTEXT_OWNER, id: "status" },
];

interface ReadOnlyContextBannerProps {
  input: ExperimentalThreadContextSegmentInput;
  iconName: IconName;
  statusLabel: string;
  description: string | null;
  hasParentThread: boolean;
  statusAction: ReactNode;
  expandedSegment: string | null;
  onToggleSegment: (key: string) => void;
}

function ReadOnlyContextBanner({
  input,
  iconName,
  statusLabel,
  description,
  hasParentThread,
  statusAction,
  expandedSegment,
  onToggleSegment,
}: ReadOnlyContextBannerProps) {
  const isStatusExpanded =
    expandedSegment === STATUS_KEY && description !== null;
  const statusFocus = useDisclosureFocusHandoff(isStatusExpanded, () =>
    onToggleSegment(STATUS_KEY),
  );
  const statusIcon = (
    <Icon name={iconName} className="size-3.5 shrink-0" aria-hidden="true" />
  );
  const showStatusAction = statusAction !== null && !hasParentThread;
  const parentSegment = (
    part: ExperimentalThreadContextSegmentProps["part"],
  ) =>
    hasParentThread ? (
      <ThreadContextSegmentMount
        entry={PARENT_THREAD_ENTRY}
        {...input}
        part={part}
        segments={READ_ONLY_SEGMENTS}
        isExpanded={expandedSegment === PARENT_THREAD_KEY}
        onToggle={() => onToggleSegment(PARENT_THREAD_KEY)}
      />
    ) : null;
  return (
    <PromptStackCard
      ariaLabel="Thread history"
      className="overflow-hidden"
      style={{ minHeight: PROMPT_STACK_CARD_ROW_HEIGHT }}
    >
      <div
        className={cn(
          "flex items-center gap-0.5 text-xs text-muted-foreground",
          PROMPT_STACK_INLAY_INSET_CLASS,
        )}
      >
        {parentSegment("summary")}
        {description === null ? (
          <div
            className={cn(
              "flex min-w-0 items-center gap-1.5 text-xs",
              PROMPT_STACK_INLAY_SEGMENT_CLASS,
            )}
            role="status"
            aria-label={statusLabel}
          >
            {statusIcon}
            <span className="min-w-0 truncate" aria-hidden="true">
              {statusLabel}
            </span>
          </div>
        ) : (
          <SectionToggleButton
            buttonRef={statusFocus.triggerRef}
            fillRow
            id={SECTION_IDS.status.toggle}
            controlsId={SECTION_IDS.status.body}
            icon={statusIcon}
            label={statusLabel}
            hideLabelInCompact={false}
            isExpanded={isStatusExpanded}
            onToggle={statusFocus.onTriggerClick}
          />
        )}
        {showStatusAction ? (
          <BannerActionSlot>{statusAction}</BannerActionSlot>
        ) : null}
      </div>
      {description === null ? null : (
        <AnimatedDisclosureBody
          collapsedBorder="reserve"
          id={SECTION_IDS.status.body}
          labelledBy={SECTION_IDS.status.toggle}
          isExpanded={isStatusExpanded}
          collapseLabel={`Collapse ${statusLabel.toLowerCase()}`}
          collapseRef={statusFocus.collapseRef}
          onCollapse={statusFocus.onCollapseClick}
        >
          <p className="px-3 pb-2 pt-1.5 text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        </AnimatedDisclosureBody>
      )}
      {parentSegment("details")}
    </PromptStackCard>
  );
}

function WritableContextBanner({
  input,
  showInlineSegments,
  expandedSegment,
  onToggleSegment,
}: {
  input: ExperimentalThreadContextSegmentInput;
  showInlineSegments: boolean;
  expandedSegment: string | null;
  onToggleSegment: (key: string) => void;
}) {
  const { entries, observers } = useThreadContextSegments(
    input,
    coreThreadContextSegments,
  );
  const before = entries.filter(({ slot }) => slot.placement === "before");
  const inline = showInlineSegments
    ? entries.filter(({ slot }) => slot.placement !== "before")
    : [];
  const mount = (
    entry: ThreadContextSegmentEntry,
    part: ExperimentalThreadContextSegmentProps["part"],
    segments: ExperimentalThreadContextSegmentProps["segments"],
  ) => {
    const key = threadContextSegmentKey(entry.slot);
    return (
      <ThreadContextSegmentMount
        key={threadContextSegmentMountKey(entry, input.threadId, part)}
        entry={entry}
        {...input}
        part={part}
        segments={segments}
        isExpanded={expandedSegment === key}
        onToggle={() => onToggleSegment(key)}
      />
    );
  };
  const inlineSegments = inline.map(({ slot }) => ({
    pluginId: slot.pluginId,
    id: slot.id,
  }));
  const contextCard =
    inline.length > 0 ? (
      <PromptStackCard
        ariaLabel="Thread context before sending"
        className="overflow-hidden"
        style={{ minHeight: PROMPT_CONTEXT_BANNER_COLLAPSED_HEIGHT }}
      >
        <div
          className={cn(
            "flex items-center gap-0.5 text-xs text-muted-foreground",
            PROMPT_STACK_INLAY_INSET_CLASS,
          )}
        >
          {inline.map((entry) => mount(entry, "summary", inlineSegments))}
          {inline.map((entry) => mount(entry, "action", inlineSegments))}
        </div>
        {inline.map((entry) => mount(entry, "details", inlineSegments))}
      </PromptStackCard>
    ) : null;
  return (
    <>
      {observers}
      {before.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-2">
          {before.map((entry) => mount(entry, "summary", []))}
          {contextCard}
        </div>
      ) : (
        contextCard
      )}
    </>
  );
}

export function ThreadPromptContextBanner({
  input,
  core,
  archivedSection,
  environmentGoneSection,
  showInlineSegments,
  expandedSegment,
  onToggleSegment,
}: ThreadPromptContextBannerProps) {
  const isReadOnly =
    archivedSection !== null || environmentGoneSection !== null;
  const parentFocus = useDisclosureFocusHandoff(
    expandedSegment === PARENT_THREAD_KEY,
    () => onToggleSegment(PARENT_THREAD_KEY),
  );
  const gitFocus = useDisclosureFocusHandoff(
    expandedSegment === CHANGED_FILES_KEY,
    () => onToggleSegment(CHANGED_FILES_KEY),
  );
  useExpandForNewNeedsInput(
    isReadOnly
      ? NO_CHILD_THREAD_ITEMS
      : (core.childThreads?.items ?? NO_CHILD_THREAD_ITEMS),
    expandedSegment,
    () => onToggleSegment(CHILD_THREADS_KEY),
  );
  const context: CoreThreadContextValue = { ...core, parentFocus, gitFocus };
  if (isReadOnly) {
    const environmentGoneCopy = environmentGoneSection
      ? ENVIRONMENT_GONE_STATUS_COPY[environmentGoneSection.status]
      : null;
    return (
      <CoreThreadContextContext.Provider value={context}>
        <ReadOnlyContextBanner
          input={input}
          iconName={environmentGoneSection ? "CircleX" : "Archive"}
          statusLabel={
            environmentGoneCopy?.label ?? ARCHIVED_THREAD_STATUS_LABEL
          }
          description={environmentGoneCopy?.description ?? null}
          statusAction={
            archivedSection?.onUnarchive ? (
              <PendingBannerActionButton
                pending={Boolean(archivedSection.unarchivePending)}
                label="Unarchive"
                pendingLabel="Unarchiving..."
                onClick={archivedSection.onUnarchive}
              />
            ) : environmentGoneSection?.onRestore ? (
              <PendingBannerActionButton
                pending={Boolean(environmentGoneSection.restorePending)}
                label="Restore workspace"
                pendingLabel="Restoring..."
                onClick={environmentGoneSection.onRestore}
              />
            ) : null
          }
          hasParentThread={core.parentThread !== null}
          expandedSegment={expandedSegment}
          onToggleSegment={onToggleSegment}
        />
      </CoreThreadContextContext.Provider>
    );
  }
  return (
    <CoreThreadContextContext.Provider value={context}>
      <WritableContextBanner
        input={input}
        showInlineSegments={showInlineSegments && !core.gitPending}
        expandedSegment={expandedSegment}
        onToggleSegment={onToggleSegment}
      />
    </CoreThreadContextContext.Provider>
  );
}
