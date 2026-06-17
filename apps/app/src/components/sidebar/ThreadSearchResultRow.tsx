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
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@/components/ui/coarse-pointer-sizing.js";
import { Icon } from "@/components/ui/icon.js";
import { isBusyThread } from "@/lib/thread-activity";
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
  isArchivedGroup: boolean;
  matches: readonly ThreadSearchMatch[];
  onActive: () => void;
  onSelect: () => void;
  projectName: string | undefined;
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
        className="rounded-sm bg-sidebar-accent px-0 text-sidebar-accent-foreground shadow-[0_0_0_1px_var(--sidebar-border)]"
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

function ThreadSearchResultRowComponent({
  id,
  isActive,
  isArchivedGroup,
  matches,
  onActive,
  onSelect,
  projectName,
  thread,
}: ThreadSearchResultRowProps) {
  const rowRef = useRef<HTMLButtonElement | null>(null);
  const title = getThreadDisplayTitle(thread);
  const titleMatch = getTitleMatch(title, matches);
  const snippetMatch = getSnippetMatch(matches);
  const hasPendingInteraction = thread.hasPendingInteraction;
  const threadIsBusy = isBusyThread(thread) && !hasPendingInteraction;
  const metadataParts = [
    thread.projectId !== PERSONAL_PROJECT_ID ? projectName : undefined,
    thread.environmentBranchName ?? thread.environmentName ?? undefined,
  ].filter((part): part is string => part !== undefined && part.length > 0);
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
      <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center text-subtle-foreground">
        {isArchivedGroup ? (
          <Icon name="Archive" className={COARSE_POINTER_ICON_SIZE_CLASS} />
        ) : (
          <Icon
            name="MessageSquare"
            className={COARSE_POINTER_ICON_SIZE_CLASS}
          />
        )}
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate">
            <HighlightedText
              text={title}
              ranges={titleMatch?.highlightRanges ?? []}
            />
          </span>
          {isArchivedGroup ? (
            <span className="shrink-0 rounded-sm border border-sidebar-border px-1 py-px text-xs leading-none text-subtle-foreground">
              Archived
            </span>
          ) : null}
        </span>
        {snippetMatch ? (
          <span className="block min-w-0 truncate text-xs leading-4 text-muted-foreground">
            <HighlightedText
              text={snippetMatch.text}
              ranges={snippetMatch.highlightRanges}
            />
          </span>
        ) : metadataParts.length > 0 ? (
          <span className="block min-w-0 truncate text-xs leading-4 text-muted-foreground">
            {metadataParts.join(" / ")}
          </span>
        ) : null}
      </span>
      {hasPendingInteraction || threadIsBusy ? (
        <span className="inline-flex size-4 shrink-0 items-center justify-center">
          <ThreadStatusGlyph
            hasPendingInteraction={hasPendingInteraction}
            isBusy={threadIsBusy}
            showUnreadBadge={false}
            unreadBadgeTone="default"
          />
        </span>
      ) : null}
    </button>
  );
}

export const ThreadSearchResultRow = memo(ThreadSearchResultRowComponent);
