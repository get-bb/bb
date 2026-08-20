import type { WorkspaceFile } from "@bb/server-contract";
import { useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";
import {
  buildStorageBreadcrumbs,
  listStorageDirectory,
  type StorageEntry,
} from "@/data/files";
import { useTheme } from "@/theme";
import { EmptyStatePanel, Icon, Skeleton, Text } from "@/ui";
import { FilePathRow } from "./FilePathRow";

export interface ThreadStorageBrowserProps {
  files: readonly WorkspaceFile[] | undefined;
  isLoading: boolean;
  error: unknown;
  /** "" = the storage root. */
  directoryPath: string;
  onNavigate: (directoryPath: string) => void;
  onOpenFile: (path: string) => void;
  onLongPressEntry?: (entry: StorageEntry) => void;
}

/** Breadcrumb strip: root › dir › dir, the last crumb current. */
export function StorageBreadcrumbs({
  directoryPath,
  onNavigate,
}: {
  directoryPath: string;
  onNavigate: (directoryPath: string) => void;
}) {
  const { tokens } = useTheme();
  const crumbs = buildStorageBreadcrumbs(directoryPath);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        alignItems: "center",
        paddingHorizontal: 16,
        gap: 2,
      }}
      testID="storage-breadcrumbs"
    >
      {crumbs.map((crumb, index) => {
        const current = index === crumbs.length - 1;
        return (
          <View key={crumb.path} className="flex-row items-center gap-1">
            {index > 0 ? (
              <Icon
                name="ChevronRight"
                size={14}
                color={tokens.mutedForeground}
              />
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={current}
              onPress={() => onNavigate(crumb.path)}
              className="rounded-sm px-1 py-1 active:bg-state-hover"
              testID={`storage-crumb-${index}`}
            >
              <Text
                variant="chrome"
                tone={current ? "foreground" : "primary"}
                numberOfLines={1}
              >
                {crumb.label}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

/**
 * One directory of the thread's storage at a time (dirs first, then files)
 * under a breadcrumb strip. The tree is derived client-side from the flat
 * `GET /threads/:id/thread-storage/files` list.
 */
export function ThreadStorageBrowser({
  files,
  isLoading,
  error,
  directoryPath,
  onNavigate,
  onOpenFile,
  onLongPressEntry,
}: ThreadStorageBrowserProps) {
  const entries = useMemo(
    () => (files ? listStorageDirectory(files, directoryPath) : []),
    [directoryPath, files],
  );
  return (
    <View testID="thread-storage-browser">
      <StorageBreadcrumbs
        directoryPath={directoryPath}
        onNavigate={onNavigate}
      />
      {isLoading && !files ? (
        <View className="gap-2 px-4 py-3" testID="thread-storage-loading">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-3/5" />
        </View>
      ) : error && !files ? (
        <View className="px-4 py-2">
          <EmptyStatePanel>
            <Text className="text-center text-sm text-muted-foreground">
              Could not load thread storage.
            </Text>
          </EmptyStatePanel>
        </View>
      ) : entries.length === 0 ? (
        <View className="px-4 py-2">
          <EmptyStatePanel>
            {directoryPath.length === 0
              ? "No files in thread storage yet."
              : "Empty directory."}
          </EmptyStatePanel>
        </View>
      ) : (
        entries.map((entry) =>
          entry.kind === "directory" ? (
            <FilePathRow
              key={`d:${entry.path}`}
              path={entry.name}
              icon="Folder"
              trailingText={`${entry.fileCount} ${entry.fileCount === 1 ? "file" : "files"}`}
              trailing="chevron"
              onPress={() => onNavigate(entry.path)}
              onLongPress={
                onLongPressEntry ? () => onLongPressEntry(entry) : undefined
              }
              testID="storage-directory-row"
            />
          ) : (
            <FilePathRow
              key={`f:${entry.path}`}
              path={entry.name}
              icon="FileText"
              onPress={() => onOpenFile(entry.path)}
              onLongPress={
                onLongPressEntry ? () => onLongPressEntry(entry) : undefined
              }
              testID="storage-file-row"
            />
          ),
        )
      )}
    </View>
  );
}
