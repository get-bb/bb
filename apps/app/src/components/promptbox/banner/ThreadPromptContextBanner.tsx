import {
  experimental_THREAD_CONTEXT_SEGMENT_GROUPS,
  type ExperimentalThreadContextSegmentInput,
  type ExperimentalThreadContextSegmentProps,
} from "@get-bb/plugin-sdk";
import {
  CORE_THREAD_CONTEXT_OWNER,
  ThreadContextSegmentMount,
  threadContextSegmentKey,
  threadContextSegmentMountKey,
  useThreadContextSegments,
  type CoreThreadContextSegment,
  type ThreadContextSegmentEntry,
  type ThreadContextSegmentPart,
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
  ThreadRuntimeDisplayStatus,
} from "@bb/domain";
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
import { formatPendingInteractionSummary } from "@bb/core-ui";
import { InlinePendingInteractionContext } from "@/components/thread/pending-interactions/PendingInteractionShell";
import { ThreadPendingInteractionBanners } from "@/components/thread/pending-interactions/ThreadPendingInteractionBanner";
import { cn } from "@bb/shared-ui/lib/utils";
import { useThreadContextKind } from "@/components/plugin/PluginThreadContextCard";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import {
  AnimatedBody,
  AnimatedDisclosureBody,
  PROMPT_STACK_DISCLOSURE_TRIGGER_CLASS,
  PromptStackCollapseRow,
  PromptStackCountSlot,
  SectionToggleButton,
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
  parentThread: ThreadPromptParentThreadSection | null;
}

interface ThreadPromptContextBannerProps {
  input: ExperimentalThreadContextSegmentInput;
  core: CoreThreadContext;
  archivedSection: ThreadPromptArchivedSection | null;
  environmentGoneSection: ThreadPromptEnvironmentGoneSection | null;
  expandedSegment: string | null;
  onToggleSegment: (key: string) => void;
}

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
  status: {
    toggle: "thread-prompt-banner-status-toggle",
    body: "thread-prompt-banner-status-body",
  },
} as const;

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
  isExpanded: boolean,
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
    if (hasNewNeedsInput && !isExpanded) {
      onExpand();
    }
  }, [needsInputKey, isExpanded, onExpand]);
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

function ParentThreadSummary({
  segments,
  isExpanded,
}: ExperimentalThreadContextSegmentProps) {
  const { parentThread, parentFocus } = useCoreThreadContext();
  if (parentThread === null) return null;
  return segments.length === 1 ? (
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

function ParentThreadDetails({
  segments,
  isExpanded,
}: ExperimentalThreadContextSegmentProps) {
  const { parentThread, parentFocus } = useCoreThreadContext();
  if (parentThread === null || segments.length === 1) return null;
  return (
    <ParentThreadSectionBody
      section={parentThread}
      isExpanded={isExpanded}
      collapseRef={parentFocus.collapseRef}
      onCollapse={parentFocus.onCollapseClick}
    />
  );
}

export function ThreadChildThreadsBanner({
  childThreads,
  isExpanded,
  onExpandedChange,
}: {
  childThreads: ThreadPromptChildThreadsSection | null;
  isExpanded: boolean;
  onExpandedChange: (isExpanded: boolean) => void;
}) {
  const items = childThreads?.items ?? NO_CHILD_THREAD_ITEMS;
  useExpandForNewNeedsInput(items, isExpanded, () => onExpandedChange(true));
  if (childThreads === null || items.length === 0) return null;
  return (
    <ActiveChildThreadsCard
      childThreadsSection={childThreads}
      isExpanded={isExpanded}
      onToggle={() => onExpandedChange(!isExpanded)}
    />
  );
}

const SEGMENT_GROUPS = experimental_THREAD_CONTEXT_SEGMENT_GROUPS;

const coreThreadContextSegments: readonly CoreThreadContextSegment[] =
  collectPluginAppRegistrations(
    definePluginApp((app) => {
      app.slots.experimental_threadContextSegment({
        id: "parent-thread",
        title: "Parent thread",
        group: SEGMENT_GROUPS.thread,
        order: 10,
        summary: ParentThreadSummary,
        details: ParentThreadDetails,
        useVisible: () => {
          const { parentThread } = useCoreThreadContext();
          const kind = useThreadContextKind();
          return parentThread !== null && kind === "banner";
        },
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
const PARENT_THREAD_KEY = threadContextSegmentKey(PARENT_THREAD_SLOT);
const STATUS_KEY = `${CORE_THREAD_CONTEXT_OWNER}/status`;
const READ_ONLY_SEGMENTS = [
  { key: PARENT_THREAD_KEY, pluginId: CORE_THREAD_CONTEXT_OWNER },
  { key: STATUS_KEY, pluginId: CORE_THREAD_CONTEXT_OWNER },
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
  const parentSegment = (part: ThreadContextSegmentPart) =>
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
  expandedSegment,
  onToggleSegment,
}: {
  input: ExperimentalThreadContextSegmentInput;
  expandedSegment: string | null;
  onToggleSegment: (key: string) => void;
}) {
  const { entries, observers } = useThreadContextSegments(
    input,
    coreThreadContextSegments,
  );
  const segments = entries.map(({ slot }) => ({
    key: threadContextSegmentKey(slot),
    pluginId: slot.pluginId,
  }));
  const mount = (
    entry: ThreadContextSegmentEntry,
    part: ThreadContextSegmentPart,
  ) => {
    const key = threadContextSegmentKey(entry.slot);
    return (
      <ThreadContextSegmentMount
        key={threadContextSegmentMountKey(entry, input.threadId, part)}
        entry={entry}
        part={part}
        {...input}
        segments={segments}
        isExpanded={expandedSegment === key}
        onToggle={() => onToggleSegment(key)}
      />
    );
  };
  return (
    <>
      {observers}
      {entries.length > 0 ? (
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
            {entries.map((entry) => mount(entry, "summary"))}
            {entries.map((entry) => mount(entry, "action"))}
          </div>
          {entries.map((entry) => mount(entry, "details"))}
        </PromptStackCard>
      ) : null}
    </>
  );
}

export function ThreadPromptContextBanner({
  input,
  core,
  archivedSection,
  environmentGoneSection,
  expandedSegment,
  onToggleSegment,
}: ThreadPromptContextBannerProps) {
  const isReadOnly =
    archivedSection !== null || environmentGoneSection !== null;
  const parentFocus = useDisclosureFocusHandoff(
    expandedSegment === PARENT_THREAD_KEY,
    () => onToggleSegment(PARENT_THREAD_KEY),
  );
  const context: CoreThreadContextValue = { ...core, parentFocus };
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
        expandedSegment={expandedSegment}
        onToggleSegment={onToggleSegment}
      />
    </CoreThreadContextContext.Provider>
  );
}
