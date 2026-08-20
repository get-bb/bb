import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { useHosts } from "@/data/hosts";
import {
  useSidebarBootstrap,
  useSidebarCollapsedSets,
  useSidebarModel,
  useSidebarPreferences,
} from "@/data/sidebar";
import { Button, EmptyStatePanel, Skeleton, Text } from "@/ui";
import { getRelativeTimeRefreshIntervalMs } from "./relative-time";
import { useSidebarActions } from "./SidebarActionsProvider";
import {
  SidebarEmptyRowView,
  SidebarEnvironmentRowView,
  SidebarHeaderRowView,
  SidebarThreadRowView,
} from "./SidebarRows";
import {
  buildSidebarListRows,
  getHeaderCollapseTarget,
  type SidebarHeaderRow,
  type SidebarListRow,
  type SidebarThreadRow,
} from "./sidebar-list-rows";

/** Ticks once a minute so relative-time labels stay fresh without per-row timers. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(
      () => setNow(Date.now()),
      getRelativeTimeRefreshIntervalMs(),
    );
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * FlashList keeps the first visible row anchored when rows are inserted above
 * it (chat-style). A sidebar wants the opposite: a thread that gets pinned or
 * created must appear at the top, not push the viewport down past it.
 */
const DISABLE_MAINTAIN_POSITION = { disabled: true };

const SKELETON_WIDTHS = ["w-1/2", "w-2/3", "w-3/5", "w-1/2", "w-3/4", "w-2/5"];

function SidebarListSkeleton() {
  return (
    <View className="gap-3 px-4 pt-4" testID="sidebar-list-loading">
      <Skeleton className="h-3 w-24" />
      {SKELETON_WIDTHS.map((width, index) => (
        <View key={index} className="flex-row items-center gap-3 py-1">
          <Skeleton className={`h-4 ${width}`} />
          <View className="flex-1" />
          <Skeleton className="h-3 w-8" />
        </View>
      ))}
    </View>
  );
}

export interface SidebarThreadListProps {
  /** Highlights the row of the thread that is open. */
  selectedThreadId?: string | null;
  /** Rendered above the first section (scrolls with the list). */
  ListHeaderComponent?: ReactElement | null;
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The grouped thread list (pinned, then projects / machines / sections per
 * the organize preference) as a FlashList. Shared by the drawer and the home
 * screen; the row menus come from the enclosing `SidebarActionsProvider`.
 * Data stays put across realtime refetches (the bootstrap query keeps its
 * previous data), so rows update in place instead of flashing.
 */
export function SidebarThreadList({
  selectedThreadId = null,
  ListHeaderComponent,
  contentContainerStyle,
  testID,
}: SidebarThreadListProps) {
  const [preferences, preferenceActions] = useSidebarPreferences();
  const collapsed = useSidebarCollapsedSets(preferences);
  const { model, isLoading, isError, error, refetch } = useSidebarModel({
    organize: preferences.organize,
    sort: preferences.sort,
  });
  const bootstrap = useSidebarBootstrap();
  const hosts = useHosts();
  const actions = useSidebarActions();
  const now = useNow();
  const [refreshing, setRefreshing] = useState(false);

  const rows = useMemo(
    () => buildSidebarListRows({ model, collapsed }),
    [model, collapsed],
  );

  const bootstrapRefetch = bootstrap.refetch;
  const hostsRefetch = hosts.refetch;
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Promise.allSettled([bootstrapRefetch(), hostsRefetch()]).finally(() =>
      setRefreshing(false),
    );
  }, [bootstrapRefetch, hostsRefetch]);

  const onThreadPress = useCallback(
    (row: SidebarThreadRow) => actions.openThread(row.thread),
    [actions],
  );
  const onThreadLongPress = useCallback(
    (row: SidebarThreadRow) => actions.openThreadMenu(row.thread),
    [actions],
  );
  const onToggleThread = useCallback(
    (threadId: string) => preferenceActions.toggleCollapsed("thread", threadId),
    [preferenceActions],
  );
  const onToggleEnvironment = useCallback(
    (environmentId: string) =>
      preferenceActions.toggleCollapsed("environment", environmentId),
    [preferenceActions],
  );
  const onToggleHeader = useCallback(
    (row: SidebarHeaderRow) => {
      const target = getHeaderCollapseTarget(row);
      preferenceActions.toggleCollapsed(target.kind, target.id);
    },
    [preferenceActions],
  );
  const onHeaderLongPress = useCallback(
    (row: SidebarHeaderRow) => {
      if (row.target.kind === "project")
        actions.openProjectMenu(row.target.project);
      else if (row.target.kind === "section") {
        actions.openSectionMenu(row.target.section);
      }
    },
    [actions],
  );
  const onHeaderCreateThread = useCallback(
    (row: SidebarHeaderRow) => {
      switch (row.target.kind) {
        case "project":
          actions.createThread({ projectId: row.target.project.id });
          return;
        case "section":
          actions.createThread({ sectionId: row.target.section.id });
          return;
        case "threads":
          actions.createThread({ projectId: PERSONAL_PROJECT_ID });
          return;
        case "pinned":
        case "machine":
          return;
      }
    },
    [actions],
  );

  const organize = preferences.organize;
  const sort = preferences.sort;
  const projectNamesById = model.projectNamesById;

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<SidebarListRow>) => {
      switch (item.type) {
        case "header":
          return (
            <SidebarHeaderRowView
              row={item}
              onToggleCollapsed={onToggleHeader}
              onLongPress={onHeaderLongPress}
              onCreateThread={
                item.target.kind === "pinned" || item.target.kind === "machine"
                  ? null
                  : onHeaderCreateThread
              }
            />
          );
        case "thread": {
          const { thread } = item;
          const showProject =
            (item.groupProjectId === null || organize !== "project") &&
            thread.projectId !== PERSONAL_PROJECT_ID &&
            item.depth === 0;
          return (
            <SidebarThreadRowView
              row={item}
              selected={thread.id === selectedThreadId}
              subtitle={
                showProject
                  ? (projectNamesById.get(thread.projectId) ?? null)
                  : null
              }
              timestamp={
                sort === "created" ? thread.createdAt : thread.latestAttentionAt
              }
              now={now}
              onPress={onThreadPress}
              onLongPress={onThreadLongPress}
              onToggleCollapsed={onToggleThread}
            />
          );
        }
        case "environment":
          return (
            <SidebarEnvironmentRowView
              row={item}
              onToggleCollapsed={onToggleEnvironment}
            />
          );
        case "empty":
          return <SidebarEmptyRowView row={item} />;
      }
    },
    [
      now,
      onHeaderCreateThread,
      onHeaderLongPress,
      onThreadLongPress,
      onThreadPress,
      onToggleEnvironment,
      onToggleHeader,
      onToggleThread,
      organize,
      projectNamesById,
      selectedThreadId,
      sort,
    ],
  );

  if (!model.isReady) {
    if (isError) {
      return (
        <View className="gap-3 p-4" testID="sidebar-list-error">
          {ListHeaderComponent}
          <EmptyStatePanel>
            <Text className="text-center text-sm text-muted-foreground">
              Could not load threads.
            </Text>
            <Text
              variant="caption"
              className="pt-1 text-center"
              numberOfLines={3}
            >
              {error?.message ?? "Unknown error"}
            </Text>
          </EmptyStatePanel>
          <Button variant="outline" icon="RotateCcw" onPress={refetch}>
            Retry
          </Button>
        </View>
      );
    }
    if (isLoading) {
      return (
        <View className="flex-1">
          {ListHeaderComponent}
          <SidebarListSkeleton />
        </View>
      );
    }
  }

  const isEmpty =
    model.isReady && model.projects.length === 0 && model.threads.length === 0;

  return (
    <FlashList
      data={rows}
      keyExtractor={keyExtractor}
      getItemType={getItemType}
      renderItem={renderItem}
      extraData={{ selectedThreadId, now, organize, sort }}
      maintainVisibleContentPosition={DISABLE_MAINTAIN_POSITION}
      refreshing={refreshing}
      onRefresh={onRefresh}
      ListHeaderComponent={ListHeaderComponent}
      ListEmptyComponent={
        isEmpty ? (
          <View className="gap-3 px-4 pt-6" testID="sidebar-list-empty">
            <EmptyStatePanel>
              No projects yet. Add a project to start threads on a machine, or
              start a personal thread.
            </EmptyStatePanel>
            <Button icon="FolderPlus" onPress={actions.createProject}>
              New project
            </Button>
            <Button
              variant="outline"
              icon="MessageSquarePlus"
              onPress={() =>
                actions.createThread({ projectId: PERSONAL_PROJECT_ID })
              }
            >
              New thread
            </Button>
          </View>
        ) : null
      }
      contentContainerStyle={contentContainerStyle}
      keyboardShouldPersistTaps="handled"
      testID={testID}
    />
  );
}

function keyExtractor(row: SidebarListRow): string {
  return row.key;
}

function getItemType(row: SidebarListRow): string {
  return row.type;
}
