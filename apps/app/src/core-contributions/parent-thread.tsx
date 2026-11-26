import {
  experimental_THREAD_INFO_ROW_GROUPS,
  experimental_threadDisplayTitle,
  type ExperimentalThreadContextCardProps,
  type ExperimentalThreadContextSegmentProps,
} from "@get-bb/plugin-sdk";
import {
  definePluginApp,
  experimental_ThreadContextCardRow as ThreadContextCardRow,
  experimental_ThreadTitleText as ThreadTitleText,
  experimental_useThread as useThread,
  experimental_useThreadTitleDisplayText as useThreadTitleDisplayText,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { CONTEXT_CARD_SEGMENT_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  AnimatedDisclosureBody,
  SectionToggleButton,
} from "@bb/shared-ui/prompt-stack-disclosure";

type Relationship = "parent" | "fork";

interface ParentThread {
  threadId: string;
  title: string;
  relationship: Relationship;
}

const COPY: Record<
  Relationship,
  { verb: string; bodyLead: string; icon: IconName }
> = {
  parent: {
    verb: "Parent",
    bodyLead: "This thread is a child of ",
    icon: "UserRound",
  },
  fork: {
    verb: "Forked from",
    bodyLead: "This thread was forked from ",
    icon: "Fork",
  },
};

const TOGGLE_ID = "thread-prompt-banner-parent-thread-toggle";
const BODY_ID = "thread-prompt-banner-parent-thread-body";

const TITLE_CLASS = "text-foreground/90 underline underline-offset-2";

function useParentThread(threadId: string): ParentThread | null {
  const { thread } = useThread(threadId);
  const relationship: Relationship =
    thread?.originKind === "fork" ? "fork" : "parent";
  const relatedThreadId =
    thread === null
      ? null
      : relationship === "fork"
        ? (thread.sourceThreadId ?? thread.parentThreadId)
        : thread.parentThreadId;
  const { thread: related } = useThread(relatedThreadId ?? "");
  if (
    thread === null ||
    relatedThreadId === null ||
    related === null ||
    related.archivedAt !== null ||
    (relationship === "fork" && related.projectId !== thread.projectId)
  ) {
    return null;
  }
  return {
    threadId: relatedThreadId,
    title: experimental_threadDisplayTitle(related),
    relationship,
  };
}

function useAriaLabel(parent: ParentThread): string {
  const title = useThreadTitleDisplayText(parent.title);
  return `${COPY[parent.relationship].verb} ${title}`;
}

function ParentThreadLink({ parent }: { parent: ParentThread }) {
  const navigate = useBbNavigate();
  return (
    <a href={navigate.experimental_threadHref(parent.threadId)}>
      <ThreadTitleText title={parent.title} className={TITLE_CLASS} inline />
    </a>
  );
}

function InlineSegment({ parent }: { parent: ParentThread }) {
  const ariaLabel = useAriaLabel(parent);
  const copy = COPY[parent.relationship];
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-xs",
        CONTEXT_CARD_SEGMENT_CLASS,
      )}
      title={ariaLabel}
    >
      <Icon name={copy.icon} className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">
        {copy.verb} <ParentThreadLink parent={parent} />
      </span>
    </div>
  );
}

function SectionToggle({
  parent,
  toggleRef,
  isExpanded,
  onToggle,
}: Pick<
  ExperimentalThreadContextSegmentProps,
  "toggleRef" | "isExpanded" | "onToggle"
> & { parent: ParentThread }) {
  const ariaLabel = useAriaLabel(parent);
  return (
    <SectionToggleButton
      buttonRef={toggleRef}
      fillRow={false}
      id={TOGGLE_ID}
      controlsId={BODY_ID}
      ariaLabel={ariaLabel}
      icon={
        <Icon
          name={COPY[parent.relationship].icon}
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

function ParentThreadSummary({
  threadId,
  segments,
  isExpanded,
  onToggle,
  toggleRef,
}: ExperimentalThreadContextSegmentProps) {
  const parent = useParentThread(threadId);
  if (parent === null) return null;
  return segments.length === 1 ? (
    <InlineSegment parent={parent} />
  ) : (
    <SectionToggle
      parent={parent}
      toggleRef={toggleRef}
      isExpanded={isExpanded}
      onToggle={onToggle}
    />
  );
}

function ParentThreadDetails({
  threadId,
  segments,
  isExpanded,
  onToggle,
  collapseRef,
}: ExperimentalThreadContextSegmentProps) {
  const parent = useParentThread(threadId);
  if (parent === null || segments.length === 1) return null;
  return (
    <AnimatedDisclosureBody
      collapsedBorder="reserve"
      id={BODY_ID}
      labelledBy={TOGGLE_ID}
      isExpanded={isExpanded}
      collapseLabel="Collapse parent thread"
      collapseRef={collapseRef}
      onCollapse={onToggle}
    >
      <div className="px-3 pb-2 pt-1.5 text-xs leading-relaxed text-muted-foreground">
        {COPY[parent.relationship].bodyLead}
        <ParentThreadLink parent={parent} />.
      </div>
    </AnimatedDisclosureBody>
  );
}

function ParentRow({ threadId }: ExperimentalThreadContextCardProps) {
  const navigate = useBbNavigate();
  const parent = useParentThread(threadId);
  if (parent === null) return null;
  return (
    <ThreadContextCardRow
      icon={COPY[parent.relationship].icon}
      label={`${COPY[parent.relationship].verb}: ${parent.title}`}
      title={parent.title}
      onClick={() => navigate.toThread(parent.threadId)}
    />
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadContextItem({
    id: "parent-thread",
    title: "Parent thread",
    group: experimental_THREAD_INFO_ROW_GROUPS.thread,
    order: 10,
    banner: {
      summary: ParentThreadSummary,
      details: ParentThreadDetails,
      useVisible: ({ threadId }) => useParentThread(threadId) !== null,
    },
    card: { row: ParentRow },
  });
});
