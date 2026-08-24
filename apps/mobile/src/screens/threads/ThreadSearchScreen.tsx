import type { ThreadListEntry } from "@bb/domain";
import type { ThreadSearchResult } from "@bb/server-contract";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useProfiles } from "@/app-shell";
import {
  THREAD_SEARCH_MIN_NON_WHITESPACE_CHARS,
  useRecentThreads,
  useSidebarModel,
  useSidebarPreferences,
  useThreadSearch,
} from "@/data/sidebar";
import { useTheme } from "@/theme";
import { EmptyState, Icon, Input, Spinner, Text } from "@/ui";
import { Screen } from "../shell/Screen";
import {
  flatThreadRow,
  SidebarActionsProvider,
  projectSubtitle,
  SidebarThreadRowView,
  type SidebarRowSubtitle,
  useSidebarActions,
  type SidebarThreadRow,
} from "../sidebar";

type SearchListRow =
  | { type: "label"; key: string; label: string }
  | {
      type: "thread";
      key: string;
      row: SidebarThreadRow;
      /** Best non-title match snippet (message text), if any. */
      snippet: string | null;
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

function buildRows(args: {
  results: {
    active: ThreadSearchResult[];
    archived: ThreadSearchResult[];
  } | null;
  recent: ThreadListEntry[];
}): SearchListRow[] {
  const rows: SearchListRow[] = [];
  if (args.results) {
    if (args.results.active.length > 0) {
      rows.push({ type: "label", key: "label:active", label: "Threads" });
      for (const result of args.results.active) {
        rows.push({
          type: "thread",
          key: `active:${result.thread.id}`,
          row: flatThreadRow(result.thread),
          snippet: snippetFor(result),
        });
      }
    }
    if (args.results.archived.length > 0) {
      rows.push({ type: "label", key: "label:archived", label: "Archived" });
      for (const result of args.results.archived) {
        rows.push({
          type: "thread",
          key: `archived:${result.thread.id}`,
          row: flatThreadRow(result.thread),
          snippet: snippetFor(result),
        });
      }
    }
    return rows;
  }
  if (args.recent.length > 0) {
    rows.push({ type: "label", key: "label:recent", label: "Recent" });
    for (const thread of args.recent) {
      rows.push({
        type: "thread",
        key: `recent:${thread.id}`,
        row: flatThreadRow(thread),
        snippet: null,
      });
    }
  }
  return rows;
}

function SearchBody() {
  const insets = useSafeAreaInsets();
  const { tokens } = useTheme();
  const actions = useSidebarActions();
  const [query, setQuery] = useState("");
  const search = useThreadSearch(query);
  const recent = useRecentThreads();
  const [preferences] = useSidebarPreferences();
  const { model } = useSidebarModel({
    organize: preferences.organize,
    sort: preferences.sort,
  });

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
      }),
    [recent.threads, search.data, search.hasSearchableQuery],
  );

  const onPress = useCallback(
    (row: SidebarThreadRow) => actions.openThread(row.thread),
    [actions],
  );
  const onLongPress = useCallback(
    (row: SidebarThreadRow) => actions.openThreadMenu(row.thread),
    [actions],
  );
  const noop = useCallback(() => undefined, []);
  const projectNamesById = model.projectNamesById;

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<SearchListRow>) => {
      if (item.type === "label") {
        return (
          <Text variant="sectionLabel" className="px-4 pb-1 pt-4">
            {item.label}
          </Text>
        );
      }
      const subtitle: SidebarRowSubtitle | null =
        item.snippet !== null && item.snippet !== undefined
          ? { kind: "snippet", text: item.snippet }
          : projectSubtitle(
              projectNamesById.get(item.row.thread.projectId) ?? null,
            );
      return (
        <SidebarThreadRowView
          row={item.row}
          subtitle={subtitle}
          onPress={onPress}
          onLongPress={onLongPress}
          onToggleCollapsed={noop}
        />
      );
    },
    [noop, onLongPress, onPress, projectNamesById],
  );

  const trimmed = query.trim();
  const showHint =
    trimmed.length > 0 && !search.hasSearchableQuery && !search.isDebouncing;
  const noResults =
    search.hasSearchableQuery &&
    !search.isLoading &&
    !search.isDebouncing &&
    search.data !== undefined &&
    rows.length === 0;

  return (
    <>
      <View className="flex-row items-center gap-2 px-4 pb-2 pt-3">
        <View className="relative flex-1">
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder="Search threads"
            autoFocus
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
            className="pl-9"
            testID="thread-search-input"
          />
          <View
            pointerEvents="none"
            className="absolute bottom-0 left-3 top-0 justify-center"
          >
            <Icon name="Search" size={16} color={tokens.mutedForeground} />
          </View>
        </View>
        {search.isFetching || search.isDebouncing ? <Spinner /> : null}
      </View>
      {showHint ? (
        <EmptyState
          className="px-4 py-2"
          icon="Info"
          message={`Type at least ${THREAD_SEARCH_MIN_NON_WHITESPACE_CHARS} characters to search.`}
        />
      ) : null}
      {search.isError ? (
        <EmptyState
          className="px-4 py-2"
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
      <FlashList
        data={rows}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        renderItem={renderItem}
        extraData={{ projectNamesById }}
        maintainVisibleContentPosition={DISABLE_MAINTAIN_POSITION}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        testID="thread-search-list"
      />
    </>
  );
}

function keyExtractor(row: SearchListRow): string {
  return row.key;
}

function getItemType(row: SearchListRow): string {
  return row.type;
}

/** `/threads/search`: debounced full-text search, recent threads while empty. */
export function ThreadSearchScreen() {
  const { connection } = useProfiles();
  return (
    <Screen scroll={false} testID="thread-search-screen">
      {connection ? (
        <SidebarActionsProvider>
          <SearchBody />
        </SidebarActionsProvider>
      ) : (
        <View className="p-4">
          <Text variant="caption">No active server.</Text>
        </View>
      )}
    </Screen>
  );
}
