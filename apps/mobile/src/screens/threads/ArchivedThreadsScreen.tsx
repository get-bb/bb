import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useProfiles } from "@/app-shell";
import { useSidebarBootstrap } from "@/data/sidebar";
import { useArchivedThreads } from "@/data/threads";
import { haptic } from "@/lib/haptics";
import { useTheme } from "@/theme";
import {
  ActionSheet,
  Button,
  EmptyStatePanel,
  Icon,
  Skeleton,
  Spinner,
  Text,
  useSheet,
  type ActionSheetAction,
} from "@/ui";
import { ConnectionBanner } from "../shell/ConnectionBanner";
import { Screen } from "../shell/Screen";
import {
  flatThreadRow,
  projectSubtitle,
  SidebarActionsProvider,
  SidebarThreadRowView,
  type SidebarThreadRow,
} from "../sidebar";

const IS_IOS = process.env.EXPO_OS === "ios";

/** Rows inserted at the top (unarchive, realtime) should simply appear, not shift the viewport. */
const DISABLE_MAINTAIN_POSITION = { disabled: true };

function ArchivedBody({
  initialProjectId,
}: {
  initialProjectId: string | null;
}) {
  const insets = useSafeAreaInsets();
  const { tokens } = useTheme();
  const bootstrap = useSidebarBootstrap();
  const [projectId, setProjectId] = useState<string | null>(initialProjectId);
  const archived = useArchivedThreads(projectId ? { projectId } : {});
  const filterSheet = useSheet();

  const bootstrapData = bootstrap.data;
  const projects = useMemo(
    () => bootstrapData?.projects ?? [],
    [bootstrapData],
  );
  const projectNamesById = useMemo(() => {
    const names = new Map<string, string>();
    for (const project of projects) names.set(project.id, project.name);
    if (bootstrapData) {
      names.set(
        bootstrapData.personalProject.id,
        bootstrapData.personalProject.name,
      );
    }
    return names;
  }, [bootstrapData, projects]);

  const rows = useMemo(
    () =>
      (archived.data?.pages ?? []).flatMap((page) => page.map(flatThreadRow)),
    [archived.data],
  );

  const noop = useCallback(() => undefined, []);
  const selectProject = useCallback((next: string | null) => {
    haptic("selection");
    setProjectId(next);
  }, []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<SidebarThreadRow>) => (
      <SidebarThreadRowView
        row={item}
        subtitle={projectSubtitle(
          projectId === null
            ? (projectNamesById.get(item.thread.projectId) ?? null)
            : null,
        )}
        onToggleCollapsed={noop}
      />
    ),
    [noop, projectId, projectNamesById],
  );

  const filterLabel = projectId
    ? (projectNamesById.get(projectId) ?? "Project")
    : "All projects";

  const filterActions: ActionSheetAction[] = [
    {
      key: "all",
      label: "All projects",
      icon: "Layers",
      checked: projectId === null,
      onPress: () => selectProject(null),
    },
    ...projects.map((project): ActionSheetAction => ({
      key: project.id,
      label: project.name,
      icon: "Folder",
      checked: projectId === project.id,
      onPress: () => selectProject(project.id),
    })),
  ];

  const banner = <ConnectionBanner inset />;

  return (
    <>
      {IS_IOS ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu
            icon="line.3.horizontal.decrease.circle"
            title={filterLabel}
            accessibilityLabel="Filter by project"
          >
            <Stack.Toolbar.MenuAction
              icon="tray.full"
              isOn={projectId === null}
              onPress={() => selectProject(null)}
            >
              All projects
            </Stack.Toolbar.MenuAction>
            {projects.map((project) => (
              <Stack.Toolbar.MenuAction
                key={project.id}
                icon="folder"
                isOn={projectId === project.id}
                onPress={() => selectProject(project.id)}
              >
                {project.name}
              </Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      ) : (
        <Stack.Screen
          options={{
            headerRight: () => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Filter by project: ${filterLabel}`}
                hitSlop={8}
                onPress={filterSheet.present}
                className="flex-row items-center gap-1 rounded-md px-2 py-1 active:bg-state-hover"
                testID="archived-filter"
              >
                <Icon name="Folder" size={16} color={tokens.mutedForeground} />
                <Text
                  variant="label"
                  tone="muted"
                  numberOfLines={1}
                  className="max-w-36"
                >
                  {filterLabel}
                </Text>
                <Icon
                  name="ChevronDown"
                  size={14}
                  color={tokens.mutedForeground}
                />
              </Pressable>
            ),
          }}
        />
      )}
      {archived.isLoading ? (
        <ScrollView
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          scrollEnabled={false}
        >
          {banner}
          <View className="gap-3 px-4 pt-4" testID="archived-loading">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-4 w-2/3" />
            ))}
          </View>
        </ScrollView>
      ) : archived.isError ? (
        <ScrollView
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ gap: 12, padding: 16 }}
        >
          {banner}
          <EmptyStatePanel>
            <Text className="text-center text-sm text-muted-foreground">
              Could not load archived threads.
            </Text>
            <Text variant="caption" className="pt-1 text-center" selectable>
              {archived.error.message}
            </Text>
          </EmptyStatePanel>
          <Button
            variant="outline"
            icon="RotateCcw"
            onPress={() => archived.refetch()}
          >
            Retry
          </Button>
        </ScrollView>
      ) : (
        <FlashList
          data={rows}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          extraData={{ projectId }}
          maintainVisibleContentPosition={DISABLE_MAINTAIN_POSITION}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (archived.hasNextPage && !archived.isFetchingNextPage) {
              void archived.fetchNextPage();
            }
          }}
          ListHeaderComponent={banner}
          ListEmptyComponent={
            <View className="p-4" testID="archived-empty">
              <EmptyStatePanel>
                {projectId
                  ? "No archived threads in this project."
                  : "No archived threads."}
              </EmptyStatePanel>
            </View>
          }
          ListFooterComponent={
            archived.isFetchingNextPage ? (
              <View className="items-center py-4">
                <Spinner />
              </View>
            ) : null
          }
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            paddingBottom: insets.bottom + 24,
            paddingTop: 4,
          }}
          testID="archived-thread-list"
        />
      )}
      {IS_IOS ? null : (
        <ActionSheet
          controller={filterSheet}
          title="Filter by project"
          actions={filterActions}
        />
      )}
    </>
  );
}

function keyExtractor(row: SidebarThreadRow): string {
  return row.key;
}

/**
 * `/settings/archived`: paginated archived threads under a large title,
 * filtered by project from the header menu; rows unarchive from the
 * context menu, the swipe actions, or (Android) the long-press sheet.
 */
export function ArchivedThreadsScreen() {
  const { connection } = useProfiles();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  return (
    <Screen scroll={false} banner={false} testID="archived-threads-screen">
      {connection ? (
        <SidebarActionsProvider>
          <ArchivedBody initialProjectId={projectId ?? null} />
        </SidebarActionsProvider>
      ) : (
        <View className="p-4">
          <Text variant="caption">No active server.</Text>
        </View>
      )}
    </Screen>
  );
}
