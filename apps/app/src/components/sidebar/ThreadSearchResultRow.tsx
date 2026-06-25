import {
  memo,
  useCallback,
  useEffect,
  useRef,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import type { ThreadListEntry } from "@bb/domain";
import type { ThreadSearchMatch } from "@bb/server-contract";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { Icon } from "@/components/ui/icon.js";
import { formatRelativeTime } from "@/lib/relative-time";
import {
  hasActiveWorkflowActivity,
  isBusyThread,
  isRuntimeBusyThread,
} from "@/lib/thread-activity";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { cn } from "@/lib/utils";
import { ThreadStatusGlyph } from "./ThreadRow";
import {
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  SIDEBAR_STANDARD_ROW_PADDING_CLASS,
} from "./sidebarRowClasses";

interface ThreadSearchResultRowProps {
  id: string;
  isActive: boolean;
  matches: readonly ThreadSearchMatch[];
  onActive: () => void;
  onSelect: () => void;
  projectName: string | undefined;
  /**
   * Pre-formatted folder path (e.g. "Infra › CI") shown in place of the project
   * when the sidebar is organized by folder. The caller derives it from the
   * thread's folder + the Organize-by setting; absent → falls back to project.
   */
  folderLabel?: string | null;
  thread: ThreadListEntry;
}

interface HighlightedTextProps {
  ranges: ThreadSearchMatch["highlightRanges"];
  text: string;
}

const TITLE_SOURCE_KINDS = new Set<ThreadSearchMatch["sourceKind"]>([
  "title",
  "title_fallback",
]);

function clampRange(
  range: ThreadSearchMatch["highlightRanges"][number],
  textLength: number,
): ThreadSearchMatch["highlightRanges"][number] | null {
  const start = Math.max(0, Math.min(range.start, textLength));
  const end = Math.max(start, Math.min(range.end, textLength));
  return end > start ? { start, end } : null;
}

function HighlightedText({ ranges, text }: HighlightedTextProps) {
  if (ranges.length === 0 || text.length === 0) {
    return text;
  }

  const nodes: ReactNode[] = [];
  let cursor = 0;
  const sortedRanges = ranges
    .map((range) => clampRange(range, text.length))
    .filter((range): range is NonNullable<typeof range> => range !== null)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  for (const range of sortedRanges) {
    if (range.start < cursor) {
      continue;
    }
    if (range.start > cursor) {
      nodes.push(text.slice(cursor, range.start));
    }
    nodes.push(
      <mark
        key={`${range.start}:${range.end}`}
        className="rounded-sm bg-[var(--sidebar-search-match)] px-0 text-sidebar-accent-foreground shadow-[0_0_0_1px_var(--sidebar-search-match-border)]"
      >
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  }
  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}

function getTitleMatch(
  title: string,
  matches: readonly ThreadSearchMatch[],
): ThreadSearchMatch | undefined {
  return matches.find(
    (match) => TITLE_SOURCE_KINDS.has(match.sourceKind) && match.text === title,
  );
}

function getSnippetMatch(
  matches: readonly ThreadSearchMatch[],
): ThreadSearchMatch | undefined {
  return matches.find((match) => !TITLE_SOURCE_KINDS.has(match.sourceKind));
}

function isNonEmptyMetadataPart(value: string | null): value is string {
  return value !== null && value.length > 0;
}

function ThreadSearchResultRowComponent({
  id,
  isActive,
  matches,
  onActive,
  onSelect,
  projectName,
  folderLabel,
  thread,
}: ThreadSearchResultRowProps) {
  const rowRef = useRef<HTMLButtonElement | null>(null);
  const title = getThreadDisplayTitle(thread);
  const titleMatch = getTitleMatch(title, matches);
  const snippetMatch = getSnippetMatch(matches);
  const primaryMatch = snippetMatch ?? titleMatch;
  const primaryText = primaryMatch?.text ?? title;
  const primaryHighlightRanges = primaryMatch?.highlightRanges ?? [];
  const hasPendingInteraction = thread.hasPendingInteraction;
  const threadRuntimeBusy =
    isRuntimeBusyThread(thread) && !hasPendingInteraction;
  const threadWorkflowActive =
    !threadRuntimeBusy &&
    !hasPendingInteraction &&
    hasActiveWorkflowActivity(thread);
  const threadIsBusy = isBusyThread(thread) && !hasPendingInteraction;
  // For recents and title-only matches, the second line shows the project and
  // when the thread was last active.
  const projectMetadata =
    thread.projectId !== PERSONAL_PROJECT_ID && projectName
      ? projectName
      : null;
  // Folder takes the project's place on the metadata line when the sidebar is
  // organized by folder (the caller supplies a folderLabel only then).
  const contextLabel = folderLabel ?? projectMetadata;
  const relativeTime = formatRelativeTime({
    timestamp: thread.updatedAt,
    now: Date.now(),
  });
  const metadataText = [
    snippetMatch ? title : null,
    contextLabel,
    relativeTime,
  ]
    .filter(isNonEmptyMetadataPart)
    .join(" · ");
  const handleMouseEnter = useCallback<
    MouseEventHandler<HTMLButtonElement>
  >(() => {
    onActive();
  }, [onActive]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [isActive]);

  return (
    <button
      ref={rowRef}
      id={id}
      type="button"
      role="option"
      aria-selected={isActive}
      className={cn(
        SIDEBAR_ROW_BASE_CLASS,
        SIDEBAR_STANDARD_ROW_PADDING_CLASS,
        SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
        "min-h-10 py-1.5 pr-2 text-left outline-none ring-sidebar-ring focus-visible:ring-2",
        isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
      onMouseEnter={handleMouseEnter}
      onFocus={onActive}
      onClick={onSelect}
    >
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block min-w-0 truncate">
          <HighlightedText
            text={primaryText}
            ranges={primaryHighlightRanges}
          />
        </span>
        <span
          className="flex min-w-0 items-center gap-1.5 text-xs leading-4 text-muted-foreground"
          title={metadataText}
        >
          {snippetMatch ? (
            <Icon
              name="MessageSquare"
              className="size-3 shrink-0 text-subtle-foreground"
              aria-hidden="true"
            />
          ) : contextLabel ? (
            <Icon name="Folder" className="size-3.5 shrink-0" aria-hidden />
          ) : null}
          <span className="min-w-0 truncate">{metadataText}</span>
        </span>
      </span>
      {hasPendingInteraction || threadIsBusy ? (
        <span className="inline-flex size-4 shrink-0 items-center justify-center">
          <ThreadStatusGlyph
            hasPendingInteraction={hasPendingInteraction}
            isBusy={threadRuntimeBusy}
            isWorkflowActive={threadWorkflowActive}
            showUnreadBadge={false}
            unreadBadgeTone="default"
          />
        </span>
      ) : null}
    </button>
  );
}

export const ThreadSearchResultRow = memo(ThreadSearchResultRowComponent);
