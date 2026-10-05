import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useAtom, useAtomValue, useStore } from "jotai";
import { isMacKeyboardPlatform } from "@bb/domain";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { Icon } from "@bb/shared-ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { cn } from "@bb/shared-ui/lib/utils";
import { threadListIndicatorStateForThread } from "@bb/client-core";
import { usePromptDraftHasInput } from "@/hooks/usePromptDraftStorage";
import {
  ThreadTitle,
  useThreadTitleDisplayText,
} from "@/components/thread/ThreadTitleMentions";
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
  readPaletteVisits,
  recordPaletteVisit,
} from "@/lib/command-palette/palette-visits";
import {
  buildPaletteGroupingPlaces,
  buildPalettePlaces,
  isThreadInGrouping,
  matchPalettePlaces,
  PALETTE_PLACE_KIND_LABELS,
  type PaletteGrouping,
  type PalettePlaceMatch,
} from "@/lib/command-palette/palette-places";
import { usePluginSlots } from "@/lib/plugin-slots";
import {
  buildPluginSettingsEntries,
  type PluginSettingsCandidate,
} from "@/components/settings/plugin-settings-entries";
import { useSettingsNavSections } from "@/components/settings/settings-nav";
import {
  PALETTE_SECTION_LABEL_CLASS,
  PaletteShell,
  PaletteShortcut,
} from "./PaletteShell";

const GROUP_LIMIT = 6;
const ARCHIVED_BESIDE_ACTIVE_LIMIT = 3;

const NO_MATCHING_THREADS_MESSAGE = "No matching threads";
const NO_PROJECT_NAMES: ReadonlyMap<string, string> = new Map();

type PaletteGroup = ThreadArchiveFilter | "places";

const PALETTE_GROUPS: readonly { value: PaletteGroup; label: string }[] = [
  THREAD_LIFECYCLE_OPTIONS[0],
  { value: "places", label: "Places" },
  THREAD_LIFECYCLE_OPTIONS[1],
];

type ThreadSearchOption =
  | { type: "thread"; group: ThreadArchiveFilter; row: PaletteThreadSearchRow }
  | { type: "place"; group: "places"; match: PalettePlaceMatch }
  | { type: "more"; group: PaletteGroup };

function optionKey(option: ThreadSearchOption): string {
  if (option.type === "thread") return option.row.id;
  if (option.type === "place") return `place:${option.match.place.id}`;
  return `more:${option.group}`;
}

export function ThreadSearchPaletteMode({
  currentThreadId,
  installedPlugins,
  onExit,
  runAfterClose,
}: {
  currentThreadId: string | null;
  installedPlugins: readonly PluginSettingsCandidate[];
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
  const [grouping, setGrouping] = useState<PaletteGrouping | null>(null);
  const filterLifecycles = useMemo(
    () => normalizeThreadLifecycleFilter(selectedLifecycles),
    [selectedLifecycles],
  );
  const lifecycles = useMemo(
    (): readonly ThreadArchiveFilter[] =>
      grouping === null ? filterLifecycles : ["active"],
    [filterLifecycles, grouping],
  );
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [followPreviousThread, setFollowPreviousThread] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<PaletteGroup[]>([]);
  const filterKey = lifecycles.join(",");
  const [previousFilterKey, setPreviousFilterKey] = useState(filterKey);
  if (previousFilterKey !== filterKey) {
    setPreviousFilterKey(filterKey);
    setExpandedGroups([]);
  }
  const [now] = useState(() => Date.now());
  const [visits] = useState(readPaletteVisits);
  const navigation = useSidebarNavigation();
  const threadSearch = useThreadSearch({ active: grouping === null, query });
  const trimmedQuery = query.trim();
  const archived = usePaletteRecentArchivedThreads({
    enabled: trimmedQuery.length === 0 && lifecycles.includes("archived"),
  });
  const searchable =
    grouping === null && hasThreadSearchableQuery(trimmedQuery);
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
  const activeThreads = useMemo(
    () => [
      ...(navigation.data?.projects.flatMap((project) => project.threads) ??
        []),
      ...(navigation.data?.personalProject.threads ?? []),
    ],
    [navigation.data],
  );
  const recentThreads = useMemo(
    () =>
      grouping === null
        ? [
            ...activeThreads,
            ...(lifecycles.includes("archived") ? (archived.data ?? []) : []),
          ]
        : activeThreads.filter((thread) =>
            isThreadInGrouping(thread, grouping),
          ),
    [activeThreads, archived.data, grouping, lifecycles],
  );
  const result = useMemo(
    () =>
      buildPaletteThreadSearchRows({
        currentThreadId,
        lifecycles,
        now,
        projectNamesById:
          grouping?.kind === "project" ? NO_PROJECT_NAMES : projectNamesById,
        query,
        recentThreads,
        searchResponse: grouping === null ? threadSearch.data : undefined,
        searchResultsAreCurrent,
        visits,
      }),
    [
      currentThreadId,
      grouping,
      lifecycles,
      now,
      projectNamesById,
      query,
      recentThreads,
      searchResultsAreCurrent,
      threadSearch.data,
      visits,
    ],
  );
  const pluginSlots = usePluginSlots();
  const settingsSections = useSettingsNavSections(pluginSlots.fileOpeners);
  const places = useMemo(
    () =>
      buildPalettePlaces({
        navigate: (path) => navigate(path),
        panels: pluginSlots.navPanels,
        pluginSettingsEntries: buildPluginSettingsEntries({
          installedPlugins,
          settingsSections: pluginSlots.settingsSections,
        }),
        settingsSections,
      }),
    [
      installedPlugins,
      navigate,
      pluginSlots.navPanels,
      pluginSlots.settingsSections,
      settingsSections,
    ],
  );
  const groupingPlaces = useMemo(
    () =>
      buildPaletteGroupingPlaces({
        projects: navigation.data?.projects ?? [],
        personalProject: navigation.data?.personalProject ?? null,
        sections: navigation.data?.sections ?? [],
        hasPinnedThreads: activeThreads.some(
          (thread) => thread.pinnedAt !== null,
        ),
      }),
    [activeThreads, navigation.data],
  );
  const placeMatches = useMemo(
    () =>
      grouping === null
        ? matchPalettePlaces([...places, ...groupingPlaces], trimmedQuery)
        : [],
    [grouping, groupingPlaces, places, trimmedQuery],
  );
  const options = useMemo(() => {
    return PALETTE_GROUPS.flatMap(({ value: group }): ThreadSearchOption[] => {
      const all: ThreadSearchOption[] =
        group === "places"
          ? placeMatches.map((match): ThreadSearchOption => ({
              type: "place",
              group,
              match,
            }))
          : lifecycles.includes(group)
            ? result.rows
                .filter((row) => row.lifecycle === group)
                .map((row): ThreadSearchOption => ({
                  type: "thread",
                  group,
                  row,
                }))
            : [];
      const visible = expandedGroups.includes(group)
        ? all
        : all.slice(
            0,
            group === "archived" && lifecycles.includes("active")
              ? ARCHIVED_BESIDE_ACTIVE_LIMIT
              : GROUP_LIMIT,
          );
      return visible.length < all.length
        ? [...visible, { type: "more", group }]
        : visible;
    });
  }, [expandedGroups, lifecycles, placeMatches, result]);
  const previousThreadIndex =
    followPreviousThread && result.previousThreadId !== null
      ? options.findIndex(
          (option) =>
            option.type === "thread" &&
            option.row.threadId === result.previousThreadId,
        )
      : -1;
  const retainedIndex = options.findIndex(
    (option) => optionKey(option) === highlightedKey,
  );
  const activeIndex =
    previousThreadIndex >= 0
      ? previousThreadIndex
      : retainedIndex >= 0
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
      setFollowPreviousThread(false);
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
    : searchable && searchResultsAreCurrent && threadSearch.isError;
  const showThreadListEmptyState =
    result.rows.length === 0 &&
    result.isRecent &&
    !isRecentLoading &&
    !hasLoadError;
  const activeDescendantId =
    activeIndex < 0 ? undefined : `${optionIdPrefix}-${activeIndex}`;
  const activeOption = options[activeIndex];
  const activeRow =
    activeOption?.type === "thread" ? activeOption.row : undefined;
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

  const resetView = useCallback((nextGrouping: PaletteGrouping | null) => {
    setGrouping(nextGrouping);
    setQuery("");
    setFollowPreviousThread(true);
    setExpandedGroups([]);
    setHighlightedIndex(0);
    setHighlightedKey(null);
    if (listRef.current !== null) listRef.current.scrollTop = 0;
    inputRef.current?.focus();
  }, []);

  const selectOption = useCallback(
    (option: ThreadSearchOption, index: number, split = false) => {
      if (option.type === "more") {
        scrollOnNextHighlightRef.current = true;
        setFollowPreviousThread(false);
        setExpandedGroups((current) => [...current, option.group]);
        setHighlightedIndex(index);
        setHighlightedKey(null);
        inputRef.current?.focus();
        return;
      }
      if (option.type === "place") {
        const { place } = option.match;
        if (place.grouping === null) {
          runAfterClose(place.run);
          return;
        }
        recordPaletteVisit(place.grouping.kind, place.grouping.id);
        resetView(place.grouping);
        return;
      }
      const { row } = option;
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
    [isCompact, navigate, resetView, runAfterClose, store],
  );

  const handleInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Backspace" && query.length === 0) {
        event.preventDefault();
        event.stopPropagation();
        if (grouping === null) onExit();
        else resetView(null);
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
    [
      activeIndex,
      grouping,
      highlightOption,
      onExit,
      options,
      query.length,
      resetView,
      selectOption,
    ],
  );

  const isLoading =
    searchable &&
    (!searchResultsAreCurrent ||
      threadSearch.isDebouncing ||
      threadSearch.isLoading);
  let emptyMessage: string | null = null;
  if (result.rows.length === 0 && placeMatches.length === 0) {
    emptyMessage =
      isLoading || isRecentLoading
        ? result.isRecent
          ? "Loading threads"
          : "Searching threads"
        : hasLoadError
          ? "Couldn’t load threads"
          : trimmedQuery.length === 1 && !lifecycles.includes("active")
            ? "Type at least 2 characters"
            : result.isRecent
              ? NO_THREADS_MESSAGE
              : NO_MATCHING_THREADS_MESSAGE;
  }

  return (
    <PaletteShell
      activeDescendantId={activeDescendantId}
      inputDescription={
        canSplit
          ? `Use ${splitModifier}+Enter to open in split. Use Escape to return to commands.`
          : "Use Escape to return to commands."
      }
      inputLabel="Go to"
      inputAccessory={
        grouping === null ? (
          <div className="max-w-[45%] shrink-0">
            <ThreadLifecycleFilter
              value={filterLifecycles}
              onChange={setLifecycles}
            />
          </div>
        ) : null
      }
      inputRef={inputRef}
      listId={listId}
      listLabel="Threads"
      listRef={listRef}
      modeChip={
        grouping === null
          ? {
              icon: "Search",
              label: "Threads",
              clearLabel: "Return to commands",
              onClear: onExit,
              hideShortcut: isCompact,
            }
          : {
              icon: grouping.icon,
              label: grouping.name,
              clearLabel: "Remove filter",
              onClear: () => resetView(null),
              hideShortcut: true,
            }
      }
      onInputChange={(value) => {
        setQuery(value);
        setFollowPreviousThread(value.trim().length === 0);
        setHighlightedIndex(0);
        setHighlightedKey(null);
        setExpandedGroups([]);
        if (listRef.current !== null) listRef.current.scrollTop = 0;
      }}
      onInputKeyDown={handleInputKeyDown}
      placeholder={
        grouping === null
          ? "Search threads, pages, settings…"
          : `Search ${grouping.name} threads…`
      }
      value={query}
    >
      {emptyMessage === null ? (
        PALETTE_GROUPS.map(({ value: group, label }) => {
          if (!options.some((option) => option.group === group)) {
            return null;
          }
          const labelId = `${optionIdPrefix}-${group}-label`;
          return (
            <div
              key={group}
              role="group"
              aria-labelledby={labelId}
              className="not-last:mb-2"
            >
              <div id={labelId} className={PALETTE_SECTION_LABEL_CLASS}>
                {label}
              </div>
              {options.map((option, index) =>
                option.group !== group ? null : (
                  <div
                    key={
                      option.type === "thread"
                        ? `${option.row.id}:${option.row.primaryText}`
                        : optionKey(option)
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
                        option.type !== "more"
                          ? undefined
                          : group === "archived"
                            ? "Show more archived threads"
                            : group === "places"
                              ? "Show more places"
                              : "Show more threads"
                      }
                      className={cn(
                        "flex min-w-0 flex-1 cursor-pointer items-center rounded-md px-2 py-1.5",
                        option.type === "more"
                          ? "gap-1.5 text-xs text-subtle-foreground"
                          : option.type === "place"
                            ? "gap-3 text-left text-sm"
                            : "min-h-11 gap-3 text-left text-sm",
                      )}
                      onClick={() => selectOption(option, index)}
                    >
                      {option.type === "more" ? (
                        <>
                          Show more
                          <Icon
                            name="ChevronDown"
                            className="size-3.5"
                            aria-hidden
                          />
                        </>
                      ) : option.type === "place" ? (
                        <PlacePaletteRow match={option.match} />
                      ) : (
                        <ThreadSearchPaletteRow row={option.row} />
                      )}
                    </div>
                    {index === activeIndex && canSplit ? (
                      <button
                        type="button"
                        aria-label="Open in split"
                        className="mr-1 inline-flex h-7 shrink-0 items-center gap-1 rounded-sm px-1 text-xs text-subtle-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
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
        emptyMessage === NO_MATCHING_THREADS_MESSAGE ? (
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

function PlacePaletteRow({ match }: { match: PalettePlaceMatch }) {
  return (
    <>
      <Icon
        name={match.place.icon}
        className="size-4 shrink-0 text-subtle-foreground"
        aria-hidden
      />
      <ThreadTitle
        title={match.place.title}
        highlightRanges={match.highlightRanges}
        className="min-w-0 flex-1 text-foreground"
      />
      <span className="shrink-0 text-xs text-subtle-foreground">
        {PALETTE_PLACE_KIND_LABELS[match.place.kind]}
      </span>
    </>
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

  const secondaryTitle = useThreadTitleDisplayText(row.secondaryTitle ?? "");
  const metadata = [
    row.secondaryTitle === null ? null : secondaryTitle,
    row.projectName,
    row.relativeTime,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="min-w-0 flex-1">
      <ThreadTitle
        ref={primaryRef}
        title={primary.text}
        highlightRanges={primary.highlightRanges}
        className="text-foreground"
      />
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
            {row.secondaryTitle === null ? null : `${secondaryTitle} · `}
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
