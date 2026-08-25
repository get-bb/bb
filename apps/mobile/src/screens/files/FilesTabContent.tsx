import { useCallback, useMemo, useState, type ComponentType } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
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
import { haptic } from "@/lib/haptics";
import { nativeTypography, resolveFont, useTheme } from "@/theme";
import {
  ActionSheet,
  GROUPED_ROW_PADDING_X,
  Icon,
  INPUT_RADIUS,
  LIST_ROW_ICON_SIZE,
  Separator,
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

const IS_IOS = process.env.EXPO_OS === "ios";
/** The inline search field (UISearchBar's text field height). */
const SEARCH_FIELD_HEIGHT = 36;
/** Hairlines between file rows start at the text column (padding + glyph + gap). */
const FILE_ROW_SEPARATOR_INSET =
  GROUPED_ROW_PADDING_X + LIST_ROW_ICON_SIZE + 12;
const FILE_ROW_KINDS: ReadonlySet<FilesTabRow["kind"]> = new Set<
  FilesTabRow["kind"]
>(["search-result", "recent", "storage-entry"]);
/** The rows rendered as a `FilePathRow` (tap opens, long-press is the menu). */
type FileRow = Extract<
  FilesTabRow,
  { kind: "search-result" | "recent" | "storage-entry" }
>;

interface FileRowHandlers {
  onPress: () => void;
  onLongPress: () => void;
}

// Module-level so the list (a PureComponent) keeps its props stable across
// the host's re-renders (the menu sheet opening, a query tick).
const keyExtractor = (row: FilesTabRow) => row.key;
const LIST_CONTENT_STYLE = { paddingBottom: 24 } as const;

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
  /**
   * Where the query is typed: the inline search field (default), or a host
   * bar — the full-screen route's native header search on iOS — in which
   * case `externalQuery` is the live query and no field renders here.
   */
  searchField?: "inline" | "external";
  externalQuery?: string;
  testID?: string;
}

interface FileMenuTarget {
  path: string;
  name: string;
  kind: "file" | "directory";
  open: () => void;
}

function sourceLabel(source: FileSearchSource): string {
  return source === "workspace" ? "Workspace" : "Thread storage";
}

/** Open / Copy path / Copy name: the long-press sheet's rows. */
function fileMenuActions(target: FileMenuTarget): ActionSheetAction[] {
  return [
    {
      key: "open",
      label: target.kind === "directory" ? "Open folder" : "Open",
      icon: target.kind === "directory" ? "FolderOpen" : "FileText",
      onPress: target.open,
    },
    {
      key: "copy-path",
      label: "Copy path",
      icon: "Copy",
      onPress: () => copyWithToast(target.path, "Path copied"),
    },
    {
      key: "copy-name",
      label: "Copy name",
      icon: "Copy",
      onPress: () => copyWithToast(target.name, "Name copied"),
    },
  ];
}

/** Hairline under a file row; section headers and states draw none. */
function FileRowSeparator({ leadingItem }: { leadingItem: FilesTabRow }) {
  return FILE_ROW_KINDS.has(leadingItem.kind) ? (
    <Separator inset={FILE_ROW_SEPARATOR_INSET} />
  ) : null;
}

/** The iOS search field: 36pt, muted fill, continuous corners, magnifier + clear glyphs. */
function SearchField({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (text: string) => void;
}) {
  const { tokens, mode } = useTheme();
  return (
    <View style={[styles.searchField, { backgroundColor: tokens.muted }]}>
      <Icon name="Search" size={17} color={tokens.mutedForeground} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="Search files"
        placeholderTextColor={tokens.subtleForeground}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        clearButtonMode="never"
        keyboardAppearance={mode}
        selectionColor={tokens.primary}
        cursorColor={tokens.primary}
        accessibilityLabel="Search files"
        style={[
          styles.searchInput,
          resolveFont({}),
          { color: tokens.foreground },
        ]}
        testID="files-search-input"
      />
      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={8}
          onPress={() => onChangeText("")}
          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
          testID="files-search-clear"
        >
          <Icon
            name="CircleX"
            symbol="xmark.circle.fill"
            size={17}
            color={tokens.subtleForeground}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

function StateText({ children }: { children: string }) {
  return (
    <Text variant="footnote" tone="muted" className="text-center">
      {children}
    </Text>
  );
}

/**
 * The Files tab: a search field over the workspace (environment or project
 * paths) and thread storage, and — when idle — the thread's recent files
 * plus a storage browser with breadcrumbs. Tapping a file opens the preview;
 * long-press is the open / copy menu — one action sheet shared by every row
 * (a native context menu per row would host a SwiftUI view in each list
 * cell).
 */
export function FilesTabContent({
  threadId,
  projectId,
  environmentId,
  hostId,
  scroll = "screen",
  initialQuery = null,
  searchField = "inline",
  externalQuery = "",
  testID = "files-tab",
}: FilesTabContentProps) {
  const [inlineQuery, setInlineQuery] = useState(initialQuery ?? "");
  const query = searchField === "external" ? externalQuery : inlineQuery;
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

  // The long-press menu: one sheet for the whole list, re-targeted per row.
  const menuSheet = useSheet();
  const [menuTarget, setMenuTarget] = useState<FileMenuTarget | null>(null);
  const presentMenu = useCallback(
    (target: FileMenuTarget) => {
      haptic("impact-heavy");
      setMenuTarget(target);
      menuSheet.present();
    },
    [menuSheet],
  );
  const storageEntryTarget = useCallback(
    (entry: StorageEntry): FileMenuTarget => ({
      path: entry.path,
      name: entry.name,
      kind: entry.kind === "directory" ? "directory" : "file",
      open:
        entry.kind === "directory"
          ? () => setDirectoryPath(entry.path)
          : () =>
              openFile({
                target: { kind: "storage-file", path: entry.path },
                lineRange: null,
              }),
    }),
    [openFile],
  );
  const buildRowHandlers = useCallback(
    (row: FileRow): FileRowHandlers => {
      const target: FileMenuTarget =
        row.kind === "search-result"
          ? {
              path: row.path,
              name: getFileName(row.path),
              kind: "file",
              open: () => openSource(row.source, row.path),
            }
          : row.kind === "recent"
            ? {
                path: row.item.path,
                name: getFileName(row.item.path),
                kind: "file",
                open: () => openSource(row.item.source, row.item.path),
              }
            : storageEntryTarget(row.entry);
      return { onPress: target.open, onLongPress: () => presentMenu(target) };
    },
    [openSource, presentMenu, storageEntryTarget],
  );
  // One handler pair per row, keyed by row key and memoized on the row list,
  // so `memo(FilePathRow)` holds across renders that leave the rows alone.
  const rowHandlers = useMemo(() => {
    const handlers = new Map<string, FileRowHandlers>();
    for (const row of rows) {
      if (
        row.kind === "search-result" ||
        row.kind === "recent" ||
        row.kind === "storage-entry"
      ) {
        handlers.set(row.key, buildRowHandlers(row));
      }
    }
    return handlers;
  }, [buildRowHandlers, rows]);
  const handlersFor = useCallback(
    (row: FileRow): FileRowHandlers =>
      rowHandlers.get(row.key) ?? buildRowHandlers(row),
    [buildRowHandlers, rowHandlers],
  );

  const renderItem = useCallback<ListRenderItem<FilesTabRow>>(
    ({ item }) => {
      switch (item.kind) {
        case "section":
          return (
            <View className="flex-row items-baseline justify-between px-4 pb-1.5 pt-5">
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
              {...handlersFor(item)}
              testID="files-search-result"
            />
          );
        case "recent":
          return (
            <FilePathRow
              path={item.item.path}
              icon="Clock"
              trailingText={sourceLabel(item.item.source)}
              {...handlersFor(item)}
              testID="files-recent-row"
            />
          );
        case "recent-toggle":
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() => setRecentExpanded((current) => !current)}
              className="px-4 py-2 active:opacity-60"
              testID="files-recent-toggle"
            >
              <Text variant="footnote" tone="primary">
                {item.expanded ? "Show fewer" : `Show ${item.hidden} more`}
              </Text>
            </Pressable>
          );
        case "storage-breadcrumbs":
          return (
            <StorageBreadcrumbs
              directoryPath={item.directoryPath}
              onNavigate={setDirectoryPath}
            />
          );
        case "storage-entry":
          if (item.entry.kind === "directory") {
            return (
              <FilePathRow
                path={item.entry.name}
                icon="Folder"
                trailingText={`${item.entry.fileCount} ${item.entry.fileCount === 1 ? "file" : "files"}`}
                trailing="chevron"
                {...handlersFor(item)}
                testID="storage-directory-row"
              />
            );
          }
          return (
            <FilePathRow
              path={item.entry.name}
              icon="FileText"
              {...handlersFor(item)}
              testID="storage-file-row"
            />
          );
        case "storage-state":
          return (
            <View className="px-4 py-4">
              {item.state === "loading" ? (
                <View className="gap-2 py-1" testID="thread-storage-loading">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                </View>
              ) : (
                <StateText>
                  {item.state === "error"
                    ? "Could not load thread storage."
                    : directoryPath.length === 0
                      ? "No files in thread storage yet."
                      : "Empty directory."}
                </StateText>
              )}
            </View>
          );
        case "search-state":
          return (
            <View className="px-4 py-6">
              {item.state === "loading" ? (
                <View className="flex-row items-center justify-center gap-2">
                  <Spinner size="small" />
                  <Text variant="footnote" tone="muted">
                    Searching…
                  </Text>
                </View>
              ) : (
                <StateText>
                  {item.state === "error"
                    ? "File search failed."
                    : item.state === "unavailable"
                      ? "Nothing to search: the thread has no workspace or storage yet."
                      : item.state === "hint"
                        ? "Search the project's files by name."
                        : "No matching files."}
                </StateText>
              )}
            </View>
          );
      }
    },
    [directoryPath, handlersFor],
  );

  const List: ComponentType<FlatListProps<FilesTabRow>> =
    scroll === "sheet" ? SheetFlatList : FlatList;

  return (
    <View className="flex-1" testID={testID}>
      {searchField === "inline" ? (
        <View className="px-4 pb-2 pt-2">
          <SearchField value={inlineQuery} onChangeText={setInlineQuery} />
        </View>
      ) : null}
      <List
        data={rows}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ItemSeparatorComponent={FileRowSeparator}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={IS_IOS ? "interactive" : "on-drag"}
        // The full-screen route's first scrollable: inset under the native
        // header (and its search bar) automatically.
        contentInsetAdjustmentBehavior={
          scroll === "screen" ? "automatic" : undefined
        }
        contentContainerStyle={LIST_CONTENT_STYLE}
        testID="files-tab-list"
      />
      <ActionSheet
        controller={menuSheet}
        title={menuTarget?.name}
        actions={menuTarget === null ? [] : fileMenuActions(menuTarget)}
        stackBehavior="push"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  searchField: {
    height: SEARCH_FIELD_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    borderRadius: INPUT_RADIUS,
    borderCurve: "continuous",
  },
  searchInput: {
    flex: 1,
    height: SEARCH_FIELD_HEIGHT,
    paddingVertical: 0,
    fontSize: nativeTypography.base.fontSize,
  },
});
