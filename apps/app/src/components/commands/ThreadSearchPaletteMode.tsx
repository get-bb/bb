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
import { useStore } from "jotai";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { cn } from "@bb/shared-ui/lib/utils";
import { isPromptDraftEmpty } from "@bb/client-core";
import type { ThreadSearchHighlightRange } from "@bb/server-contract";
import { usePromptDraftStorage } from "@/hooks/usePromptDraftStorage";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import {
  hasThreadSearchableQuery,
  useArchivedThreads,
  useThreadSearch,
} from "@/hooks/queries/thread-queries";
import { useRouteNavigate } from "@/components/ui/app-route-anchor";
import {
  NO_THREADS_MESSAGE,
  ThreadListEmptyState,
} from "@/components/thread/ThreadListEmptyState";
import { getRootComposeRoutePath, getThreadRoutePath } from "@/lib/route-paths";
import { useRootComposeProjectId } from "@/lib/root-compose-selection";
import { openPaneContentInSplit } from "@/lib/split-layout/openPaneContentInSplit";
import { openThreadInSplit } from "@/lib/split-layout/openThreadInSplit";
import {
  buildPaletteThreadSearchRows,
  PALETTE_THREAD_SEARCH_SCOPES,
  type PaletteThreadSearchRow,
  type PaletteThreadSearchScope,
} from "@/lib/command-palette/palette-thread-search";
import { windowPaletteThreadSearchText } from "@/lib/command-palette/palette-thread-search-window";
import type { PaletteModeViewProps } from "@/lib/command-palette/palette-mode";
import { PALETTE_FOOTER_LABEL_CLASS, PaletteShell } from "./PaletteShell";

const EMPTY_SCOPE_MESSAGES = {
  all: NO_THREADS_MESSAGE,
  active: "No active threads",
  draft: "No drafts yet",
  archived: "No archived threads",
} satisfies Record<PaletteThreadSearchScope, string>;

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
  const navigate = useRouteNavigate();
  const isCompact = useIsCompactViewport();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<PaletteThreadSearchScope>("all");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [now] = useState(() => Date.now());
  const rootComposeDraft = usePromptDraftStorage({ kind: "new-thread" });
  const [rootComposeProjectId] = useRootComposeProjectId();
  const drafts = useMemo(() => {
    const draft = {
      text: rootComposeDraft.text,
      mentions: rootComposeDraft.mentions,
      attachments: rootComposeDraft.attachments,
    };
    if (isPromptDraftEmpty(draft)) return [];
    const title = draft.text.replace(/\s+/gu, " ").trim();
    return [
      {
        id: "root-compose",
        draft,
        title: title.length > 0 ? title : "New thread",
        lastEditedAt: null,
        destination: {
          projectId: rootComposeProjectId,
          sectionId: null,
        },
      },
    ];
  }, [
    rootComposeDraft.attachments,
    rootComposeDraft.mentions,
    rootComposeDraft.text,
    rootComposeProjectId,
  ]);
  const navigation = useSidebarNavigation();
  const archivedThreads = useArchivedThreads({});
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
  const recentArchivedThreads = useMemo(
    () => archivedThreads.data?.pages.flatMap((page) => page) ?? [],
    [archivedThreads.data],
  );
  const result = useMemo(
    () =>
      buildPaletteThreadSearchRows({
        drafts,
        now,
        projectNamesById,
        query,
        recentArchivedThreads,
        recentThreads,
        scope,
        searchResponse: threadSearch.data,
        searchResultsAreCurrent,
      }),
    [
      drafts,
      now,
      projectNamesById,
      query,
      recentArchivedThreads,
      recentThreads,
      scope,
      searchResultsAreCurrent,
      threadSearch.data,
    ],
  );
  const activeIndex =
    result.rows.length === 0
      ? -1
      : Math.min(highlightedIndex, result.rows.length - 1);
  const isRecentLoading =
    result.isRecent && (navigation.isLoading || archivedThreads.isLoading);
  const hasLoadError = result.isRecent
    ? navigation.isError || archivedThreads.isError
    : searchResultsAreCurrent && threadSearch.isError;
  const showThreadListEmptyState =
    result.rows.length === 0 &&
    result.isRecent &&
    scope === "all" &&
    !isRecentLoading &&
    !hasLoadError;
  const activeDescendantId =
    activeIndex < 0 ? undefined : `${optionIdPrefix}-${activeIndex}`;

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
        if (row.threadId !== null) {
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
          return;
        }
        if (row.draftSlotId !== null) {
          if (split) {
            openPaneContentInSplit({
              store,
              navigate,
              content: { kind: "new-thread" },
              route: getRootComposeRoutePath(),
              enabled: !isCompact,
            });
            return;
          }
          navigate(getRootComposeRoutePath(), { state: { focusPrompt: true } });
        }
      });
    },
    [isCompact, navigate, runAfterClose, store],
  );

  const handleInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
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
              ? EMPTY_SCOPE_MESSAGES[scope]
              : "No matching threads";
  }

  return (
    <PaletteShell
      activeDescendantId={activeDescendantId}
      accessory={
        <ThreadSearchScopeFilter
          inputRef={inputRef}
          scope={scope}
          onScopeChange={(nextScope) => {
            setScope(nextScope);
            setHighlightedIndex(0);
            if (listRef.current !== null) listRef.current.scrollTop = 0;
          }}
        />
      }
      footerKeys={activeIndex >= 0 && !isCompact ? presentation.footerKeys : []}
      inputDescription={presentation.inputDescription}
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
      ) : showThreadListEmptyState ? (
        <ThreadListEmptyState className="justify-center px-3 py-8" />
      ) : (
        <p className="px-3 py-8 text-center text-sm text-muted-foreground">
          {emptyMessage}
        </p>
      )}
    </PaletteShell>
  );
}

function ThreadSearchScopeFilter({
  inputRef,
  onScopeChange,
  scope,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onScopeChange: (scope: PaletteThreadSearchScope) => void;
  scope: PaletteThreadSearchScope;
}) {
  const current = PALETTE_THREAD_SEARCH_SCOPES.find(
    (candidate) => candidate.id === scope,
  );

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Thread scope"
          className="shrink-0 gap-1.5 px-2 font-normal text-subtle-foreground"
        >
          <span>{current?.label ?? "All"}</span>
          <Icon name="ChevronDown" className="size-3.5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        aria-label="Thread scope options"
        mobileTitle="Thread scope"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus({ preventScroll: true });
        }}
        onEscapeKeyDown={(event) => event.stopPropagation()}
      >
        {PALETTE_THREAD_SEARCH_SCOPES.map((option) => (
          <DropdownMenuItem
            key={option.id}
            role="menuitemradio"
            aria-checked={option.id === scope}
            onSelect={() => onScopeChange(option.id)}
          >
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {option.id === scope ? (
              <Icon name="Check" className="size-3.5" aria-hidden />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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

  const stateLabel =
    row.lifecycle === "active"
      ? null
      : row.lifecycle === "draft"
        ? "Draft"
        : "Archived";
  return (
    <div
      id={id}
      role="option"
      aria-selected={isActive}
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 py-1.5 text-left text-sm",
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
        {row.metadataText.length === 0 && stateLabel === null ? null : (
          <span
            className={cn(
              "flex min-h-4 min-w-0 items-baseline gap-3 text-xs leading-4",
              PALETTE_FOOTER_LABEL_CLASS,
            )}
            data-palette-thread-metadata
          >
            <span className="min-w-0 flex-1 truncate" title={row.metadataText}>
              {row.metadataText}
            </span>
            {stateLabel === null ? null : (
              <span className="shrink-0">{stateLabel}</span>
            )}
          </span>
        )}
      </span>
    </div>
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
