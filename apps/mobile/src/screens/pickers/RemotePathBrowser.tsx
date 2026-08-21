import { normalizeProjectPathInput } from "@bb/domain";
import { BbHttpError } from "@bb/sdk/browser";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useProfileClient } from "@/app-shell";
import { useHostDirectory } from "@/data/hosts";
import { hostDirectoryQueryKey } from "@/lib/query/query-keys";
import { useTheme } from "@/theme";
import {
  Button,
  cn,
  Icon,
  Input,
  ListRow,
  Sheet,
  Spinner,
  Text,
  type InputProps,
  type SheetController,
} from "@/ui";
import { usePickerSheetMaxHeight } from "./OptionSheet";
import {
  getFolderNameValidationMessage,
  joinHostPath,
  toBreadcrumb,
} from "./remote-path";
import { SheetInput } from "./SheetInput";

function BrowserTextField({
  inSheet,
  ...props
}: InputProps & { inSheet: boolean }) {
  return inSheet ? <SheetInput {...props} /> : <Input {...props} />;
}

export function describeRequestError(error: unknown, fallback: string): string {
  if (error instanceof BbHttpError) return error.message || fallback;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export interface RemotePathBrowserProps {
  hostId: string;
  /** Directory to open at; null starts at the host's home directory. */
  initialPath?: string | null;
  /** Whether this picker may create and select a new child directory. */
  allowCreateFolder?: boolean;
  /**
   * Reports the resolved directory currently shown (the folder that would be
   * picked). Null while the first listing loads or a manual path fails.
   */
  onDirectoryChange: (directory: string | null) => void;
  disabled?: boolean;
  /** Inside a `Sheet` the text fields must be sheet-aware. */
  inSheet?: boolean;
  testID?: string;
}

/**
 * Single-level directory browser over `GET /hosts/:id/directory` (mirrors
 * apps/app RemotePathBrowser): breadcrumb, up, manual path entry, folder
 * rows, optional new folder via `files/mkdir`. Files are listed muted and
 * inert so the user can recognise the folder.
 */
export function RemotePathBrowser({
  hostId,
  initialPath = null,
  allowCreateFolder = false,
  onDirectoryChange,
  disabled = false,
  inSheet = false,
  testID = "remote-path-browser",
}: RemotePathBrowserProps) {
  const { sdk } = useProfileClient();
  const { tokens } = useTheme();
  const queryClient = useQueryClient();
  const [currentPath, setCurrentPath] = useState<string | null>(initialPath);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderError, setNewFolderError] = useState<string | null>(null);
  const { data, isError, error, isPlaceholderData } = useHostDirectory(
    hostId,
    currentPath,
  );
  const directory = data?.directory ?? null;
  const crumbs = directory ? toBreadcrumb(directory) : [];

  useEffect(() => {
    onDirectoryChange(directory);
  }, [directory, onDirectoryChange]);

  const cancelCreatingFolder = () => {
    setIsCreatingFolder(false);
    setNewFolderError(null);
  };
  const navigateTo = (path: string) => {
    cancelCreatingFolder();
    setIsEditing(false);
    setCurrentPath(path);
  };

  const createFolder = useMutation({
    meta: { showErrorToast: false },
    mutationFn: async ({ parent, name }: { parent: string; name: string }) => {
      const path = joinHostPath(parent, name);
      await sdk.files.mkdir({ hostId, path });
      return path;
    },
    onSuccess: async (path, { parent }) => {
      setNewFolderName("");
      navigateTo(path);
      await queryClient.invalidateQueries({
        queryKey: hostDirectoryQueryKey(hostId, parent),
      });
    },
    onError: (mutationError) => {
      setNewFolderError(
        describeRequestError(mutationError, "Couldn't create that folder."),
      );
    },
  });

  const interactionDisabled = disabled || createFolder.isPending;
  const canCreateFolderHere =
    allowCreateFolder &&
    !interactionDisabled &&
    directory !== null &&
    !isError &&
    !isPlaceholderData;

  const commitEditor = () => {
    const normalized = normalizeProjectPathInput(editValue);
    setIsEditing(false);
    if (normalized) navigateTo(normalized);
  };
  const commitNewFolder = () => {
    if (!canCreateFolderHere || directory === null) return;
    const name = newFolderName.trim();
    const message = getFolderNameValidationMessage(name);
    if (message) {
      setNewFolderError(message);
      return;
    }
    setNewFolderError(null);
    createFolder.mutate({ parent: directory, name });
  };

  let body: ReactNode;
  if (isError) {
    body = (
      <View className="flex-row items-start gap-2 px-3 py-4">
        <Icon name="AlertCircle" size={16} color={tokens.destructiveText} />
        <Text variant="caption" tone="destructive" className="flex-1">
          {describeRequestError(error, "Couldn't read this folder.")}
        </Text>
      </View>
    );
  } else if (!data) {
    body = (
      <View className="flex-row items-center gap-2 px-3 py-4">
        <Spinner />
        <Text variant="caption">Loading…</Text>
      </View>
    );
  } else if (data.entries.length === 0) {
    body = (
      <View className="px-3 py-4">
        <Text variant="caption">This folder is empty.</Text>
      </View>
    );
  } else {
    body = data.entries.map((entry) =>
      entry.kind === "file" ? (
        <View
          key={entry.path}
          className="min-h-[36px] flex-row items-center gap-3 px-3 py-1"
        >
          <Icon name="File" size={16} color={tokens.subtleForeground} />
          <Text variant="caption" numberOfLines={1} className="flex-1">
            {entry.name}
          </Text>
        </View>
      ) : (
        <ListRow
          key={entry.path}
          title={entry.name}
          leading={
            <Icon name="Folder" size={18} color={tokens.mutedForeground} />
          }
          trailing="chevron"
          disabled={interactionDisabled}
          onPress={() => navigateTo(entry.path)}
          className="min-h-[40px] px-3 py-1"
          testID={`${testID}-dir-${entry.name}`}
        />
      ),
    );
  }

  return (
    <View
      className="overflow-hidden rounded-md border border-border"
      testID={testID}
    >
      <View className="flex-row items-center gap-1 border-b border-border px-1.5 py-1">
        {isEditing ? (
          <>
            <BrowserTextField
              inSheet={inSheet}
              value={editValue}
              onChangeText={setEditValue}
              placeholder="/path/to/folder"
              autoCapitalize="none"
              mono
              className="h-9 flex-1 text-sm"
              editable={!disabled}
              autoFocus
              returnKeyType="go"
              onSubmitEditing={commitEditor}
              accessibilityLabel="Folder path"
              testID={`${testID}-path-input`}
            />
            <Button
              variant="ghost"
              size="icon"
              icon="Check"
              accessibilityLabel="Go to path"
              disabled={disabled}
              onPress={commitEditor}
              className="h-9 w-9"
              testID={`${testID}-path-go`}
            />
            <Button
              variant="ghost"
              size="icon"
              icon="X"
              accessibilityLabel="Cancel editing path"
              disabled={disabled}
              onPress={() => setIsEditing(false)}
              className="h-9 w-9"
            />
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon"
              icon="ArrowUp"
              accessibilityLabel="Go to parent folder"
              disabled={interactionDisabled || !data?.parent}
              onPress={() => {
                if (data?.parent) navigateTo(data.parent);
              }}
              className="h-9 w-9"
              testID={`${testID}-up`}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="min-w-0 flex-1"
              contentContainerStyle={{ alignItems: "center" }}
              keyboardShouldPersistTaps="handled"
            >
              {crumbs.map((crumb, index) => (
                <View key={crumb.path} className="flex-row items-center">
                  {index > 0 ? (
                    <Icon
                      name="ChevronRight"
                      size={12}
                      color={tokens.subtleForeground}
                    />
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    disabled={interactionDisabled}
                    onPress={() => navigateTo(crumb.path)}
                    className="rounded px-1 py-1 active:bg-state-hover"
                  >
                    <Text
                      variant="caption"
                      className={cn(
                        index === crumbs.length - 1 &&
                          "font-medium text-foreground",
                      )}
                    >
                      {crumb.label}
                    </Text>
                  </Pressable>
                </View>
              ))}
              {crumbs.length === 0 && directory === null ? (
                <Text variant="caption" className="px-1">
                  {isError ? "Unreadable path" : "Home"}
                </Text>
              ) : null}
            </ScrollView>
            {allowCreateFolder ? (
              <Button
                variant="ghost"
                size="icon"
                icon="FolderPlus"
                accessibilityLabel="New folder"
                disabled={!canCreateFolderHere}
                onPress={() => {
                  setNewFolderName("");
                  setNewFolderError(null);
                  setIsCreatingFolder(true);
                }}
                className="h-9 w-9"
                testID={`${testID}-new-folder`}
              />
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              icon="Edit"
              accessibilityLabel="Edit path"
              disabled={interactionDisabled}
              onPress={() => {
                cancelCreatingFolder();
                setEditValue(directory ?? "");
                setIsEditing(true);
              }}
              className="h-9 w-9"
              testID={`${testID}-edit`}
            />
          </>
        )}
      </View>
      {isCreatingFolder ? (
        <View className="gap-1 border-b border-border px-3 py-2">
          <View className="flex-row items-center gap-2">
            <Icon name="Folder" size={16} color={tokens.mutedForeground} />
            <BrowserTextField
              inSheet={inSheet}
              value={newFolderName}
              onChangeText={(next) => {
                setNewFolderName(next);
                setNewFolderError(null);
              }}
              placeholder="Folder name"
              autoCapitalize="none"
              className="h-9 flex-1 text-sm"
              editable={!interactionDisabled}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={commitNewFolder}
              accessibilityLabel="New folder name"
              testID={`${testID}-new-folder-name`}
            />
            <Button
              variant="ghost"
              size="icon"
              icon="Check"
              loading={createFolder.isPending}
              accessibilityLabel="Create folder"
              disabled={interactionDisabled}
              onPress={commitNewFolder}
              className="h-9 w-9"
              testID={`${testID}-new-folder-create`}
            />
            <Button
              variant="ghost"
              size="icon"
              icon="X"
              accessibilityLabel="Cancel new folder"
              disabled={interactionDisabled}
              onPress={cancelCreatingFolder}
              className="h-9 w-9"
            />
          </View>
          {newFolderError ? (
            <Text variant="caption" tone="destructive">
              {newFolderError}
            </Text>
          ) : null}
        </View>
      ) : null}
      {inSheet ? (
        // Inside a sheet the sheet itself scrolls (nested scroll views fight
        // the sheet's pan gesture), so the list renders in full.
        <View className={cn(isPlaceholderData && "opacity-60")}>{body}</View>
      ) : (
        <ScrollView
          style={{ height: 260 }}
          className={cn(isPlaceholderData && "opacity-60")}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {body}
        </ScrollView>
      )}
    </View>
  );
}

interface RemotePathBrowserSheetProps {
  controller: SheetController;
  hostId: string | null;
  hostName?: string | null;
  title?: string;
  initialPath?: string | null;
  allowCreateFolder?: boolean;
  /** Fires with the resolved directory when the user confirms. */
  onSelect: (path: string) => void;
  testID?: string;
}

/**
 * The browser inside a sheet with a confirm button. Callers keep the
 * controller from `useSheet()`; the sheet resets its browsing state each
 * time it presents (keyed on the host + initial path).
 */
export function RemotePathBrowserSheet({
  controller,
  hostId,
  hostName = null,
  title = "Choose a folder",
  initialPath = null,
  allowCreateFolder = false,
  onSelect,
  testID = "remote-path-sheet",
}: RemotePathBrowserSheetProps) {
  const [directory, setDirectory] = useState<string | null>(null);
  const [presentCount, setPresentCount] = useState(0);
  const maxHeight = usePickerSheetMaxHeight();
  return (
    <Sheet
      controller={controller}
      title={title}
      layout="scroll"
      maxDynamicContentSize={maxHeight}
      onOpenChange={(open) => {
        if (open) setPresentCount((count) => count + 1);
      }}
    >
      <View className="gap-3 px-4 pb-2 pt-3">
        <Text variant="caption">
          {`Browse${hostName ? ` ${hostName}'s` : ""} folders, or edit the path directly.`}
        </Text>
        <View className="flex-row items-center gap-2">
          <Text variant="mono" numberOfLines={2} className="flex-1 text-xs">
            {directory ?? "…"}
          </Text>
          <Button
            size="sm"
            disabled={directory === null || hostId === null}
            onPress={() => {
              if (directory === null) return;
              controller.dismiss();
              onSelect(directory);
            }}
            testID={`${testID}-confirm`}
          >
            Use this folder
          </Button>
        </View>
        {hostId === null ? (
          <Text variant="caption" tone="destructive">
            No machine is available to browse.
          </Text>
        ) : (
          <RemotePathBrowser
            key={`${hostId}:${initialPath ?? ""}:${presentCount}`}
            hostId={hostId}
            initialPath={initialPath}
            allowCreateFolder={allowCreateFolder}
            onDirectoryChange={setDirectory}
            inSheet
            testID={`${testID}-browser`}
          />
        )}
      </View>
    </Sheet>
  );
}
