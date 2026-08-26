import type { FilePreviewLineRange } from "@bb/client-core";
import { SegmentedControl } from "@expo/ui/community/segmented-control";
import { Stack } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import {
  buildFileLineSelectionText,
  formatFileLineReference,
  formatFileSize,
  getFileName,
  resolveFilePreviewContent,
  resolveThreadComposerHost,
  useProjectFilePreview,
  useThreadHostFilePreview,
  useThreadStorageFilePreview,
  useWorkspaceFilePreview,
  type FilePreviewContent,
} from "@/data/files";
import { copyWithToast } from "@/lib/clipboard";
import { haptic } from "@/lib/haptics";
import { useTheme } from "@/theme";
import {
  ActionSheet,
  Button,
  Icon,
  Sheet,
  SheetTextInput,
  Text,
  toast,
  useInputFieldProps,
  useSheet,
  type ActionSheetAction,
} from "@/ui";
import { CsvFilePreviewBody } from "./CsvFilePreviewBody";
import { useThreadFileOpener } from "./file-opener";
import {
  describeFilePreviewTargetSource,
  type FilePreviewTarget,
} from "./file-preview-target";
import {
  buildFileTargetExternalUrl,
  buildFileTargetHtmlUrl,
  type FileTargetUrlContext,
} from "./file-preview-urls";
import { FilePreviewLoading, FilePreviewMessage } from "./FilePreviewStates";
import { HtmlFilePreviewBody } from "./HtmlFilePreviewBody";
import { MarkdownFilePreviewBody } from "./MarkdownFilePreviewBody";
import {
  ImageFilePreviewBody,
  VideoFilePreviewBody,
} from "./MediaFilePreviewBodies";
import {
  TextFilePreviewBody,
  type TextFilePreviewBodyHandle,
} from "./TextFilePreviewBody";
import { useThreadLocalFileLinks } from "./use-thread-local-file-links";

const IS_IOS = process.env.EXPO_OS === "ios";

interface FilePreviewViewProps {
  /** Null for the root-compose panel (project files only). */
  threadId: string | null;
  projectId: string | null;
  /** The thread's environment (workspace reads, host-file routing). */
  environmentId: string | null;
  hostId: string | null;
  /** The environment's checkout path, for local-file links inside markdown. */
  workspaceRootPath: string | null;
  target: FilePreviewTarget;
  /** Highlighted + scrolled to on open. */
  lineRange: FilePreviewLineRange | null;
  /** After a successful quote (a panel tab closes the panel so the composer shows). */
  onAddedToChat?: () => void;
  /** Rendered inside the workspace panel sheet: the markdown body uses the sheet-aware scroller. */
  inSheet?: boolean;
  /**
   * Who owns the chrome. `"inline"` (default) draws the name, path and
   * actions in the body (the panel tab; Android). `"header"` — the iOS
   * full-screen route — puts the actions in the navigation toolbar and
   * keeps only the path line (plus the Preview / Source control) in the
   * body; the route sets the file name as the navigation title.
   */
  chrome?: "inline" | "header";
  testID?: string;
}

type ViewMode = "preview" | "source";

function initialViewMode(lineRange: FilePreviewLineRange | null): ViewMode {
  return lineRange === null ? "preview" : "source";
}

/** Preview / Source: the native segmented control on iOS, the pill toggle elsewhere. */
function ViewModeToggle({
  viewMode,
  onChange,
  style,
}: {
  viewMode: ViewMode;
  onChange: (mode: ViewMode) => void;
  /** iOS only: the segmented control's frame in its row. */
  style?: StyleProp<ViewStyle>;
}) {
  if (IS_IOS) {
    return (
      <SegmentedControl
        values={["Preview", "Source"]}
        selectedIndex={viewMode === "preview" ? 0 : 1}
        onChange={(event) => {
          haptic("selection");
          onChange(
            event.nativeEvent.selectedSegmentIndex === 1 ? "source" : "preview",
          );
        }}
        style={style}
        testID="file-preview-mode"
      />
    );
  }
  return (
    <View className="flex-row self-start overflow-hidden rounded-md border border-border">
      {(["preview", "source"] as const).map((mode) => (
        <Pressable
          key={mode}
          accessibilityRole="button"
          accessibilityState={{ selected: viewMode === mode }}
          onPress={() => onChange(mode)}
          className={
            viewMode === mode
              ? "bg-surface-selected px-2.5 py-1"
              : "px-2.5 py-1 active:bg-state-hover"
          }
          testID={`file-preview-mode-${mode}`}
        >
          <Text
            variant="chrome"
            tone={viewMode === mode ? "foreground" : "muted"}
          >
            {mode === "preview" ? "Preview" : "Source"}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * The file preview (full-screen route body and panel tab body): a compact
 * header (name, source, size, tappable path, Preview / Source, jump to
 * line, open in browser, reload — or, with `chrome="header"`, the native
 * toolbar and a single path line) over a body per content kind —
 * code with line numbers, markdown, CSV grid, HTML in a WebView, image,
 * video hand-off, and the loading / not-found / too-large / error / empty /
 * binary states.
 */
export function FilePreviewView({
  threadId,
  projectId,
  environmentId,
  hostId,
  workspaceRootPath,
  target,
  lineRange,
  onAddedToChat,
  inSheet = false,
  chrome = "inline",
  testID = "file-preview",
}: FilePreviewViewProps) {
  const { tokens } = useTheme();
  const { serverUrl } = useProfileClient();
  const openFile = useThreadFileOpener(threadId);
  const localLinks = useThreadLocalFileLinks({
    threadId,
    environmentId,
    workspaceRootPath,
    onOpenFile: openFile,
  });

  const workspaceQuery = useWorkspaceFilePreview(
    environmentId,
    target.kind === "workspace-file" ? target.path : null,
    target.kind === "workspace-file" ? target.source : null,
    { enabled: target.kind === "workspace-file" },
  );
  const hostQuery = useThreadHostFilePreview(
    threadId,
    target.kind === "host-file" ? target.path : null,
    { enabled: target.kind === "host-file" },
  );
  const storageQuery = useThreadStorageFilePreview(
    threadId,
    target.kind === "storage-file" ? target.path : null,
    { enabled: target.kind === "storage-file" },
  );
  const projectQuery = useProjectFilePreview(
    projectId,
    target.kind === "project-file" ? target.path : null,
    { environmentId, hostId },
    { enabled: target.kind === "project-file" },
  );
  const query =
    target.kind === "workspace-file"
      ? workspaceQuery
      : target.kind === "host-file"
        ? hostQuery
        : target.kind === "storage-file"
          ? storageQuery
          : projectQuery;

  const urlContext = useMemo<FileTargetUrlContext>(
    () => ({ serverUrl, threadId, projectId, environmentId, hostId }),
    [environmentId, hostId, projectId, serverUrl, threadId],
  );
  const externalUrl = buildFileTargetExternalUrl(urlContext, target);
  const htmlUrl = buildFileTargetHtmlUrl(urlContext, target);
  const content = useMemo<FilePreviewContent>(
    () =>
      resolveFilePreviewContent({
        activePath: target.path,
        preview: query.data,
        error: query.error,
        isLoading: query.isLoading,
        htmlRawUrl: htmlUrl,
      }),
    [htmlUrl, query.data, query.error, query.isLoading, target.path],
  );

  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    initialViewMode(lineRange),
  );
  const hasSourceToggle =
    (content.kind === "text" && content.textKind !== "code") ||
    (content.kind === "html" && content.content !== null);
  const showingSource = hasSourceToggle && viewMode === "source";
  const sourceText =
    content.kind === "text"
      ? content.content
      : content.kind === "html"
        ? content.content
        : null;
  const showsLines =
    (content.kind === "text" && content.textKind === "code") || showingSource;

  const name = getFileName(target.path);
  const sizeLabel =
    query.data !== undefined ? formatFileSize(query.data.sizeBytes) : null;
  const openExternally = useCallback(() => {
    if (externalUrl === null) return;
    Linking.openURL(externalUrl).catch(() =>
      toast.error("Could not open in the browser"),
    );
  }, [externalUrl]);
  const copyPath = useCallback(
    () => copyWithToast(target.path, "Path copied"),
    [target.path],
  );
  const reload = useCallback(() => void query.refetch(), [query]);

  // Jump to line.
  const textBodyRef = useRef<TextFilePreviewBodyHandle>(null);
  const jumpSheet = useSheet();
  const [jumpValue, setJumpValue] = useState("");
  const jumpField = useInputFieldProps({ className: IS_IOS ? "h-11" : "h-10" });
  const goToLine = useCallback(
    (raw: string) => {
      const line = Number.parseInt(raw.trim(), 10);
      if (!Number.isFinite(line) || line <= 0) return;
      if (!showsLines) setViewMode("source");
      // Let a mode switch mount the line list before scrolling.
      setTimeout(() => textBodyRef.current?.scrollToLine(line), 50);
    },
    [showsLines],
  );
  const jumpToLine = useCallback(() => {
    jumpSheet.dismiss();
    goToLine(jumpValue);
  }, [goToLine, jumpSheet, jumpValue]);
  const promptJumpToLine = useCallback(() => {
    if (process.env.EXPO_OS === "ios" && chrome === "header") {
      // The full-screen route asks through the system text-field alert;
      // the panel keeps its sheet-stacked field (the sheet owns the keyboard).
      Alert.prompt(
        "Jump to line",
        undefined,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Go", onPress: (value?: string) => goToLine(value ?? "") },
        ],
        "plain-text",
        "",
        "number-pad",
      );
      return;
    }
    setJumpValue("");
    jumpSheet.present();
  }, [chrome, goToLine, jumpSheet]);

  // Long-pressed line → actions.
  const lineMenu = useSheet();
  const [menuLine, setMenuLine] = useState<number | null>(null);
  const onLongPressLine = useCallback(
    (lineNumber: number) => {
      setMenuLine(lineNumber);
      lineMenu.present();
    },
    [lineMenu],
  );
  const addToChat = useCallback(
    (text: string, reference: string) => {
      const host =
        threadId === null ? null : resolveThreadComposerHost(threadId);
      if (host) {
        host.quote(text);
        toast.success("Added to chat");
        onAddedToChat?.();
        return;
      }
      copyWithToast(reference, "Reference copied");
    },
    [onAddedToChat, threadId],
  );
  const lineActions = useMemo<ActionSheetAction[]>(() => {
    if (menuLine === null || sourceText === null) return [];
    const range = { startLineNumber: menuLine, endLineNumber: menuLine };
    const reference = formatFileLineReference(target.path, range);
    const selection = buildFileLineSelectionText({
      contents: sourceText,
      path: target.path,
      range,
    });
    const lineText = sourceText.split(/\r\n|\n|\r/u)[menuLine - 1] ?? "";
    return [
      {
        key: "add-to-chat",
        label: "Add to chat",
        icon: "MessageSquarePlus",
        disabled: selection === null,
        onPress: () => {
          if (selection !== null) addToChat(selection, reference);
        },
      },
      {
        key: "copy-line",
        label: "Copy line",
        icon: "Copy",
        onPress: () => copyWithToast(lineText, "Line copied"),
      },
      {
        key: "copy-reference",
        label: `Copy ${reference.length > 40 ? "path:line" : reference}`,
        icon: "Copy",
        onPress: () => copyWithToast(reference, "Reference copied"),
      },
    ];
  }, [addToChat, menuLine, sourceText, target.path]);

  let body: React.ReactNode;
  switch (content.kind) {
    case "loading":
      body = <FilePreviewLoading />;
      break;
    case "not-found":
      body = (
        <FilePreviewMessage
          title="File not found."
          detail={target.path}
          onRetry={reload}
          testID="file-preview-not-found"
        />
      );
      break;
    case "too-large":
      body = (
        <FilePreviewMessage
          title={content.message}
          detail={sizeLabel ?? undefined}
          onOpenExternally={externalUrl === null ? undefined : openExternally}
          testID="file-preview-too-large"
        />
      );
      break;
    case "error":
      body = (
        <FilePreviewMessage
          title="Could not load this file."
          detail={content.message}
          onRetry={reload}
          testID="file-preview-error"
        />
      );
      break;
    case "empty":
      body = (
        <FilePreviewMessage
          title="This file is empty."
          testID="file-preview-empty"
        />
      );
      break;
    case "unsupported":
      body = (
        <FilePreviewMessage
          title="Binary file — no preview."
          detail={`${content.mimeType}${sizeLabel ? ` · ${sizeLabel}` : ""}`}
          onOpenExternally={externalUrl === null ? undefined : openExternally}
          testID="file-preview-binary"
        />
      );
      break;
    case "image":
      body = (
        <ImageFilePreviewBody
          url={content.url}
          name={name}
          testID="file-preview-image-body"
        />
      );
      break;
    case "video":
      body = (
        <VideoFilePreviewBody
          mimeType={content.mimeType}
          externalUrl={externalUrl}
          onOpenExternally={openExternally}
          testID="file-preview-video-body"
        />
      );
      break;
    case "html":
      body =
        showingSource && content.content !== null ? (
          <TextFilePreviewBody
            ref={textBodyRef}
            content={content.content}
            lineRange={lineRange}
            onLongPressLine={onLongPressLine}
            testID="file-preview-text-body"
          />
        ) : (
          <HtmlFilePreviewBody
            rawUrl={content.rawUrl}
            onOpenExternally={openExternally}
            testID="file-preview-html-body"
          />
        );
      break;
    case "text":
      body =
        content.textKind === "markdown" && !showingSource ? (
          <MarkdownFilePreviewBody
            content={content.content}
            target={target}
            urlContext={urlContext}
            onOpenLocalFileLink={localLinks.openLocalFileLink}
            onOpenFile={openFile}
            inSheet={inSheet}
            testID="file-preview-markdown-body"
          />
        ) : content.textKind === "csv" && !showingSource ? (
          <CsvFilePreviewBody
            content={content.content}
            testID="file-preview-csv-body"
          />
        ) : (
          <TextFilePreviewBody
            ref={textBodyRef}
            content={content.content}
            lineRange={lineRange}
            onLongPressLine={onLongPressLine}
            testID="file-preview-text-body"
          />
        );
      break;
  }

  const headerStyle = [
    styles.header,
    { borderBottomColor: tokens.borderHairline },
  ];
  const sizeText = sizeLabel ? (
    <Text variant="footnote" tone="subtle" numeric testID="file-preview-size">
      {sizeLabel}
    </Text>
  ) : null;

  return (
    <View className="flex-1 bg-background" testID={testID}>
      {chrome === "header" ? (
        <>
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button
              icon="arrow.clockwise"
              accessibilityLabel="Reload"
              disabled={query.isFetching}
              onPress={reload}
            />
            <Stack.Toolbar.Menu
              icon="ellipsis.circle"
              accessibilityLabel="File actions"
            >
              {externalUrl !== null ? (
                <Stack.Toolbar.MenuAction
                  icon="safari"
                  onPress={openExternally}
                >
                  Open in browser
                </Stack.Toolbar.MenuAction>
              ) : null}
              <Stack.Toolbar.MenuAction icon="doc.on.doc" onPress={copyPath}>
                Copy path
              </Stack.Toolbar.MenuAction>
              {sourceText !== null ? (
                <Stack.Toolbar.MenuAction
                  icon="list.number"
                  onPress={promptJumpToLine}
                >
                  Jump to line…
                </Stack.Toolbar.MenuAction>
              ) : null}
            </Stack.Toolbar.Menu>
          </Stack.Toolbar>
          <View style={headerStyle}>
            <View className="flex-row items-center gap-3">
              <Text
                variant="footnote"
                tone="muted"
                mono
                selectable
                numberOfLines={1}
                className="min-w-0 flex-1"
                testID="file-preview-path"
              >
                {target.path}
              </Text>
              {sizeText}
            </View>
            {hasSourceToggle ? (
              <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
            ) : null}
          </View>
        </>
      ) : (
        <View style={headerStyle}>
          <View className="flex-row items-center gap-2">
            <Icon name="FileText" size={18} color={tokens.mutedForeground} />
            <Text
              variant="headline"
              className="min-w-0 flex-1"
              numberOfLines={1}
              testID="file-preview-name"
            >
              {name}
            </Text>
            <Text variant="footnote" tone="muted">
              {describeFilePreviewTargetSource(target)}
            </Text>
          </View>
          <View className="flex-row items-center gap-3">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy path"
              onPress={copyPath}
              className="min-w-0 flex-1 flex-row items-center gap-1.5 active:opacity-60"
              testID="file-preview-path"
            >
              <Text
                variant="footnote"
                tone="muted"
                mono
                numberOfLines={1}
                className="min-w-0 shrink"
              >
                {target.path}
              </Text>
              <Icon name="Copy" size={13} color={tokens.subtleForeground} />
            </Pressable>
            {sizeText}
          </View>
          <View className="flex-row items-center gap-1">
            {hasSourceToggle ? (
              <ViewModeToggle
                viewMode={viewMode}
                onChange={setViewMode}
                style={styles.segmented}
              />
            ) : null}
            <View className="flex-1" />
            {sourceText !== null ? (
              <Button
                variant="ghost"
                size="sm"
                icon="Target"
                accessibilityLabel="Jump to line"
                onPress={promptJumpToLine}
                testID="file-preview-jump"
              >
                Line
              </Button>
            ) : null}
            {externalUrl !== null ? (
              <Button
                variant="ghost"
                size="icon"
                icon="ExternalLink"
                accessibilityLabel="Open in browser"
                onPress={openExternally}
                testID="file-preview-open-external"
              />
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              icon="RotateCcw"
              accessibilityLabel="Reload"
              loading={query.isFetching && !query.isLoading}
              onPress={reload}
              testID="file-preview-refresh"
            />
          </View>
        </View>
      )}
      <View className="flex-1">{body}</View>
      {chrome === "inline" ? (
        <Sheet controller={jumpSheet} title="Jump to line" stackBehavior="push">
          <View className="gap-3 px-4 pb-2">
            <SheetTextInput
              value={jumpValue}
              onChangeText={setJumpValue}
              keyboardType="number-pad"
              returnKeyType="go"
              onSubmitEditing={jumpToLine}
              placeholder="Line number"
              autoFocus
              {...jumpField}
              testID="file-preview-jump-input"
            />
            <Button onPress={jumpToLine} testID="file-preview-jump-submit">
              Go
            </Button>
          </View>
        </Sheet>
      ) : null}
      <ActionSheet
        controller={lineMenu}
        title={menuLine === null ? undefined : `Line ${menuLine}`}
        actions={lineActions}
        stackBehavior="push"
      />
      {localLinks.pickerSheet}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  /** The inline header's segmented control shares its row with the action buttons. */
  segmented: { flex: 1, maxWidth: 200 },
});
