import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useAtomValue, useStore } from "jotai";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { cn } from "@bb/shared-ui/lib/utils";
import { CHROME_SECTION_LABEL_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import {
  getThreadListIndicatorLabel,
  hasActiveBackgroundAgentActivity,
  hasActiveBackgroundCommandActivity,
  hasActiveGoalActivity,
  hasActivePlanModeActivity,
  hasActiveWorkflowActivity,
  isRuntimeBusyThread,
  isUnreadDoneThread,
  resolveThreadListIndicator,
  type ThreadListIndicatorState,
} from "@bb/client-core";
import type { ThreadSearchHighlightRange } from "@bb/server-contract";
import { usePromptDraftHasInput } from "@/hooks/usePromptDraftStorage";
import { ThreadStatusGlyph } from "@/components/sidebar/ThreadRow";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import {
  hasThreadSearchableQuery,
  useThreadSearch,
} from "@/hooks/queries/thread-queries";
import { useRouteNavigate } from "@/components/ui/app-route-anchor";
import {
  NO_THREADS_MESSAGE,
  ThreadListEmptyState,
} from "@/components/thread/ThreadListEmptyState";
import { getThreadRoutePath } from "@/lib/route-paths";
import { openThreadInSplit } from "@/lib/split-layout/openThreadInSplit";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { countPanes, findPaneByContent, MAX_PANES } from "@/lib/split-layout";
import { isMacKeyboardPlatform } from "@bb/domain";
import {
  buildPaletteThreadSearchRows,
  type PaletteThreadSearchRow,
} from "@/lib/command-palette/palette-thread-search";
import { windowPaletteThreadSearchText } from "@/lib/command-palette/palette-thread-search-window";
import type { PaletteModeViewProps } from "@/lib/command-palette/palette-mode";
import { PALETTE_FOOTER_LABEL_CLASS, PaletteShell } from "./PaletteShell";

export function ThreadSearchPaletteMode({
  onExit,
  presentation,
  runAfterClose,
}: PaletteModeViewProps) {
  const listId = useId();
  const optionIdPrefix = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const store = useStore();
  const splitLayout = useAtomValue(splitLayoutAtom);
  const navigate = useRouteNavigate();
  const isCompact = useIsCompactViewport();
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [now] = useState(() => Date.now());
  const navigation = useSidebarNavigation();
  const threadSearch = useThreadSearch({ active: true, query });
  const trimmedQuery = query.trim();
  const searchable = hasThreadSearchableQuery(trimmedQuery);
  const searchResultsAreCurrent =
    !searchable || threadSearch.debouncedQuery === trimmedQuery;

  const projectNamesById = useMemo(() => {
    const entries = [
      ...(navigation.data?.projects ?? []),
      ...(navigation.data === undefined
        ? []
        : [navigation.data.personalProject]),
    ].map((project) => [project.id, project.name] as const);
    return new Map(entries);
  }, [navigation.data]);
  const recentThreads = useMemo(
    () => [
      ...(navigation.data?.projects.flatMap((project) => project.threads) ??
        []),
      ...(navigation.data?.personalProject.threads ?? []),
    ],
    [navigation.data],
  );
  const result = useMemo(
    () =>
      buildPaletteThreadSearchRows({
        now,
        projectNamesById,
        query,
        recentThreads,
        searchResponse: threadSearch.data,
        searchResultsAreCurrent,
      }),
    [
      now,
      projectNamesById,
      query,
      recentThreads,
      searchResultsAreCurrent,
      threadSearch.data,
    ],
  );
  const activeIndex =
    result.rows.length === 0
      ? -1
      : Math.min(highlightedIndex, result.rows.length - 1);
  const isRecentLoading = result.isRecent && navigation.isLoading;
  const hasLoadError = result.isRecent
    ? navigation.isError
    : searchResultsAreCurrent && threadSearch.isError;
  const showThreadListEmptyState =
    result.rows.length === 0 &&
    result.isRecent &&
    !isRecentLoading &&
    !hasLoadError;
  const activeDescendantId =
    activeIndex < 0 ? undefined : `${optionIdPrefix}-${activeIndex}`;
  const activeRow = result.rows[activeIndex];
  const splitDisabledReason =
    splitLayout === null
      ? "Open a thread first to use split view"
      : activeRow !== undefined &&
          findPaneByContent(splitLayout.root, {
            kind: "thread",
            projectId: activeRow.projectId,
            threadId: activeRow.threadId,
          }) !== null
        ? "Already open in this workspace"
        : countPanes(splitLayout.root) >= MAX_PANES
          ? "Close a split pane first"
          : null;
  const canSplit =
    activeRow !== undefined && !isCompact && splitDisabledReason === null;
  const splitShortcut = isMacKeyboardPlatform(navigator.platform)
    ? "⌘↵"
    : "Ctrl+↵";

  const scrollOnNextHighlightRef = useRef(false);
  useEffect(() => {
    if (!scrollOnNextHighlightRef.current) return;
    scrollOnNextHighlightRef.current = false;
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const openRow = useCallback(
    (row: PaletteThreadSearchRow, split: boolean) => {
      runAfterClose(() => {
        const state =
          row.messageSeq === null
            ? undefined
            : {
                searchMessageSeq: row.messageSeq,
                searchThreadId: row.threadId,
              };
        if (split) {
          openThreadInSplit({
            store,
            navigate,
            projectId: row.projectId,
            threadId: row.threadId,
            isCompact,
            state,
          });
          return;
        }
        navigate(
          getThreadRoutePath({
            projectId: row.projectId,
            threadId: row.threadId,
          }),
          { state },
        );
      });
    },
    [isCompact, navigate, runAfterClose, store],
  );

  const handleInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Backspace" && query.length === 0) {
        event.preventDefault();
        event.stopPropagation();
        onExit();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onExit();
        return;
      }
      if (result.rows.length === 0) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        scrollOnNextHighlightRef.current = true;
        setHighlightedIndex((current) => {
          if (event.key === "ArrowDown") {
            return current + 1 >= result.rows.length ? 0 : current + 1;
          }
          return current <= 0 ? result.rows.length - 1 : current - 1;
        });
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        scrollOnNextHighlightRef.current = true;
        setHighlightedIndex(event.key === "Home" ? 0 : result.rows.length - 1);
        return;
      }
      if (event.key === "Enter") {
        const row = result.rows[activeIndex];
        if (row === undefined) return;
        event.preventDefault();
        openRow(row, event.metaKey || event.ctrlKey);
      }
    },
    [activeIndex, onExit, openRow, query.length, result.rows],
  );

  const isLoading =
    searchable &&
    (!searchResultsAreCurrent ||
      threadSearch.isDebouncing ||
      threadSearch.isLoading);
  let emptyMessage: string | null = null;
  if (result.rows.length === 0) {
    emptyMessage =
      isLoading || isRecentLoading
        ? result.isRecent
          ? "Loading threads"
          : "Searching threads"
        : hasLoadError
          ? "Couldn’t load threads"
          : trimmedQuery.length === 1
            ? "Type at least 2 characters"
            : result.isRecent
              ? NO_THREADS_MESSAGE
              : "No matching threads";
  }

  return (
    <PaletteShell
      activeDescendantId={activeDescendantId}
      accessory={
        <>
          {activeRow === undefined || isCompact ? null : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 px-2 text-subtle-foreground aria-disabled:opacity-50"
                  aria-label="Open in split"
                  aria-disabled={!canSplit}
                  aria-keyshortcuts={
                    canSplit ? "Meta+Enter Control+Enter" : undefined
                  }
                  onClick={() => {
                    if (canSplit) openRow(activeRow, true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.preventDefault();
                    event.stopPropagation();
                    onExit();
                  }}
                >
                  <Icon name="Columns2" aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {splitDisabledReason ?? `Open in split (${splitShortcut})`}
              </TooltipContent>
            </Tooltip>
          )}
        </>
      }
      footerKeys={
        canSplit ? [{ keys: [splitShortcut], label: "Open in split" }] : []
      }
      inputDescription={
        canSplit
          ? presentation.inputDescription
          : "Use Escape to return to commands."
      }
      inputLabel="Search threads"
      inputRef={inputRef}
      listId={listId}
      listLabel="Threads"
      listRef={listRef}
      modeChip={{
        ...presentation.chip,
        clearLabel: "Return to commands",
        onClear: onExit,
      }}
      onInputChange={(value) => {
        setQuery(value);
        setHighlightedIndex(0);
        if (listRef.current !== null) listRef.current.scrollTop = 0;
      }}
      onInputKeyDown={handleInputKeyDown}
      placeholder={presentation.placeholder}
      value={query}
    >
      {result.isRecent && result.rows.length > 0 ? (
        <div className={cn(CHROME_SECTION_LABEL_CLASS, "px-2 py-1")}>
          Recent
        </div>
      ) : null}
      {emptyMessage === null ? (
        result.rows.map((row, index) => (
          <ThreadSearchPaletteRow
            key={`${row.id}:${row.primaryText}`}
            id={`${optionIdPrefix}-${index}`}
            isActive={index === activeIndex}
            row={row}
            onActivate={() => setHighlightedIndex(index)}
            onSelect={() => openRow(row, false)}
          />
        ))
      ) : showThreadListEmptyState ||
        (searchable && !isLoading && !hasLoadError) ? (
        <ThreadListEmptyState
          message={emptyMessage}
          className="justify-center px-3 py-4"
        />
      ) : (
        <p className="px-3 py-4 text-center text-sm text-muted-foreground">
          {emptyMessage}
        </p>
      )}
    </PaletteShell>
  );
}

function ThreadSearchPaletteRow({
  id,
  isActive,
  onActivate,
  onSelect,
  row,
}: {
  id: string;
  isActive: boolean;
  onActivate: () => void;
  onSelect: () => void;
  row: PaletteThreadSearchRow;
}) {
  const primaryRef = useRef<HTMLSpanElement | null>(null);
  const matchKey = `${row.primaryText}\u0000${row.highlightRanges
    .map((range) => `${range.start}:${range.end}`)
    .join(",")}`;
  const [windowedMatchKey, setWindowedMatchKey] = useState<string | null>(null);
  const shouldWindowMatch = windowedMatchKey === matchKey;
  const primary = shouldWindowMatch
    ? windowPaletteThreadSearchText({
        text: row.primaryText,
        highlightRanges: row.highlightRanges,
      })
    : { text: row.primaryText, highlightRanges: row.highlightRanges };

  useLayoutEffect(() => {
    if (shouldWindowMatch || row.highlightRanges.length === 0) return;
    const container = primaryRef.current;
    if (container === null) return;
    const firstMatch = container.querySelector("mark");
    if (firstMatch === null) return;
    const containerRect = container.getBoundingClientRect();
    const matchRect = firstMatch.getBoundingClientRect();
    if (
      matchRect.left < containerRect.left ||
      matchRect.right > containerRect.right
    ) {
      setWindowedMatchKey(matchKey);
    }
  }, [matchKey, row.highlightRanges.length, shouldWindowMatch]);

  const metadata = row.metadataText;
  return (
    <div
      id={id}
      role="option"
      aria-selected={isActive}
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm",
        isActive && "bg-state-hover text-foreground",
      )}
      onPointerMove={onActivate}
      onClick={onSelect}
    >
      <span className="min-w-0 flex-1">
        <span
          ref={primaryRef}
          className="block min-w-0 truncate text-foreground"
        >
          <HighlightedText
            text={primary.text}
            ranges={primary.highlightRanges}
          />
        </span>
        {metadata.length === 0 ? null : (
          <span
            className={cn(
              "block min-h-4 truncate text-xs leading-4",
              PALETTE_FOOTER_LABEL_CLASS,
            )}
            data-palette-thread-metadata
            title={metadata}
          >
            {metadata}
          </span>
        )}
      </span>
      <ThreadSearchPaletteStatus row={row} />
    </div>
  );
}

function ThreadSearchPaletteStatus({ row }: { row: PaletteThreadSearchRow }) {
  const hasUnsubmittedDraft = usePromptDraftHasInput({
    kind: "thread",
    projectId: row.projectId,
    threadId: row.threadId,
  });
  const thread = row.thread;
  const unread = isUnreadDoneThread(thread);
  const state: ThreadListIndicatorState = {
    hasPendingInteraction: thread.hasPendingInteraction,
    hasUnsubmittedDraft: hasUnsubmittedDraft,
    hasUnreadError: unread && thread.status === "error",
    hasUnreadSuccess: unread && thread.status !== "error",
    isBackgroundAgentActive: hasActiveBackgroundAgentActivity(thread),
    isBackgroundCommandActive: hasActiveBackgroundCommandActivity(thread),
    isGoalActive: hasActiveGoalActivity(thread),
    isPlanModeActive: hasActivePlanModeActivity(thread),
    isRuntimeActive: isRuntimeBusyThread(thread),
    isWorkflowActive: hasActiveWorkflowActivity(thread),
    queuedWork: thread.queuedWork,
  };
  const kind = resolveThreadListIndicator(state);
  const archived = row.lifecycle === "archived";
  const label = archived
    ? "Archived thread"
    : (getThreadListIndicatorLabel(kind) ?? "Active thread");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={label}
          className="inline-flex size-4 shrink-0 items-center justify-center text-subtle-foreground"
          data-palette-thread-status
        >
          <span aria-hidden="true" className="inline-flex items-center">
            {archived || kind === "none" ? (
              <Icon
                name={archived ? "Archive" : "MessageSquare"}
                className="size-4"
              />
            ) : (
              <ThreadStatusGlyph {...state} />
            )}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

function HighlightedText({
  ranges,
  text,
}: {
  ranges: readonly ThreadSearchHighlightRange[];
  text: string;
}) {
  if (ranges.length === 0) return <>{text}</>;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    const start = Math.max(cursor, Math.min(range.start, text.length));
    const end = Math.max(start, Math.min(range.end, text.length));
    if (end <= start) continue;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    nodes.push(
      <mark
        key={`${start}:${end}`}
        className="rounded-sm bg-[var(--sidebar-search-match)] px-0.5 py-px text-foreground"
      >
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
