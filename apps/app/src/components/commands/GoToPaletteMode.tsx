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
import { useLocation } from "react-router-dom";
import { useAtomValue, useStore } from "jotai";
import { isMacKeyboardPlatform } from "@bb/domain";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import {
  hasThreadSearchableQuery,
  useThreadSearch,
} from "@/hooks/queries/thread-queries";
import { useRouteNavigate } from "@/components/ui/app-route-anchor";
import { pluginNavPanelOrderAtom } from "@/components/plugin/pluginNavSidebarAtoms";
import { useSettingsNavSections } from "@/components/settings/settings-nav";
import {
  buildPluginSettingsEntries,
  type PluginSettingsCandidate,
} from "@/components/settings/plugin-settings-entries";
import { usePluginSlots } from "@/lib/plugin-slots";
import { getThreadRoutePath } from "@/lib/route-paths";
import { openThreadInSplit } from "@/lib/split-layout/openThreadInSplit";
import { openPaneContentInSplit } from "@/lib/split-layout/openPaneContentInSplit";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { countPanes, findPaneByContent, MAX_PANES } from "@/lib/split-layout";
import {
  buildPaletteThreadSearchRows,
  type HighlightRange,
  type PaletteThreadSearchRow,
} from "@/lib/command-palette/palette-thread-search";
import { buildPaletteGoToResults } from "@/lib/command-palette/palette-go-to";
import {
  buildPalettePlaces,
  orderPanelsBySidebar,
  PLACE_KIND_LABELS,
  resolvePalettePlaceVisit,
  selectRecentPlaces,
  type PalettePlace,
} from "@/lib/command-palette/palette-places";
import { readPaletteVisits } from "@/lib/command-palette/palette-visits";
import {
  PALETTE_SECTION_LABEL_CLASS,
  PaletteShell,
  PaletteShortcut,
} from "./PaletteShell";
import { PaletteKindFilter } from "./PaletteKindFilter";
import { ThreadSearchPaletteRow } from "./ThreadSearchPaletteMode";

const THREAD_ROW_LIMIT = 4;
const NO_MATCHES_MESSAGE = "No matches";

type GoToOption =
  | { key: string; section: "threads"; type: "thread"; row: PaletteThreadSearchRow }
  | {
      key: string;
      section: "threads" | "places";
      type: "place";
      place: PalettePlace;
      highlightRanges: readonly HighlightRange[];
    }
  | { key: string; section: "threads"; type: "more" };

function threadOption(row: PaletteThreadSearchRow): GoToOption {
  return { key: `thread:${row.threadId}`, section: "threads", type: "thread", row };
}

function placeOption(
  place: PalettePlace,
  section: "threads" | "places",
  highlightRanges: readonly HighlightRange[],
): GoToOption {
  return {
    key: `place:${place.id}`,
    section,
    type: "place",
    place,
    highlightRanges,
  };
}

export function GoToPaletteMode({
  currentThreadId,
  installedPlugins,
  onExit,
  query,
  onQueryChange: setQuery,
  runAfterClose,
}: {
  currentThreadId: string | null;
  installedPlugins: readonly PluginSettingsCandidate[];
  onExit: () => void;
  query: string;
  onQueryChange: (query: string) => void;
  runAfterClose: (run: () => void) => void;
}) {
  const listId = useId();
  const optionIdPrefix = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const navigate = useRouteNavigate();
  const location = useLocation();
  const store = useStore();
  const splitLayout = useAtomValue(splitLayoutAtom);
  const panelOrder = useAtomValue(pluginNavPanelOrderAtom);
  const isCompact = useIsCompactViewport();
  const pluginSlots = usePluginSlots();
  const settingsSections = useSettingsNavSections(pluginSlots.fileOpeners);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [followPreviousThread, setFollowPreviousThread] = useState(
    () => query.trim().length === 0,
  );
  const [threadsExpanded, setThreadsExpanded] = useState(false);
  const [now] = useState(() => Date.now());
  const [visits] = useState(readPaletteVisits);
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
  const activeThreads = useMemo(
    () => [
      ...(navigation.data?.projects.flatMap((project) => project.threads) ??
        []),
      ...(navigation.data?.personalProject.threads ?? []),
    ],
    [navigation.data],
  );
  const places = useMemo(
    () =>
      buildPalettePlaces({
        navigate: (path) => navigate(path),
        panels: orderPanelsBySidebar(pluginSlots.navPanels, panelOrder),
        pluginSettingsEntries: buildPluginSettingsEntries({
          installedPlugins,
          settingsSections: pluginSlots.settingsSections,
        }),
        settingsSections,
      }),
    [
      installedPlugins,
      navigate,
      panelOrder,
      pluginSlots.navPanels,
      pluginSlots.settingsSections,
      settingsSections,
    ],
  );
  const currentPlaceId =
    resolvePalettePlaceVisit(location.pathname, pluginSlots.navPanels)?.id ??
    null;

  const recentThreadResult = useMemo(
    () =>
      buildPaletteThreadSearchRows({
        currentThreadId,
        lifecycles: ["active"],
        now,
        projectNamesById,
        query: "",
        recentThreads: activeThreads,
        searchResponse: undefined,
        searchResultsAreCurrent: true,
        visits,
      }),
    [activeThreads, currentThreadId, now, projectNamesById, visits],
  );
  const recentPlaces = useMemo(
    () => selectRecentPlaces({ currentPlaceId, places, visits }),
    [currentPlaceId, places, visits],
  );
  const typedResults = useMemo(
    () =>
      buildPaletteGoToResults({
        activeThreads,
        now,
        places,
        projectNamesById,
        query,
        searchResponse: threadSearch.data,
        searchResultsAreCurrent,
        visits,
      }),
    [
      activeThreads,
      now,
      places,
      projectNamesById,
      query,
      searchResultsAreCurrent,
      threadSearch.data,
      visits,
    ],
  );

  const isRecent = trimmedQuery.length === 0;
  const options = useMemo((): GoToOption[] => {
    if (!isRecent) {
      return typedResults.map((item) =>
        item.type === "thread"
          ? threadOption(item.row)
          : placeOption(item.place, "threads", item.highlightRanges),
      );
    }
    const rows = recentThreadResult.rows;
    const visibleRows = threadsExpanded
      ? rows
      : rows.slice(0, THREAD_ROW_LIMIT);
    return [
      ...visibleRows.map(threadOption),
      ...(visibleRows.length < rows.length
        ? [{ key: "more:threads", section: "threads" as const, type: "more" as const }]
        : []),
      ...recentPlaces.map((place) => placeOption(place, "places", [])),
    ];
  }, [isRecent, recentPlaces, recentThreadResult, threadsExpanded, typedResults]);

  const previousThreadIndex =
    isRecent && followPreviousThread && recentThreadResult.previousThreadId !== null
      ? options.findIndex(
          (option) =>
            option.type === "thread" &&
            option.row.threadId === recentThreadResult.previousThreadId,
        )
      : -1;
  const retainedIndex = options.findIndex(
    (option) => option.key === highlightedKey,
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
    setHighlightedKey(activeIndex < 0 ? null : (options[activeIndex]?.key ?? null));
  }, [activeIndex, options]);
  const highlightOption = useCallback(
    (index: number) => {
      setFollowPreviousThread(false);
      setHighlightedIndex(index);
      setHighlightedKey(options[index]?.key ?? null);
    },
    [options],
  );

  const activeOption = options[activeIndex];
  const canSplitThread =
    activeOption?.type === "thread" &&
    !isCompact &&
    splitLayout !== null &&
    findPaneByContent(splitLayout.root, {
      kind: "thread",
      projectId: activeOption.row.projectId,
      threadId: activeOption.row.threadId,
    }) === null &&
    countPanes(splitLayout.root) < MAX_PANES;
  const canSplitPlace =
    activeOption?.type === "place" &&
    activeOption.place.split !== null &&
    !isCompact &&
    splitLayout !== null &&
    countPanes(splitLayout.root) < MAX_PANES;
  const canSplit = canSplitThread || canSplitPlace;
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
    (option: GoToOption, index: number, split = false) => {
      if (option.type === "more") {
        scrollOnNextHighlightRef.current = true;
        setFollowPreviousThread(false);
        setThreadsExpanded(true);
        setHighlightedIndex(index);
        setHighlightedKey(null);
        inputRef.current?.focus();
        return;
      }
      if (option.type === "place") {
        const placeSplit = option.place.split;
        runAfterClose(() => {
          if (split && placeSplit !== null) {
            openPaneContentInSplit({
              store,
              navigate,
              content: placeSplit.content,
              route: placeSplit.route,
              enabled: !isCompact,
            });
            return;
          }
          option.place.run();
        });
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
    [isCompact, navigate, runAfterClose, store],
  );

  const handleInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) return;
      if (
        (event.key === "Backspace" && query.length === 0) ||
        event.key === "Escape"
      ) {
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

  const isSearching =
    searchable &&
    (!searchResultsAreCurrent ||
      threadSearch.isDebouncing ||
      threadSearch.isLoading);
  let emptyMessage: string | null = null;
  if (options.length === 0) {
    emptyMessage = isRecent
      ? navigation.isLoading
        ? "Loading threads"
        : NO_MATCHES_MESSAGE
      : isSearching
        ? "Searching"
        : searchable && searchResultsAreCurrent && threadSearch.isError
          ? "Couldn’t search threads"
          : NO_MATCHES_MESSAGE;
  }

  const renderOption = (option: GoToOption, index: number) => (
    <div
      key={option.key}
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
        aria-label={option.type === "more" ? "Show more threads" : undefined}
        data-go-to-kind={option.type === "place" ? option.place.kind : option.type}
        className={cn(
          "flex min-w-0 flex-1 cursor-pointer items-center rounded-md px-2 py-1.5",
          option.type === "more"
            ? "gap-1.5 text-xs text-subtle-foreground"
            : option.type === "thread"
              ? "min-h-11 gap-3 text-left text-sm"
              : "min-h-8 gap-3 text-left text-sm",
        )}
        onClick={() => selectOption(option, index)}
      >
        {option.type === "more" ? (
          <>
            Show more
            <Icon name="ChevronDown" className="size-3.5" aria-hidden />
          </>
        ) : option.type === "thread" ? (
          <>
            <ThreadSearchPaletteRow row={option.row} />
            {option.row.lifecycle === "archived" ? (
              <span className="ml-auto shrink-0 text-xs text-subtle-foreground">
                Archived
              </span>
            ) : null}
          </>
        ) : (
          <GoToPlaceRow place={option.place} ranges={option.highlightRanges} />
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
  );

  const threadsLabelId = `${optionIdPrefix}-threads-label`;
  const placesLabelId = `${optionIdPrefix}-places-label`;
  const threadOptions = options.filter((option) => option.section === "threads");
  const placeOptions = options.filter((option) => option.section === "places");

  return (
    <PaletteShell
      activeDescendantId={
        activeIndex < 0 ? undefined : `${optionIdPrefix}-${activeIndex}`
      }
      inputDescription={
        canSplit
          ? `Use ${splitModifier}+Enter to open in split. Use Escape to return to commands.`
          : "Use Escape to return to commands."
      }
      inputLabel="Go to"
      inputAccessory={
        <div className="max-w-[45%] shrink-0">
          <PaletteKindFilter />
        </div>
      }
      inputRef={inputRef}
      listId={listId}
      listLabel="Go to"
      listRef={listRef}
      onInputChange={(value) => {
        setQuery(value);
        setFollowPreviousThread(value.trim().length === 0);
        setHighlightedIndex(0);
        setHighlightedKey(null);
        setThreadsExpanded(false);
        if (listRef.current !== null) listRef.current.scrollTop = 0;
      }}
      onInputKeyDown={handleInputKeyDown}
      placeholder="Go to thread, page, setting…"
      value={query}
    >
      {emptyMessage !== null ? (
        <p className="px-3 py-4 text-center text-sm text-muted-foreground">
          {emptyMessage}
        </p>
      ) : !isRecent ? (
        options.map(renderOption)
      ) : (
        <>
          {threadOptions.length > 0 ? (
            <div
              role="group"
              aria-labelledby={threadsLabelId}
              className="not-last:mb-2"
            >
              <div id={threadsLabelId} className={PALETTE_SECTION_LABEL_CLASS}>
                Threads
              </div>
              {threadOptions.map((option) =>
                renderOption(option, options.indexOf(option)),
              )}
            </div>
          ) : null}
          {placeOptions.length > 0 ? (
            <div role="group" aria-labelledby={placesLabelId}>
              <div id={placesLabelId} className={PALETTE_SECTION_LABEL_CLASS}>
                Recent places
              </div>
              {placeOptions.map((option) =>
                renderOption(option, options.indexOf(option)),
              )}
            </div>
          ) : null}
        </>
      )}
    </PaletteShell>
  );
}

function GoToPlaceRow({
  place,
  ranges,
}: {
  place: PalettePlace;
  ranges: readonly HighlightRange[];
}) {
  const emphasized = new Set(
    ranges.flatMap((range) =>
      Array.from({ length: range.end - range.start }, (_, offset) => range.start + offset),
    ),
  );
  return (
    <>
      <Icon
        name={place.icon}
        fallback="Zap"
        className="size-4 shrink-0 text-subtle-foreground"
        aria-hidden
      />
      <span className="min-w-0 truncate">
        {emphasized.size === 0
          ? place.title
          : [...place.title].map((character, index) =>
              emphasized.has(index) ? (
                <span key={index} className="font-semibold text-foreground">
                  {character}
                </span>
              ) : (
                <span key={index}>{character}</span>
              ),
            )}
      </span>
      <span className="ml-auto shrink-0 text-xs text-subtle-foreground">
        {PLACE_KIND_LABELS[place.kind]}
      </span>
    </>
  );
}
