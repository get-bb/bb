import { PromptStackSectionToggleButton } from "@bb/shared-ui/prompt-stack-section-toggle";
import {
  ThreadContextSegment,
  useThreadContextSegments,
} from "@/components/plugin/PluginThreadContextSegments";
import {
  collectPluginAppRegistrations,
  definePluginApp,
} from "@/lib/plugin-app-definition";
import type { ExperimentalThreadContextSegmentProps } from "@get-bb/plugin-sdk";
import {
  machineRemovalDescriptions,
  machineRemovalLabels,
  type MachineRemovalStatus,
} from "@/lib/machine-removal-display";
import {
  createContext,
  useContext,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useId,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { NavLink } from "react-router-dom";
import type {
  EnvironmentStatus,
  PendingInteraction,
  ThreadPullRequest,
  ThreadRuntimeDisplayStatus,
} from "@bb/domain";
import type { PullRequestMergeMethod } from "@bb/server-contract";
import {
  PromptStackCard,
  PROMPT_STACK_CARD_HEADER_BUTTON_CLASS,
  PROMPT_STACK_CARD_ROW_HEIGHT,
  PROMPT_CONTEXT_BANNER_COLLAPSED_HEIGHT,
  PROMPT_STACK_INLAY_INSET_CLASS,
  PROMPT_STACK_INLAY_SEGMENT_CLASS,
} from "@bb/shared-ui/prompt-stack-card";
import {
  activityIconClass,
  activityRowClass,
  activityTextClass,
} from "@bb/shared-ui/activity-row-styles";
import { formatPendingInteractionSummary } from "@bb/core-ui";
import { InlinePendingInteractionContext } from "@/components/thread/pending-interactions/PendingInteractionShell";
import { ThreadPendingInteractionBanners } from "@/components/thread/pending-interactions/ThreadPendingInteractionBanner";
import { cn } from "@bb/shared-ui/lib/utils";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import {
  describePullRequestStatus,
  getPullRequestNextStep,
  isPullRequestAutoMergeOn,
  getPullRequestGithubCheckStatus,
  PULL_REQUEST_STATE_DISPLAY,
} from "@/lib/pull-request-display";
import { PullRequestNextStepLabel } from "@/components/pull-request/PullRequestNextStepLabel";
import { PullRequestStatusPill } from "@/components/pull-request/PullRequestStatusPill";
import {
  AnimatedBody,
  AnimatedDisclosureBody,
} from "@bb/shared-ui/prompt-stack-body";
import {
  PROMPT_STACK_DISCLOSURE_TRIGGER_CLASS,
  PromptStackCollapseRow,
  PromptStackCountSlot,
  useDisclosureFocusHandoff,
} from "@bb/shared-ui/prompt-stack-disclosure";
import {
  BannerActionSlot,
  PROMPT_BANNER_ACTION_FILL_CLASS,
  PROMPT_BANNER_ACTION_SEGMENT_CLASS,
  PromptBannerActionButton,
} from "@bb/shared-ui/prompt-banner-actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { useUrlAnchorClickHandler } from "@/lib/url-open-routing";
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

export interface ThreadPromptPullRequestSection {
  pullRequest: ThreadPullRequest;
  actions?: {
    isPending?: boolean;
    onMarkReady?: () => void;
    onMerge?: (method: PullRequestMergeMethod) => void;
    onConvertToDraft?: () => void;
    selectedMergeMethod?: PullRequestMergeMethod;
  };
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

export type ThreadPromptContextBannerExpandedSection =
  | "parentThread"
  | "childThreads"
  | "status";

interface ThreadPromptContextBannerProps {
  threadId: string;
  archivedSection: ThreadPromptArchivedSection | null;
  environmentGoneSection: ThreadPromptEnvironmentGoneSection | null;
  parentThreadSection: ThreadPromptParentThreadSection | null;
  childThreadsSection: ThreadPromptChildThreadsSection | null;
  pullRequestSection: ThreadPromptPullRequestSection | null;
  expandedSection: ThreadPromptContextBannerExpandedSection | null;
  onToggleSection: (section: ThreadPromptContextBannerExpandedSection) => void;
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
  git: {
    toggle: "thread-prompt-banner-git-toggle",
    body: "thread-prompt-banner-git-body",
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

function shouldShowPullRequestAttentionLabel(
  pullRequest: ThreadPullRequest,
): boolean {
  if (pullRequest.attention === "checks_failed") return false;
  return (
    (pullRequest.state === "open" && pullRequest.attention === "queued") ||
    pullRequest.attention === "changes_requested" ||
    pullRequest.attention === "review_requested" ||
    pullRequest.attention === "conflicts" ||
    pullRequest.attention === "blocked"
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
    <PromptStackSectionToggleButton
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

const PromptBannerActionGroup = ({ children }: { children: ReactNode }) => (
  <div
    className={cn(
      "inline-flex overflow-hidden rounded border border-border",
      PROMPT_BANNER_ACTION_FILL_CLASS,
    )}
  >
    {children}
  </div>
);

const PromptBannerActionSegmentButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function PromptBannerActionSegmentButton(
  { className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "px-1.5 py-0.5",
        PROMPT_BANNER_ACTION_SEGMENT_CLASS,
        className,
      )}
      {...props}
    />
  );
});

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

const PULL_REQUEST_MERGE_ACTIONS: readonly {
  method: PullRequestMergeMethod;
  label: string;
}[] = [
  { method: "merge", label: "Merge" },
  { method: "squash", label: "Squash merge" },
  { method: "rebase", label: "Rebase and merge" },
];

function PullRequestMergeSplitButton({
  disabled,
  onConvertToDraft,
  onMerge,
  selectedMethod,
}: {
  disabled?: boolean;
  onConvertToDraft?: () => void;
  onMerge: (method: PullRequestMergeMethod) => void;
  selectedMethod: PullRequestMergeMethod;
}) {
  const selectedAction =
    PULL_REQUEST_MERGE_ACTIONS.find(
      (action) => action.method === selectedMethod,
    ) ?? PULL_REQUEST_MERGE_ACTIONS[0];
  return (
    <PromptBannerActionGroup>
      <PromptBannerActionSegmentButton
        disabled={Boolean(disabled)}
        onClick={() => onMerge(selectedAction.method)}
      >
        {selectedAction.label}
      </PromptBannerActionSegmentButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <PromptBannerActionSegmentButton
            disabled={Boolean(disabled)}
            className={cn(
              "inline-flex items-center border-l border-border px-1 data-[state=open]:bg-state-active data-[state=open]:text-foreground",
            )}
            aria-label="Choose pull request merge method"
          >
            <Icon name="ChevronDown" className="size-3" aria-hidden="true" />
          </PromptBannerActionSegmentButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={2}
          mobileTitle="Merge pull request"
        >
          {PULL_REQUEST_MERGE_ACTIONS.map((action) => (
            <DropdownMenuItem
              key={action.method}
              onSelect={() => onMerge(action.method)}
              textValue={action.label}
            >
              {action.label}
            </DropdownMenuItem>
          ))}
          {onConvertToDraft ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={onConvertToDraft}
                textValue="Convert to draft"
              >
                Convert to draft
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </PromptBannerActionGroup>
  );
}

function PullRequestBannerLink({
  pullRequest,
  hideLabelInCompact,
  showLabel,
  showStateLabel,
}: {
  pullRequest: ThreadPullRequest;
  hideLabelInCompact: boolean;
  showLabel: boolean;
  showStateLabel: boolean;
}) {
  const nextStep = getPullRequestNextStep(pullRequest);
  const stateDisplay = PULL_REQUEST_STATE_DISPLAY[pullRequest.state];
  const handlePullRequestClick = useUrlAnchorClickHandler(pullRequest.url);
  const showAttentionLabel =
    showLabel && shouldShowPullRequestAttentionLabel(pullRequest);
  return (
    <a
      href={pullRequest.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handlePullRequestClick}
      aria-label={`Pull request ${pullRequest.number}: ${describePullRequestStatus(pullRequest)}`}
      className={cn(
        "flex items-center gap-1.5 text-xs text-muted-foreground no-underline transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        PROMPT_STACK_INLAY_SEGMENT_CLASS,
        getPullRequestGithubCheckStatus(pullRequest) !== null
          ? "min-w-13"
          : "min-w-8",
        "overflow-hidden",
      )}
    >
      <PullRequestStatusPill pullRequest={pullRequest} className="h-4" />
      {showLabel ? (
        <span
          className="min-w-0 truncate"
          data-promptbox-hide-compact={hideLabelInCompact ? "" : undefined}
        >
          PR #{pullRequest.number}
          {showStateLabel && pullRequest.state !== "open"
            ? ` · ${stateDisplay.label}`
            : ""}
        </span>
      ) : null}
      {showAttentionLabel && nextStep ? (
        <>
          <span aria-hidden>·</span>
          <PullRequestNextStepLabel nextStep={nextStep} />
        </>
      ) : null}
      {showLabel && isPullRequestAutoMergeOn(pullRequest) ? (
        <Icon
          name="Zap"
          aria-label="Auto-merge on"
          className="size-3 shrink-0 text-subtle-foreground"
        />
      ) : null}
    </a>
  );
}

const NO_CHILD_THREAD_ITEMS: readonly ThreadPromptChildThreadItem[] = [];

function useExpandForNewNeedsInput(
  items: readonly ThreadPromptChildThreadItem[],
  hasExpandedSection: boolean,
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
    if (hasNewNeedsInput && !hasExpandedSection) {
      onExpand();
    }
  }, [needsInputKey, hasExpandedSection, onExpand]);
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

interface ReadOnlyContextBannerProps {
  threadId: string;
  iconName: IconName;
  statusLabel: string;
  description: string | null;
  parentThreadSection: ThreadPromptParentThreadSection | null;
  statusAction: ReactNode;
  expandedSection: ThreadPromptContextBannerExpandedSection | null;
  onToggleSection: (section: ThreadPromptContextBannerExpandedSection) => void;
}

function ReadOnlyContextBanner({
  threadId,
  iconName,
  statusLabel,
  description,
  parentThreadSection,
  statusAction,
  expandedSection,
  onToggleSection,
}: ReadOnlyContextBannerProps) {
  const segmentInstanceId = useId();
  const isParentThreadExpanded =
    expandedSection === "parentThread" && parentThreadSection !== null;
  const isStatusExpanded = expandedSection === "status" && description !== null;
  const parentFocus = useDisclosureFocusHandoff(isParentThreadExpanded, () =>
    onToggleSection("parentThread"),
  );
  const statusFocus = useDisclosureFocusHandoff(isStatusExpanded, () =>
    onToggleSection("status"),
  );
  const hasMultipleSegments = parentThreadSection !== null;
  const statusIcon = (
    <Icon name={iconName} className="size-3.5 shrink-0" aria-hidden="true" />
  );
  const showStatusAction = statusAction !== null && !hasMultipleSegments;
  const parentSlot = coreContextSegments[0];
  if (!parentSlot) return null;
  const renderParent = (part: "summary" | "details") => (
    <ThreadContextSegment
      slot={parentSlot}
      threadId={threadId}
      experimental_instanceId={`${segmentInstanceId}/${parentSlot.pluginId}/${parentSlot.id}/${parentSlot.generation}/${threadId}`}
      part={part}
      segmentCount={2}
      isExpanded={isParentThreadExpanded}
      onToggle={parentFocus.onTriggerClick}
    />
  );
  return (
    <ParentSegmentContext.Provider
      value={
        parentThreadSection
          ? {
              section: parentThreadSection,
              inline: false,
              isExpanded: isParentThreadExpanded,
              focus: parentFocus,
            }
          : null
      }
    >
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
          {parentThreadSection ? renderParent("summary") : null}
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
            <PromptStackSectionToggleButton
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
        {parentThreadSection ? renderParent("details") : null}
      </PromptStackCard>
    </ParentSegmentContext.Provider>
  );
}

const ParentSegmentContext = createContext<{
  section: ThreadPromptParentThreadSection;
  inline: boolean;
  isExpanded: boolean;
  focus: ReturnType<typeof useDisclosureFocusHandoff>;
} | null>(null);
const ChildSegmentContext = createContext<{
  section: ThreadPromptChildThreadsSection;
  isExpanded: boolean;
  onToggle(): void;
} | null>(null);
function ParentContextSegment({ part }: ExperimentalThreadContextSegmentProps) {
  const context = useContext(ParentSegmentContext);
  if (!context) return null;
  const { section, inline, isExpanded, focus } = context;
  if (part === "summary")
    return inline ? (
      <ParentThreadInlineSegment section={section} />
    ) : (
      <ParentThreadSectionToggle
        section={section}
        buttonRef={focus.triggerRef}
        isExpanded={isExpanded}
        onToggle={focus.onTriggerClick}
      />
    );
  return inline ? null : (
    <ParentThreadSectionBody
      section={section}
      isExpanded={isExpanded}
      collapseRef={focus.collapseRef}
      onCollapse={focus.onCollapseClick}
    />
  );
}
function ChildContextSegment({ part }: ExperimentalThreadContextSegmentProps) {
  const context = useContext(ChildSegmentContext);
  return context && part === "summary" ? (
    <ActiveChildThreadsCard
      childThreadsSection={context.section}
      isExpanded={context.isExpanded}
      onToggle={context.onToggle}
    />
  ) : null;
}
const coreContextSegments = collectPluginAppRegistrations(
  definePluginApp((app) => {
    app.slots.experimental_threadContextSegment({
      id: "parent-thread",
      title: "Parent thread",
      component: ParentContextSegment,
    });
    app.slots.experimental_threadContextSegment({
      id: "child-threads",
      title: "Child threads",
      placement: "before",
      component: ChildContextSegment,
    });
  }),
).threadContextSegments.map((slot) => ({
  ...slot,
  pluginId: "core",
  generation: 0,
}));

export function ThreadPromptContextBanner({
  threadId,
  archivedSection,
  environmentGoneSection,
  parentThreadSection,
  childThreadsSection,
  pullRequestSection,
  expandedSection,
  onToggleSection,
}: ThreadPromptContextBannerProps) {
  const segmentInstanceId = useId();
  const contributions = useThreadContextSegments(
    threadId,
    coreContextSegments.filter((slot) =>
      slot.id === "parent-thread"
        ? parentThreadSection !== null
        : !archivedSection &&
          !environmentGoneSection &&
          (childThreadsSection?.items.length ?? 0) > 0,
    ),
  );
  const [expandedPluginSegment, setExpandedPluginSegment] = useState<
    string | null
  >(null);
  const inlineSegments = contributions.slots.filter(
    (slot) => slot.placement !== "before",
  );
  const beforeSegments = contributions.slots.filter(
    (slot) => slot.placement === "before",
  );
  const renderSegment = (
    slot: (typeof inlineSegments)[number],
    part: "summary" | "details",
    segmentCount: number,
  ) => (
    <ThreadContextSegment
      key={`${slot.pluginId}/${slot.id}/${slot.generation}/${threadId}/${part}`}
      slot={slot}
      threadId={threadId}
      experimental_instanceId={`${segmentInstanceId}/${slot.pluginId}/${slot.id}/${slot.generation}/${threadId}`}
      part={part}
      segmentCount={segmentCount}
      isExpanded={
        expandedPluginSegment ===
        `${slot.pluginId}/${slot.id}/${slot.generation}/${threadId}`
      }
      onToggle={() =>
        setExpandedPluginSegment((current) =>
          current ===
          `${slot.pluginId}/${slot.id}/${slot.generation}/${threadId}`
            ? null
            : `${slot.pluginId}/${slot.id}/${slot.generation}/${threadId}`,
        )
      }
    />
  );
  const parentFocus = useDisclosureFocusHandoff(
    expandedSection === "parentThread",
    () => onToggleSection("parentThread"),
  );
  const childThreadItems =
    archivedSection || environmentGoneSection
      ? NO_CHILD_THREAD_ITEMS
      : (childThreadsSection?.items ?? NO_CHILD_THREAD_ITEMS);
  useExpandForNewNeedsInput(
    childThreadItems,
    expandedSection !== null || expandedPluginSegment !== null,
    () => onToggleSection("childThreads"),
  );
  const showChildThreads =
    childThreadsSection !== null && childThreadItems.length > 0;
  const withActiveChildThreads = (contextBanner: ReactNode) => (
    <ChildSegmentContext.Provider
      value={
        showChildThreads && childThreadsSection
          ? {
              section: childThreadsSection,
              isExpanded: expandedSection === "childThreads",
              onToggle: () => onToggleSection("childThreads"),
            }
          : null
      }
    >
      {contributions.observers}
      {beforeSegments.length > 0 ? (
        <div className="min-w-0 space-y-2">
          {beforeSegments.map((slot) => (
            <div
              key={`${slot.pluginId}/${slot.id}/${slot.generation}/${threadId}`}
            >
              {renderSegment(slot, "summary", 0)}
            </div>
          ))}
          {contextBanner}
        </div>
      ) : (
        contextBanner
      )}
    </ChildSegmentContext.Provider>
  );
  if (archivedSection || environmentGoneSection) {
    const environmentGone = environmentGoneSection !== null;
    const environmentGoneCopy = environmentGoneSection
      ? ENVIRONMENT_GONE_STATUS_COPY[environmentGoneSection.status]
      : null;
    return (
      <ReadOnlyContextBanner
        threadId={threadId}
        iconName={environmentGone ? "CircleX" : "Archive"}
        statusLabel={environmentGoneCopy?.label ?? ARCHIVED_THREAD_STATUS_LABEL}
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
        parentThreadSection={parentThreadSection}
        expandedSection={expandedSection}
        onToggleSection={onToggleSection}
      />
    );
  }
  const showParentThread = parentThreadSection !== null;
  const showPullRequest = pullRequestSection !== null;
  if (
    inlineSegments.length === 0 &&
    !showChildThreads &&
    !showPullRequest &&
    beforeSegments.length === 0
  ) {
    return withActiveChildThreads(null);
  }
  const visibleSegmentCount = inlineSegments.length + Number(showPullRequest);
  const hasSingleVisibleSegment = visibleSegmentCount === 1;
  const isPullRequestAndGitOnly =
    showPullRequest &&
    visibleSegmentCount === 2 &&
    inlineSegments.some(
      (slot) => slot.pluginId === "bb--git" && slot.id === "changes",
    );
  const isParentThreadExpanded =
    expandedSection === "parentThread" && showParentThread;
  const isParentThreadOnly = showParentThread && visibleSegmentCount === 1;

  const pullRequest = pullRequestSection?.pullRequest ?? null;
  const showPullRequestLabel =
    hasSingleVisibleSegment || isPullRequestAndGitOnly;
  const pullRequestActions = pullRequestSection?.actions;
  const pullRequestAction =
    pullRequest && pullRequestActions ? (
      pullRequest.state === "draft" && pullRequestActions.onMarkReady ? (
        <BannerActionSlot>
          <PendingBannerActionButton
            pending={Boolean(pullRequestActions.isPending)}
            label="Mark ready"
            pendingLabel="Marking..."
            onClick={pullRequestActions.onMarkReady}
          />
        </BannerActionSlot>
      ) : pullRequest.state === "open" &&
        pullRequest.mergeability.state === "mergeable" &&
        pullRequestActions.onMerge ? (
        <BannerActionSlot>
          <PullRequestMergeSplitButton
            disabled={pullRequestActions.isPending}
            onConvertToDraft={pullRequestActions.onConvertToDraft}
            onMerge={pullRequestActions.onMerge}
            selectedMethod={pullRequestActions.selectedMergeMethod ?? "merge"}
          />
        </BannerActionSlot>
      ) : null
    ) : null;

  const compactContextBanner =
    visibleSegmentCount > 0 ? (
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
          {inlineSegments.map((slot) =>
            renderSegment(slot, "summary", visibleSegmentCount),
          )}
          {showPullRequest && pullRequest ? (
            <PullRequestBannerLink
              pullRequest={pullRequest}
              hideLabelInCompact={!hasSingleVisibleSegment}
              showLabel={showPullRequestLabel}
              showStateLabel={hasSingleVisibleSegment}
            />
          ) : null}
          {pullRequestAction}
        </div>
        {inlineSegments.map((slot) =>
          renderSegment(slot, "details", visibleSegmentCount),
        )}
      </PromptStackCard>
    ) : null;

  return withActiveChildThreads(
    <ParentSegmentContext.Provider
      value={
        parentThreadSection
          ? {
              section: parentThreadSection,
              inline: isParentThreadOnly,
              isExpanded: isParentThreadExpanded,
              focus: parentFocus,
            }
          : null
      }
    >
      {compactContextBanner}
    </ParentSegmentContext.Provider>,
  );
}
