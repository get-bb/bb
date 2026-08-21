import { useCallback, useMemo, useState, type ComponentType } from "react";
import {
  FlatList,
  Pressable,
  View,
  type FlatListProps,
  type ListRenderItem,
} from "react-native";
import {
  getFileName,
  listStorageDirectory,
  useFileSearch,
  useThreadRecentFiles,
  useThreadStorageFiles,
  type FileSearchSource,
  type StorageEntry,
} from "@/data/files";
import { copyWithToast } from "@/lib/clipboard";
import { useTheme } from "@/theme";
import {
  ActionSheet,
  EmptyStatePanel,
  Icon,
  Input,
  SheetFlatList,
  Skeleton,
  Spinner,
  Text,
  useSheet,
  type ActionSheetAction,
} from "@/ui";
import { useThreadFileOpener } from "./file-opener";
import type { FilePreviewTarget } from "./file-preview-target";
import { buildFilesTabRows, type FilesTabRow } from "./files-tab-model";
import { FilePathRow } from "./FilePathRow";
import { StorageBreadcrumbs } from "./ThreadStorageBrowser";

interface FilesTabContentProps {
  /** Null for the root-compose panel (no thread storage, no recents). */
  threadId: string | null;
  projectId: string | null;
  /** The thread's environment; null while it has none (project-file previews). */
  environmentId: string | null;
  hostId: string | null;
  /**
   * `"screen"` (default) renders a plain FlatList; `"sheet"` renders
   * gorhom's BottomSheetFlatList so the list scrolls inside the panel sheet.
   */
  scroll?: "screen" | "sheet";
  /** Seed the search box (the panel's Files launcher params). */
  initialQuery?: string | null;
  testID?: string;
}

interface CopyMenuTarget {
  path: string;
  name: string;
}

function sourceLabel(source: FileSearchSource): string {
  return source === "workspace" ? "Workspace" : "Thread storage";
}

/**
 * The Files tab: a search box over the workspace (environment or project
 * paths) and thread storage, and — when idle — the thread's recent files
 * plus a storage browser with breadcrumbs. Tapping a file opens the preview;
 * long-press copies the path / name.
 */
export function FilesTabContent({
  threadId,
  projectId,
  environmentId,
  hostId,
  scroll = "screen",
  initialQuery = null,
  testID = "files-tab",
}: FilesTabContentProps) {
  const { tokens } = useTheme();
  const [query, setQuery] = useState(initialQuery ?? "");
  const [directoryPath, setDirectoryPath] = useState("");
  const [recentExpanded, setRecentExpanded] = useState(false);
  const search = useFileSearch({
    threadId,
    projectId,
    environmentId,
    hostId,
    query,
  });
  const storageFiles = useThreadStorageFiles(threadId, {
    enabled: threadId !== null,
  });
  const recent = useThreadRecentFiles(threadId);
  const openFile = useThreadFileOpener(threadId);

  const storageEntries = useMemo(
    () =>
      storageFiles.data
        ? listStorageDirectory(storageFiles.data.files, directoryPath)
        : [],
    [directoryPath, storageFiles.data],
  );
  const rows = useMemo(
    () =>
      buildFilesTabRows({
        hasQuery: search.hasQuery,
        search: {
          sections: search.sections,
          isLoading: search.isLoading || search.isDebouncing,
          isError: search.isError,
          isUnavailable: search.isUnavailable,
        },
        recent: { items: recent.items, expanded: recentExpanded },
        storage:
          threadId === null
            ? null
            : {
                directoryPath,
                entries: storageEntries,
                loaded: storageFiles.data !== undefined,
                isLoading: storageFiles.isLoading,
                isError: storageFiles.isError,
              },
      }),
    [
      threadId,
      directoryPath,
      recent.items,
      recentExpanded,
      search.hasQuery,
      search.isDebouncing,
      search.isError,
      search.isLoading,
      search.isUnavailable,
      search.sections,
      storageEntries,
      storageFiles.data,
      storageFiles.isError,
      storageFiles.isLoading,
    ],
  );

  const workspaceTarget = useCallback(
    (path: string): FilePreviewTarget =>
      environmentId !== null
        ? {
            kind: "workspace-file",
            path,
            source: { kind: "working-tree" },
            statusLabel: null,
          }
        : { kind: "project-file", path },
    [environmentId],
  );
  const openSource = useCallback(
    (source: FileSearchSource, path: string) => {
      openFile({
        target:
          source === "workspace"
            ? workspaceTarget(path)
            : { kind: "storage-file", path },
        lineRange: null,
      });
    },
    [openFile, workspaceTarget],
  );

  const copyMenu = useSheet();
  const [copyTarget, setCopyTarget] = useState<CopyMenuTarget | null>(null);
  const presentCopyMenu = useCallback(
    (target: CopyMenuTarget) => {
      setCopyTarget(target);
      copyMenu.present();
    },
    [copyMenu],
  );
  const copyActions = useMemo<ActionSheetAction[]>(
    () =>
      copyTarget === null
        ? []
        : [
            {
              key: "copy-path",
              label: "Copy path",
              icon: "Copy",
              onPress: () => copyWithToast(copyTarget.path, "Path copied"),
            },
            {
              key: "copy-name",
              label: "Copy name",
              icon: "Copy",
              onPress: () => copyWithToast(copyTarget.name, "Name copied"),
            },
          ],
    [copyTarget],
  );
  const presentEntryMenu = useCallback(
    (entry: StorageEntry) =>
      presentCopyMenu({ path: entry.path, name: entry.name }),
    [presentCopyMenu],
  );

  const renderItem = useCallback<ListRenderItem<FilesTabRow>>(
    ({ item }) => {
      switch (item.kind) {
        case "section":
          return (
            <View className="flex-row items-baseline justify-between px-4 pb-1 pt-4">
              <Text variant="sectionLabel">{item.title}</Text>
              {item.note ? <Text variant="caption">{item.note}</Text> : null}
            </View>
          );
        case "search-result":
          return (
            <FilePathRow
              path={item.path}
              positions={item.positions}
              icon="FileText"
              onPress={() => openSource(item.source, item.path)}
              onLongPress={() =>
                presentCopyMenu({
                  path: item.path,
                  name: getFileName(item.path),
                })
              }
              testID="files-search-result"
            />
          );
        case "recent":
          return (
            <FilePathRow
              path={item.item.path}
              icon="Clock"
              trailingText={sourceLabel(item.item.source)}
              onPress={() => openSource(item.item.source, item.item.path)}
              onLongPress={() =>
                presentCopyMenu({
                  path: item.item.path,
                  name: getFileName(item.item.path),
                })
              }
              testID="files-recent-row"
            />
          );
        case "recent-toggle":
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() => setRecentExpanded((current) => !current)}
              className="px-4 py-2 active:opacity-70"
              testID="files-recent-toggle"
            >
              <Text variant="chrome" tone="primary">
                {item.expanded ? "Show fewer" : `Show ${item.hidden} more`}
              </Text>
            </Pressable>
          );
        case "storage-breadcrumbs":
          return (
            <View className="py-1">
              <StorageBreadcrumbs
                directoryPath={item.directoryPath}
                onNavigate={setDirectoryPath}
              />
            </View>
          );
        case "storage-entry":
          return item.entry.kind === "directory" ? (
            <FilePathRow
              path={item.entry.name}
              icon="Folder"
              trailingText={`${item.entry.fileCount} ${item.entry.fileCount === 1 ? "file" : "files"}`}
              trailing="chevron"
              onPress={() => setDirectoryPath(item.entry.path)}
              onLongPress={() => presentEntryMenu(item.entry)}
              testID="storage-directory-row"
            />
          ) : (
            <FilePathRow
              path={item.entry.name}
              icon="FileText"
              onPress={() =>
                openFile({
                  target: { kind: "storage-file", path: item.entry.path },
                  lineRange: null,
                })
              }
              onLongPress={() => presentEntryMenu(item.entry)}
              testID="storage-file-row"
            />
          );
        case "storage-state":
          return (
            <View className="px-4 py-2">
              {item.state === "loading" ? (
                <View className="gap-2 py-1" testID="thread-storage-loading">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                </View>
              ) : (
                <EmptyStatePanel>
                  {item.state === "error"
                    ? "Could not load thread storage."
                    : directoryPath.length === 0
                      ? "No files in thread storage yet."
                      : "Empty directory."}
                </EmptyStatePanel>
              )}
            </View>
          );
        case "search-state":
          return (
            <View className="px-4 py-4">
              {item.state === "loading" ? (
                <View className="flex-row items-center gap-2">
                  <Spinner size="small" />
                  <Text variant="caption">Searching…</Text>
                </View>
              ) : (
                <EmptyStatePanel>
                  {item.state === "error"
                    ? "File search failed."
                    : item.state === "unavailable"
                      ? "Nothing to search: the thread has no workspace or storage yet."
                      : item.state === "hint"
                        ? "Search the project's files by name."
                        : "No matching files."}
                </EmptyStatePanel>
              )}
            </View>
          );
      }
    },
    [directoryPath, openFile, openSource, presentCopyMenu, presentEntryMenu],
  );

  const List: ComponentType<FlatListProps<FilesTabRow>> =
    scroll === "sheet" ? SheetFlatList : FlatList;

  return (
    <View className="flex-1" testID={testID}>
      <View className="flex-row items-center gap-2 px-4 pb-2 pt-3">
        <View className="relative flex-1">
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder="Search files"
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            className="pl-9"
            testID="files-search-input"
          />
          <View
            pointerEvents="none"
            className="absolute inset-y-0 left-3 justify-center"
          >
            <Icon name="Search" size={16} color={tokens.mutedForeground} />
          </View>
          {query.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setQuery("")}
              className="absolute inset-y-0 right-2 justify-center"
              testID="files-search-clear"
            >
              <Icon name="CircleX" size={16} color={tokens.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <List
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: 24 }}
        testID="files-tab-list"
      />
      <ActionSheet
        controller={copyMenu}
        title={copyTarget?.name}
        actions={copyActions}
        stackBehavior="push"
      />
    </View>
  );
}
