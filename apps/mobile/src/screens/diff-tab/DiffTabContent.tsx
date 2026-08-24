import type { DiffFileEntry } from "@bb/server-contract";
import {
  FlashList,
  type FlashListProps,
  type FlashListRef,
  type ListRenderItemInfo,
  type ViewToken,
} from "@shopify/flash-list";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { View } from "react-native";
import {
  buildDiffIdentity,
  collectViewportPatchPaths,
  diffCardStateStore,
  getDiffFilesFromResponse,
  useDiffCollapseAll,
  useDiffTarget,
  useEnvironmentDiffFiles,
  useEnvironmentDiffPatches,
} from "@/data/diff";
import { useEnvironment } from "@/data/environments";
import { removeEnvironmentDiffPatchQueries } from "@/lib/query/diff-patch-cache";
import { environmentWorkStatusQueryKeyPrefix } from "@/lib/query/query-keys";
import { Button, EmptyStatePanel, Skeleton, Text, useSheet } from "@/ui";
import { MergeBasePickerSheet } from "../thread/context/MergeBasePickerSheet";
import { DiffTabFileCard } from "./DiffTabFileCard";
import { DiffTabHeader } from "./DiffTabHeader";
import { DiffTargetPickerSheet } from "./DiffTargetPickerSheet";

/** Rows beyond the viewport whose `auto` patches are prefetched. */
const DIFF_FILES_OVERSCAN = 3;
const DIFF_ROW_GAP = 8;
/** Any on-screen sliver counts as visible (tall cards fill the viewport). */
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 1 };

interface DiffTabContentProps {
  /** The thread's environment; null shows the "no workspace" state. */
  environmentId: string | null;
  /**
   * A changed-file path requested from the banner / a timeline row: once it
   * is in the loaded slice, that card expands and scrolls to the top and
   * `onFocusedPath` fires so the host clears the request.
   */
  focusPath?: string | null;
  onFocusedPath?: () => void;
  /**
   * Whether the tab is on screen. While inactive the list stays mounted but
   * stops requesting patches for its visible rows (a realtime edit evicts
   * them; refetching off-screen is wasted work) and the TOC query pauses.
   */
  active?: boolean;
  /**
   * Scroll component for the list; a bottom-sheet host passes
   * `useBottomSheetScrollableCreator()` so the sheet's pan gesture and the
   * list scroll cooperate.
   */
  renderScrollComponent?: FlashListProps<DiffFileEntry>["renderScrollComponent"];
  /**
   * Quote text into the thread's composer ("Add to chat"). The host is
   * expected to close its panel / sheet and focus the composer afterwards.
   * The action hides when absent.
   */
  quoteIntoComposer?: (text: string) => void;
  testID?: string;
}

function keyExtractor(entry: DiffFileEntry): string {
  return entry.path;
}

function DiffSkeleton() {
  return (
    <View className="gap-2 px-4 pt-2" testID="diff-tab-loading">
      <Skeleton className="h-10 w-full rounded-lg" />
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-10 w-full rounded-lg" />
      <Skeleton className="h-16 w-full rounded-lg" />
    </View>
  );
}

function Notice({
  title,
  message,
  testID,
}: {
  title?: string;
  message: string;
  testID: string;
}) {
  return (
    <View className="px-4 pt-2" testID={testID}>
      <View className="rounded-lg border border-border bg-surface-raised px-3 py-2.5">
        {title ? (
          <Text className="text-xs font-medium text-foreground">{title}</Text>
        ) : null}
        <Text variant="caption" className={title ? "pt-1" : undefined}>
          {message}
        </Text>
      </View>
    </View>
  );
}

/**
 * The workspace panel's Diff tab: the changed-file table of contents for the
 * picked target (all / committed / uncommitted changes against the merge
 * base, or one commit) as a FlashList of per-file cards whose patches page
 * in as the list scrolls (`useEnvironmentDiffPatches`). Header: file count
 * and +/- totals, the target picker (with the merge-base row), collapse-all,
 * refresh. "Add to chat" on a card quotes its patch into the composer through
 * `quoteIntoComposer`.
 */
export function DiffTabContent({
  environmentId,
  focusPath,
  onFocusedPath,
  active = true,
  renderScrollComponent,
  quoteIntoComposer,
  testID = "diff-tab",
}: DiffTabContentProps) {
  const queryClient = useQueryClient();
  const environmentQuery = useEnvironment(environmentId);
  const environment = environmentQuery.data;
  const canDiff = environmentId !== null && environment?.isGitRepo === true;

  const targetState = useDiffTarget({ environment, enabled: canDiff });
  const { target } = targetState;
  const filesQuery = useEnvironmentDiffFiles(environmentId, {
    target,
    enabled: canDiff && active,
  });
  const response = filesQuery.data;
  const files = useMemo(() => getDiffFilesFromResponse(response), [response]);
  const mergeBaseRef =
    response?.outcome === "available" ? response.mergeBaseRef : null;
  const diffIdentity = buildDiffIdentity({
    environmentId: environmentId ?? "",
    target,
    mergeBaseRef,
  });
  const patches = useEnvironmentDiffPatches(environmentId ?? "", target);
  const { requestPaths, getPatchState, loadPath, retry, seedInitialPatches } =
    patches;
  const filesUpdatedAt = filesQuery.dataUpdatedAt;

  // A new slice starts from fresh collapse defaults.
  useEffect(() => {
    diffCardStateStore.retainOnly(diffIdentity);
  }, [diffIdentity]);

  // Prime the cache with the TOC's inline first-screen patches before the
  // viewport-driven fetch runs. Re-seeds on every TOC refetch.
  const initialPatches =
    response?.outcome === "available" ? response.initialPatches : undefined;
  useEffect(() => {
    if (initialPatches && initialPatches.length > 0) {
      seedInitialPatches(initialPatches);
    }
  }, [initialPatches, seedInitialPatches, filesUpdatedAt]);

  // Viewport → patch requests. FlashList reports the viewable rows; the
  // overscan band on either side is derived from that range.
  const [viewport, setViewport] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<DiffFileEntry>[] }) => {
      const indexes = viewableItems
        .map((token) => token.index)
        .filter((index): index is number => index !== null);
      const next =
        indexes.length === 0
          ? null
          : { start: Math.min(...indexes), end: Math.max(...indexes) };
      setViewport((previous) =>
        previous?.start === next?.start && previous?.end === next?.end
          ? previous
          : next,
      );
    },
    [],
  );
  // Request the viewport's patches when it moves, when the TOC refetches (a
  // content-only edit evicts the patches behind the same paths) and when the
  // tab comes back on screen. An inactive tab requests nothing.
  useEffect(() => {
    if (!active || viewport === null || files.length === 0) return;
    const mounted = {
      start: Math.max(0, viewport.start - DIFF_FILES_OVERSCAN),
      end: Math.min(files.length - 1, viewport.end + DIFF_FILES_OVERSCAN),
    };
    requestPaths(collectViewportPatchPaths(files, viewport, mounted));
  }, [active, files, filesUpdatedAt, requestPaths, viewport]);

  // Focus request: expand + scroll the file once it is in the real slice.
  const listRef = useRef<FlashListRef<DiffFileEntry>>(null);
  useEffect(() => {
    if (!focusPath || filesQuery.isPlaceholderData) return;
    const index = files.findIndex((file) => file.path === focusPath);
    if (index < 0) return;
    diffCardStateStore.setAll(diffIdentity, [focusPath], false);
    listRef.current?.scrollToIndex({ index, animated: true });
    onFocusedPath?.();
  }, [
    diffIdentity,
    files,
    filesQuery.isPlaceholderData,
    focusPath,
    onFocusedPath,
  ]);

  const collapseAll = useDiffCollapseAll(diffIdentity, files);
  const targetSheet = useSheet();
  const mergeBaseSheet = useSheet();
  const [refreshing, setRefreshing] = useState(false);
  // Refresh: fresh patches + TOC, and the workspace status behind the
  // target picker (commits above the merge base, dirty tree) so both agree.
  const refresh = useCallback(() => {
    if (!environmentId) return;
    setRefreshing(true);
    removeEnvironmentDiffPatchQueries(queryClient, environmentId);
    void queryClient.invalidateQueries({
      queryKey: environmentWorkStatusQueryKeyPrefix(environmentId),
    });
    void filesQuery.refetch().finally(() => setRefreshing(false));
  }, [environmentId, filesQuery, queryClient]);

  const displayRoot = environment?.path ?? null;

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<DiffFileEntry>): ReactElement => (
      <View style={{ paddingBottom: DIFF_ROW_GAP }}>
        <DiffTabFileCard
          entry={item}
          diffIdentity={diffIdentity}
          fileCount={files.length}
          patchState={getPatchState(item.path)}
          loadPath={loadPath}
          retry={retry}
          onAddToChat={quoteIntoComposer}
          workspaceRootPath={displayRoot}
          testID="diff-tab-file"
        />
      </View>
    ),
    [
      diffIdentity,
      displayRoot,
      files.length,
      getPatchState,
      loadPath,
      quoteIntoComposer,
      retry,
    ],
  );

  let body: ReactElement;
  if (environmentId === null || (environment && !environment.isGitRepo)) {
    body = (
      <View className="px-4 pt-2" testID="diff-tab-unavailable">
        <EmptyStatePanel>
          {environmentId === null
            ? "This thread has no workspace to diff."
            : "This workspace is not a git repository."}
        </EmptyStatePanel>
      </View>
    );
  } else if (
    (!environment && environmentQuery.isPending) ||
    (filesQuery.isPending && !response)
  ) {
    body = <DiffSkeleton />;
  } else if (filesQuery.error && !response) {
    body = (
      <View className="gap-3 px-4 pt-2" testID="diff-tab-error">
        <EmptyStatePanel>
          <Text className="text-center text-sm text-muted-foreground">
            Could not load the diff.
          </Text>
          <Text variant="caption" className="pt-1 text-center">
            {filesQuery.error.message}
          </Text>
        </EmptyStatePanel>
        <Button variant="outline" icon="RotateCcw" onPress={refresh}>
          Retry
        </Button>
      </View>
    );
  } else if (!response) {
    body = (
      <View className="px-4 pt-2" testID="diff-tab-empty">
        <EmptyStatePanel>No changes.</EmptyStatePanel>
      </View>
    );
  } else if (response.outcome === "unavailable") {
    body = (
      <Notice
        title="Workspace unavailable"
        message={response.failure.message}
        testID="diff-tab-unavailable"
      />
    );
  } else if (response.outcome === "not_applicable") {
    body = <Notice message={response.message} testID="diff-tab-unavailable" />;
  } else if (response.files.length === 0) {
    body = (
      <View className="px-4 pt-2" testID="diff-tab-empty">
        <EmptyStatePanel>No changes.</EmptyStatePanel>
      </View>
    );
  } else {
    body = (
      <FlashList
        ref={listRef}
        data={files}
        extraData={renderItem}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={VIEWABILITY_CONFIG}
        renderScrollComponent={renderScrollComponent}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: 24,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
        testID={`${testID}-list`}
      />
    );
  }

  return (
    <View className="flex-1" testID={testID}>
      <DiffTabHeader
        files={files}
        truncated={response?.outcome === "available" && response.truncated}
        target={target}
        onPickTarget={targetSheet.present}
        targetDisabled={!canDiff}
        areAllCollapsed={collapseAll.areAllCollapsed}
        onToggleCollapseAll={collapseAll.toggleAll}
        collapseDisabled={files.length === 0}
        onRefresh={refresh}
        refreshing={refreshing || filesQuery.isFetching}
        refreshDisabled={!canDiff}
      />
      {body}
      <DiffTargetPickerSheet
        controller={targetSheet}
        stackBehavior="push"
        options={targetState.options}
        value={targetState.selection}
        onChange={targetState.setSelection}
        mergeBase={
          targetState.mergeBase.showMergeBase &&
          targetState.mergeBase.effectiveMergeBaseBranch
            ? {
                branch: targetState.mergeBase.effectiveMergeBaseBranch,
                onPress: () => {
                  targetSheet.dismiss();
                  mergeBaseSheet.present();
                },
              }
            : null
        }
      />
      <MergeBasePickerSheet
        controller={mergeBaseSheet}
        stackBehavior="push"
        environmentId={environmentId}
        mergeBaseBranch={targetState.mergeBase.effectiveMergeBaseBranch}
        onSelect={targetState.mergeBase.setMergeBaseBranch}
      />
    </View>
  );
}
