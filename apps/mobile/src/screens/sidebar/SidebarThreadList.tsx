import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import {
  ScrollView,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useHosts } from "@/data/hosts";
import {
  useSidebarBootstrap,
  useSidebarCollapsedSets,
  useSidebarModel,
  useSidebarPreferences,
  useSidebarSectionOrder,
} from "@/data/sidebar";
import { Button, EmptyStatePanel, Skeleton, Text } from "@/ui";
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
} from "./sidebar-list-rows";

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

interface SidebarThreadListProps {
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Keeps the indicator clear of a bar floating over the list's bottom. */
  scrollIndicatorInsets?: ScrollViewProps["scrollIndicatorInsets"];
  /** Scrolls with the rows (the connection banner on home). */
  ListHeaderComponent?: ReactElement | null;
  testID?: string;
}

/**
 * The grouped thread list (pinned, then projects / machines / sections per
 * the organize preference) as a FlashList, the body of the home screen; the
 * row actions come from the enclosing `SidebarActionsProvider`. The list is
 * the screen's first scrollable and adjusts for the native header itself.
 * Data stays put across realtime refetches (the bootstrap query keeps its
 * previous data), so rows update in place instead of flashing.
 */
export function SidebarThreadList({
  contentContainerStyle,
  scrollIndicatorInsets,
  ListHeaderComponent,
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
  const [refreshing, setRefreshing] = useState(false);

  const sectionOrder = useSidebarSectionOrder(
    model,
    preferences,
    preferenceActions,
  );
  const rows = useMemo(
    () => buildSidebarListRows({ model, collapsed, sectionOrder }),
    [model, collapsed, sectionOrder],
  );

  const bootstrapRefetch = bootstrap.refetch;
  const hostsRefetch = hosts.refetch;
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Promise.allSettled([bootstrapRefetch(), hostsRefetch()]).finally(() =>
      setRefreshing(false),
    );
  }, [bootstrapRefetch, hostsRefetch]);

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
      switch (row.target.kind) {
        case "project":
          actions.openProjectMenu(row.target.project);
          return;
        case "section":
          actions.openSectionMenu(row.target.section);
          return;
        case "pinned":
        case "threads":
        case "machine":
          // No menu of their own: a long-press goes straight to reordering.
          actions.openSectionReorder();
          return;
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
        case "thread":
          // One line per row, like the web sidebar: the project name lives
          // on the group header, not under every thread.
          return (
            <SidebarThreadRowView
              row={item}
              subtitle={null}
              onToggleCollapsed={onToggleThread}
            />
          );
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
      onHeaderCreateThread,
      onHeaderLongPress,
      onToggleEnvironment,
      onToggleHeader,
      onToggleThread,
    ],
  );

  if (!model.isReady) {
    if (isError) {
      return (
        <ScrollView
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ gap: 12, padding: 16 }}
          testID="sidebar-list-error"
        >
          {ListHeaderComponent}
          <EmptyStatePanel>
            <Text className="text-center text-sm text-muted-foreground">
              Could not load threads.
            </Text>
            <Text variant="caption" className="pt-1 text-center" selectable>
              {error?.message ?? "Unknown error"}
            </Text>
          </EmptyStatePanel>
          <Button variant="outline" icon="RotateCcw" onPress={refetch}>
            Retry
          </Button>
        </ScrollView>
      );
    }
    if (isLoading) {
      return (
        <ScrollView
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          scrollEnabled={false}
        >
          {ListHeaderComponent}
          <SidebarListSkeleton />
        </ScrollView>
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
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={contentContainerStyle}
      scrollIndicatorInsets={scrollIndicatorInsets}
      keyboardShouldPersistTaps="handled"
      // Not "interactive": the dock under the list is padded by
      // KeyboardPaddingView, which only follows keyboard frame notifications,
      // not a drag.
      keyboardDismissMode="on-drag"
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
