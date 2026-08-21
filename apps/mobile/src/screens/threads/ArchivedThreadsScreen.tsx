import type { ThreadListEntry } from "@bb/domain";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useProfiles } from "@/app-shell";
import { useSidebarBootstrap } from "@/data/sidebar";
import {
  getThreadDisplayTitle,
  useArchivedThreads,
  useUnarchiveThread,
} from "@/data/threads";
import { useTheme } from "@/theme";
import {
  ActionSheet,
  Button,
  EmptyStatePanel,
  Icon,
  Skeleton,
  Spinner,
  Text,
  toast,
  useSheet,
  type ActionSheetAction,
} from "@/ui";
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

/** Rows inserted at the top (unarchive, realtime) should simply appear, not shift the viewport. */
const DISABLE_MAINTAIN_POSITION = { disabled: true };

function ArchivedRow({
  row,
  subtitle,
  onPress,
  onLongPress,
  onUnarchive,
  pending,
}: {
  row: SidebarThreadRow;
  subtitle: SidebarRowSubtitle | null;
  onPress: (row: SidebarThreadRow) => void;
  onLongPress: (row: SidebarThreadRow) => void;
  onUnarchive: (thread: ThreadListEntry) => void;
  pending: boolean;
}) {
  const { tokens } = useTheme();
  const noop = useCallback(() => undefined, []);
  return (
    <View className="flex-row items-center">
      <View className="min-w-0 flex-1">
        <SidebarThreadRowView
          row={row}
          subtitle={subtitle}
          onPress={onPress}
          onLongPress={onLongPress}
          onToggleCollapsed={noop}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Unarchive ${getThreadDisplayTitle(row.thread)}`}
        hitSlop={6}
        disabled={pending}
        onPress={() => onUnarchive(row.thread)}
        className="mr-2 h-10 w-10 items-center justify-center rounded-md active:bg-state-hover"
        style={{ opacity: pending ? 0.5 : 1 }}
        testID={`unarchive-${row.thread.id}`}
      >
        <Icon name="ArchiveRestore" size={20} color={tokens.foreground} />
      </Pressable>
    </View>
  );
}

function ArchivedBody({
  initialProjectId,
}: {
  initialProjectId: string | null;
}) {
  const insets = useSafeAreaInsets();
  const { tokens } = useTheme();
  const actions = useSidebarActions();
  const bootstrap = useSidebarBootstrap();
  const [projectId, setProjectId] = useState<string | null>(initialProjectId);
  const archived = useArchivedThreads(projectId ? { projectId } : {});
  const unarchive = useUnarchiveThread();
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

  const onPress = useCallback(
    (row: SidebarThreadRow) => actions.openThread(row.thread),
    [actions],
  );
  const onLongPress = useCallback(
    (row: SidebarThreadRow) => actions.openThreadMenu(row.thread),
    [actions],
  );
  const onUnarchive = useCallback(
    (thread: ThreadListEntry) => {
      unarchive.mutate(
        { id: thread.id },
        {
          onSuccess: () =>
            toast.success(`Unarchived ${getThreadDisplayTitle(thread)}`),
        },
      );
    },
    [unarchive],
  );
  const pendingIds = unarchive.variables?.id;

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<SidebarThreadRow>) => (
      <ArchivedRow
        row={item}
        subtitle={projectSubtitle(
          projectId === null
            ? (projectNamesById.get(item.thread.projectId) ?? null)
            : null,
        )}
        onPress={onPress}
        onLongPress={onLongPress}
        onUnarchive={onUnarchive}
        pending={unarchive.isPending && pendingIds === item.thread.id}
      />
    ),
    [
      onLongPress,
      onPress,
      onUnarchive,
      pendingIds,
      projectId,
      projectNamesById,
      unarchive.isPending,
    ],
  );

  const filterLabel = projectId
    ? (projectNamesById.get(projectId) ?? "Project")
    : "All projects";

  const filterActions: ActionSheetAction[] = [
    {
      key: "all",
      label: "All projects",
      icon: "Layers",
      onPress: () => setProjectId(null),
    },
    ...projects.map(
      (project): ActionSheetAction => ({
        key: project.id,
        label: project.name,
        icon: "Folder",
        onPress: () => setProjectId(project.id),
      }),
    ),
  ];

  return (
    <>
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
      {archived.isLoading ? (
        <View className="gap-3 px-4 pt-4" testID="archived-loading">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-4 w-2/3" />
          ))}
        </View>
      ) : archived.isError ? (
        <View className="gap-3 p-4">
          <EmptyStatePanel>
            <Text className="text-center text-sm text-muted-foreground">
              Could not load archived threads.
            </Text>
            <Text variant="caption" className="pt-1 text-center">
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
        </View>
      ) : (
        <FlashList
          data={rows}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          extraData={{
            projectId,
            pendingIds,
            isPending: unarchive.isPending,
          }}
          maintainVisibleContentPosition={DISABLE_MAINTAIN_POSITION}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (archived.hasNextPage && !archived.isFetchingNextPage) {
              void archived.fetchNextPage();
            }
          }}
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
          contentContainerStyle={{
            paddingBottom: insets.bottom + 24,
            paddingTop: 8,
          }}
          testID="archived-thread-list"
        />
      )}
      <ActionSheet
        controller={filterSheet}
        title="Filter by project"
        actions={filterActions}
      />
    </>
  );
}

function keyExtractor(row: SidebarThreadRow): string {
  return row.key;
}

/** `/settings/archived`: paginated archived threads, filter by project, unarchive. */
export function ArchivedThreadsScreen() {
  const { connection } = useProfiles();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  return (
    <Screen scroll={false} testID="archived-threads-screen">
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
