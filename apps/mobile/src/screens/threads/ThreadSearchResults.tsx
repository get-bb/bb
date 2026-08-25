import type { ThreadListEntry } from "@bb/domain";
import type { ThreadSearchResult } from "@bb/server-contract";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { useCallback, useMemo, type ReactElement } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import {
  THREAD_SEARCH_MIN_NON_WHITESPACE_CHARS,
  useRecentThreads,
  useSidebarModel,
  useSidebarPreferences,
  useThreadSearch,
} from "@/data/sidebar";
import { EmptyState, Spinner, Text } from "@/ui";
import {
  flatThreadRow,
  projectSubtitle,
  SidebarThreadRowView,
  type SidebarRowSubtitle,
  type SidebarThreadRow,
} from "../sidebar";

type SearchListRow =
  | { type: "label"; key: string; label: string }
  | {
      type: "thread";
      key: string;
      row: SidebarThreadRow;
      /**
       * The best non-title match snippet (message text), else the project
       * name. Built with the row so its identity holds across renders and
       * `memo(SidebarThreadRowView)` keeps the row.
       */
      subtitle: SidebarRowSubtitle | null;
    };

const DISABLE_MAINTAIN_POSITION = { disabled: true };

function snippetFor(result: ThreadSearchResult): string | null {
  const match = result.matches.find(
    (candidate) =>
      candidate.sourceKind !== "title" &&
      candidate.sourceKind !== "title_fallback",
  );
  return match?.text.trim() || null;
}

function threadListRow(
  key: string,
  thread: ThreadListEntry,
  snippet: string | null,
  projectNamesById: ReadonlyMap<string, string>,
): SearchListRow {
  return {
    type: "thread",
    key,
    row: flatThreadRow(thread),
    subtitle:
      snippet !== null
        ? { kind: "snippet", text: snippet }
        : projectSubtitle(projectNamesById.get(thread.projectId) ?? null),
  };
}

function buildRows(args: {
  results: {
    active: ThreadSearchResult[];
    archived: ThreadSearchResult[];
  } | null;
  recent: ThreadListEntry[];
  projectNamesById: ReadonlyMap<string, string>;
}): SearchListRow[] {
  const rows: SearchListRow[] = [];
  if (args.results) {
    if (args.results.active.length > 0) {
      rows.push({ type: "label", key: "label:active", label: "Threads" });
      for (const result of args.results.active) {
        rows.push(
          threadListRow(
            `active:${result.thread.id}`,
            result.thread,
            snippetFor(result),
            args.projectNamesById,
          ),
        );
      }
    }
    if (args.results.archived.length > 0) {
      rows.push({ type: "label", key: "label:archived", label: "Archived" });
      for (const result of args.results.archived) {
        rows.push(
          threadListRow(
            `archived:${result.thread.id}`,
            result.thread,
            snippetFor(result),
            args.projectNamesById,
          ),
        );
      }
    }
    return rows;
  }
  if (args.recent.length > 0) {
    rows.push({ type: "label", key: "label:recent", label: "Recent" });
    for (const thread of args.recent) {
      rows.push(
        threadListRow(
          `recent:${thread.id}`,
          thread,
          null,
          args.projectNamesById,
        ),
      );
    }
  }
  return rows;
}

interface ThreadSearchResultsProps {
  /** The live query; recent threads show while it is empty. */
  query: string;
  /** Scrolls ahead of the status line and the rows (the connection banner). */
  ListHeaderComponent?: ReactElement | null;
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Search results as a list: Recent (empty query) / Threads / Archived
 * sections of thread rows, with the debounced full-text search's hint,
 * progress and error lines at the top. Rendered on home under the header
 * search bar and on the `/threads/search` route; needs the enclosing
 * `SidebarActionsProvider` for the row actions.
 */
export function ThreadSearchResults({
  query,
  ListHeaderComponent,
  contentContainerStyle,
  testID = "thread-search-list",
}: ThreadSearchResultsProps) {
  const search = useThreadSearch(query);
  const recent = useRecentThreads();
  const [preferences] = useSidebarPreferences();
  const { model } = useSidebarModel({
    organize: preferences.organize,
    sort: preferences.sort,
  });

  const projectNamesById = model.projectNamesById;
  const rows = useMemo(
    () =>
      buildRows({
        results:
          search.hasSearchableQuery && search.data
            ? {
                active: search.data.active.results,
                archived: search.data.archived.results,
              }
            : null,
        recent: search.hasSearchableQuery ? [] : recent.threads,
        projectNamesById,
      }),
    [projectNamesById, recent.threads, search.data, search.hasSearchableQuery],
  );

  const noop = useCallback(() => undefined, []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<SearchListRow>) => {
      if (item.type === "label") {
        return (
          <Text variant="sectionLabel" className="px-4 pb-1 pt-4">
            {item.label}
          </Text>
        );
      }
      return (
        <SidebarThreadRowView
          row={item.row}
          subtitle={item.subtitle}
          onToggleCollapsed={noop}
        />
      );
    },
    [noop],
  );

  const trimmed = query.trim();
  const showHint =
    trimmed.length > 0 && !search.hasSearchableQuery && !search.isDebouncing;
  const busy = search.isFetching || search.isDebouncing;
  const noResults =
    search.hasSearchableQuery &&
    !search.isLoading &&
    !search.isDebouncing &&
    search.data !== undefined &&
    rows.length === 0;

  const header = (
    <>
      {ListHeaderComponent}
      {showHint ? (
        <EmptyState
          className="px-4 pt-3"
          icon="Info"
          message={`Type at least ${THREAD_SEARCH_MIN_NON_WHITESPACE_CHARS} characters to search.`}
        />
      ) : null}
      {busy && rows.length === 0 ? (
        <View className="items-center py-4">
          <Spinner />
        </View>
      ) : null}
      {search.isError ? (
        <EmptyState
          className="px-4 pt-3"
          icon="AlertTriangle"
          message="Search failed. Check the connection and try again."
        />
      ) : null}
      {noResults ? (
        <View className="px-4 py-6" testID="thread-search-empty">
          <Text className="text-center text-sm text-muted-foreground">
            No threads match “{search.debouncedQuery}”.
          </Text>
        </View>
      ) : null}
    </>
  );

  return (
    <FlashList
      data={rows}
      keyExtractor={keyExtractor}
      getItemType={getItemType}
      renderItem={renderItem}
      maintainVisibleContentPosition={DISABLE_MAINTAIN_POSITION}
      ListHeaderComponent={header}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      // Not "interactive": on home the region under the list is padded by
      // KeyboardPaddingView, which cannot follow a drag.
      keyboardDismissMode="on-drag"
      contentContainerStyle={contentContainerStyle}
      testID={testID}
    />
  );
}

function keyExtractor(row: SearchListRow): string {
  return row.key;
}

function getItemType(row: SearchListRow): string {
  return row.type;
}
