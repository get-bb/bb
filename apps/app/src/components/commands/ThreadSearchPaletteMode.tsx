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
import { useAtom, useAtomValue, useStore } from "jotai";
import { isMacKeyboardPlatform } from "@bb/domain";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { Icon } from "@bb/shared-ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { cn } from "@bb/shared-ui/lib/utils";
import { threadListIndicatorStateForThread } from "@bb/client-core";
import type { ThreadSearchMatch } from "@bb/server-contract";
import { usePromptDraftHasInput } from "@/hooks/usePromptDraftStorage";
import {
  ThreadStatusGlyph,
  resolveThreadStatus,
} from "@/components/thread/ThreadStatusGlyph";
import { usePluginThreadRowStatus } from "@/lib/plugin-thread-row-status";
import {
  ThreadLifecycleFilter,
  THREAD_LIFECYCLE_OPTIONS,
} from "@/components/thread/ThreadLifecycleFilter";
import { paletteThreadLifecyclesAtom } from "@/lib/command-palette/palette-preferences";
import {
  normalizeThreadLifecycleFilter,
  type ThreadArchiveFilter,
} from "@/lib/thread-lifecycle-filter";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { usePaletteRecentArchivedThreads } from "@/hooks/queries/palette-thread-queries";
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
import {
  buildPaletteThreadSearchRows,
  type PaletteThreadSearchRow,
} from "@/lib/command-palette/palette-thread-search";
import { windowPaletteThreadSearchText } from "@/lib/command-palette/palette-thread-search-window";
import {
  PALETTE_SECTION_LABEL_CLASS,
  PaletteShell,
  PaletteShortcut,
} from "./PaletteShell";

interface ThreadSearchOption {
  lifecycle: ThreadArchiveFilter;
  row: PaletteThreadSearchRow | null;
}

function optionKey(option: ThreadSearchOption): string {
  return option.row?.id ?? `more:${option.lifecycle}`;
}

export function ThreadSearchPaletteMode({
  onExit,
  runAfterClose,
}: {
  onExit: () => void;
  runAfterClose: (run: () => void) => void;
}) {
  const listId = useId();
  const optionIdPrefix = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const navigate = useRouteNavigate();
  const store = useStore();
  const splitLayout = useAtomValue(splitLayoutAtom);
  const isCompact = useIsCompactViewport();
  const [selectedLifecycles, setLifecycles] = useAtom(
    paletteThreadLifecyclesAtom,
  );
  const lifecycles = useMemo(
    () => normalizeThreadLifecycleFilter(selectedLifecycles),
    [selectedLifecycles],
  );
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<ThreadArchiveFilter[]>([]);
  const filterKey = lifecycles.join(",");
  const [previousFilterKey, setPreviousFilterKey] = useState(filterKey);
  if (previousFilterKey !== filterKey) {
    setPreviousFilterKey(filterKey);
    setExpandedGroups([]);
  }
  const [now] = useState(() => Date.now());
  const navigation = useSidebarNavigation();
  const threadSearch = useThreadSearch({ active: true, query });
  const trimmedQuery = query.trim();
  const archived = usePaletteRecentArchivedThreads({
    enabled: trimmedQuery.length === 0 && lifecycles.includes("archived"),
  });
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
      ...[
        ...(navigation.data?.projects.flatMap((project) => project.threads) ??
          []),
        ...(navigation.data?.personalProject.threads ?? []),
      ],
      ...(lifecycles.includes("archived") ? (archived.data ?? []) : []),
    ],
    [archived.data, lifecycles, navigation.data],
  );
  const result = useMemo(
    () =>
      buildPaletteThreadSearchRows({
        lifecycles,
        now,
        projectNamesById,
        query,
        recentThreads,
        searchResponse: threadSearch.data,
        searchResultsAreCurrent,
      }),
    [
      lifecycles,
      now,
      projectNamesById,
      query,
      recentThreads,
      searchResultsAreCurrent,
      threadSearch.data,
    ],
  );
  const options = useMemo(() => {
    const nonemptyGroups = lifecycles.filter((lifecycle) =>
      result.rows.some((row) => row.lifecycle === lifecycle),
    );
    const limit = nonemptyGroups.length === 2 ? 3 : 6;
    return nonemptyGroups.flatMap((lifecycle) => {
      const rows = result.rows.filter((row) => row.lifecycle === lifecycle);
      const visible = expandedGroups.includes(lifecycle)
        ? rows
        : rows.slice(0, limit);
      const groupOptions: ThreadSearchOption[] = visible.map((row) => ({
        lifecycle,
        row,
      }));
      if (visible.length < rows.length)
        groupOptions.push({ row: null, lifecycle });
      return groupOptions;
    });
  }, [expandedGroups, lifecycles, result]);
  const retainedIndex = options.findIndex(
    (option) => optionKey(option) === highlightedKey,
  );
  const activeIndex =
    retainedIndex >= 0
      ? retainedIndex
      : options.length === 0
        ? -1
        : Math.min(highlightedIndex, options.length - 1);
  useLayoutEffect(() => {
    setHighlightedIndex(Math.max(activeIndex, 0));
    setHighlightedKey(activeIndex < 0 ? null : optionKey(options[activeIndex]));
  }, [activeIndex, options]);
  const highlightOption = useCallback(
    (index: number) => {
      setHighlightedIndex(index);
      setHighlightedKey(
        options[index] === undefined ? null : optionKey(options[index]),
      );
    },
    [options],
  );
  const recentQueries = lifecycles.map((lifecycle) =>
    lifecycle === "active" ? navigation : archived,
  );
  const isRecentLoading =
    result.isRecent && recentQueries.some((result) => result.isLoading);
  const hasLoadError = result.isRecent
    ? recentQueries.some((result) => result.isError)
    : searchResultsAreCurrent && threadSearch.isError;
  const showThreadListEmptyState =
    result.rows.length === 0 &&
    result.isRecent &&
    !isRecentLoading &&
    !hasLoadError;
  const activeDescendantId =
    activeIndex < 0 ? undefined : `${optionIdPrefix}-${activeIndex}`;
  const activeRow = options[activeIndex]?.row;
  const canSplit =
    activeRow != null &&
    !isCompact &&
    splitLayout !== null &&
    findPaneByContent(splitLayout.root, {
      kind: "thread",
      projectId: activeRow.projectId,
      threadId: activeRow.threadId,
    }) === null &&
    countPanes(splitLayout.root) < MAX_PANES;
  const splitModifier = isMacKeyboardPlatform(navigator.platform)
    ? "⌘"
    : "Ctrl";
  const scrollOnNextHighlightRef = useRef(false);
  useEffect(() => {
    if (!scrollOnNextHighlightRef.current) return;
    scrollOnNextHighlightRef.current = false;
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, options]);

  const selectOption = useCallback(
    ({ row, lifecycle }: ThreadSearchOption, index: number, split = false) => {
      if (row === null) {
        scrollOnNextHighlightRef.current = true;
        setExpandedGroups((current) => [...current, lifecycle]);
        setHighlightedIndex(index);
        setHighlightedKey(null);
        inputRef.current?.focus();
        return;
      }
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
      if (options.length === 0) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        scrollOnNextHighlightRef.current = true;
        highlightOption(
          event.key === "ArrowDown"
            ? (activeIndex + 1) % options.length
            : activeIndex <= 0
              ? options.length - 1
              : activeIndex - 1,
        );
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        scrollOnNextHighlightRef.current = true;
        highlightOption(event.key === "Home" ? 0 : options.length - 1);
        return;
      }
      if (event.key === "Enter") {
        const option = options[activeIndex];
        if (option === undefined) return;
        event.preventDefault();
        selectOption(option, activeIndex, event.metaKey || event.ctrlKey);
      }
    },
    [activeIndex, highlightOption, onExit, options, query.length, selectOption],
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
      inputDescription={
        canSplit
          ? `Use ${splitModifier}+Enter to open in split. Use Escape to return to commands.`
          : "Use Escape to return to commands."
      }
      inputLabel="Search threads"
      inputAccessory={
        <div className="max-w-[45%] shrink-0">
          <ThreadLifecycleFilter value={lifecycles} onChange={setLifecycles} />
        </div>
      }
      inputRef={inputRef}
      listId={listId}
      listLabel="Threads"
      listRef={listRef}
      modeChip={{
        icon: "Search",
        label: "Threads",
        clearLabel: "Return to commands",
        onClear: onExit,
        hideShortcut: isCompact,
      }}
      onInputChange={(value) => {
        setQuery(value);
        setHighlightedIndex(0);
        setHighlightedKey(null);
        setExpandedGroups([]);
        if (listRef.current !== null) listRef.current.scrollTop = 0;
      }}
      onInputKeyDown={handleInputKeyDown}
      placeholder="Search title, project, or message…"
      value={query}
    >
      {emptyMessage === null ? (
        THREAD_LIFECYCLE_OPTIONS.map(({ value: lifecycle, label }) => {
          if (!result.rows.some((row) => row.lifecycle === lifecycle)) {
            return null;
          }
          const labelId = `${optionIdPrefix}-${lifecycle}-label`;
          return (
            <div
              key={lifecycle}
              role="group"
              aria-labelledby={labelId}
              className="not-last:mb-2"
            >
              <div id={labelId} className={PALETTE_SECTION_LABEL_CLASS}>
                {label}
              </div>
              {options.map((option, index) =>
                option.lifecycle !== lifecycle ? null : (
                  <div
                    key={
                      option.row === null
                        ? `more:${lifecycle}`
                        : `${option.row.id}:${option.row.primaryText}`
                    }
                    className={cn(
                      "flex min-w-0 items-center rounded-md",
                      index === activeIndex && "bg-state-hover text-foreground",
                    )}
                    onPointerMove={() => highlightOption(index)}
                  >
                    <div
                      id={`${optionIdPrefix}-${index}`}
                      role="option"
                      aria-selected={index === activeIndex}
                      aria-label={
                        option.row !== null
                          ? undefined
                          : lifecycle === "archived"
                            ? "Show more archived threads"
                            : "Show more threads"
                      }
                      className={cn(
                        "flex min-w-0 flex-1 cursor-pointer items-center rounded-md px-2 py-1.5",
                        option.row === null
                          ? "gap-1.5 text-xs text-subtle-foreground"
                          : "min-h-11 gap-3 text-left text-sm",
                      )}
                      onClick={() => selectOption(option, index)}
                    >
                      {option.row === null ? (
                        <>
                          Show more
                          <Icon
                            name="ChevronDown"
                            className="size-3.5"
                            aria-hidden
                          />
                        </>
                      ) : (
                        <ThreadSearchPaletteRow row={option.row} />
                      )}
                    </div>
                    {index === activeIndex && canSplit ? (
                      <button
                        type="button"
                        aria-label="Open in split"
                        className="mr-2 inline-flex h-7 shrink-0 items-center gap-1 rounded-sm px-1 text-xs text-subtle-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                        onClick={() => selectOption(option, index, true)}
                      >
                        <span className="mr-1">Open in split</span>
                        <PaletteShortcut>{`${splitModifier} ↵`}</PaletteShortcut>
                      </button>
                    ) : null}
                  </div>
                ),
              )}
            </div>
          );
        })
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

function ThreadSearchPaletteRow({ row }: { row: PaletteThreadSearchRow }) {
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

  const metadata = [row.secondaryTitle, row.projectName, row.relativeTime]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="min-w-0 flex-1">
      <span ref={primaryRef} className="block min-w-0 truncate text-foreground">
        <HighlightedText text={primary.text} ranges={primary.highlightRanges} />
      </span>
      <span
        className="flex min-h-4 items-center gap-1.5"
        data-palette-thread-details
      >
        {metadata.length === 0 ? null : (
          <span
            className="min-w-0 truncate text-xs leading-4 text-subtle-foreground"
            data-palette-thread-metadata
            title={metadata}
          >
            {row.secondaryTitle === null ? null : `${row.secondaryTitle} · `}
            {row.projectName === null ? null : (
              <>
                <Icon
                  name="Folder"
                  className="mr-1 inline-block size-3.5 align-text-bottom"
                  aria-hidden
                />
                {`${row.projectName} · `}
              </>
            )}
            {row.relativeTime}
          </span>
        )}
        <ThreadSearchPaletteStatus row={row} />
      </span>
    </span>
  );
}

function ThreadSearchPaletteStatus({ row }: { row: PaletteThreadSearchRow }) {
  const hasUnsubmittedDraft = usePromptDraftHasInput({
    kind: "thread",
    projectId: row.projectId,
    threadId: row.threadId,
  });
  const state = threadListIndicatorStateForThread(
    row.thread,
    hasUnsubmittedDraft,
  );
  const pluginStatus = usePluginThreadRowStatus(row.threadId);
  const { accessibleLabel: label } = resolveThreadStatus(state, pluginStatus);
  if (label === null) return null;
  return (
    <>
      <span
        aria-hidden="true"
        className="shrink-0 text-xs leading-4 text-subtle-foreground"
        data-palette-thread-status-separator
      >
        ·
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            aria-label={label}
            className="inline-flex size-3.5 shrink-0 cursor-default items-center justify-center text-subtle-foreground"
            data-palette-thread-status
          >
            <ThreadStatusGlyph
              {...state}
              pluginStatus={pluginStatus}
              size="compact"
            />
          </span>
        </TooltipTrigger>
        <TooltipContent side="left">{label}</TooltipContent>
      </Tooltip>
    </>
  );
}

function HighlightedText({
  ranges,
  text,
}: {
  ranges: readonly ThreadSearchMatch["highlightRanges"][number][];
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
