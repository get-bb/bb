import type { FilePreviewLineRange } from "@bb/client-core";
import { useCallback, useMemo, useRef, useState } from "react";
import { Linking, Pressable, View } from "react-native";
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
import { useTheme } from "@/theme";
import {
  ActionSheet,
  Button,
  Icon,
  Pill,
  Sheet,
  SheetTextInput,
  Text,
  toast,
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
  testID?: string;
}

type ViewMode = "preview" | "source";

function initialViewMode(lineRange: FilePreviewLineRange | null): ViewMode {
  return lineRange === null ? "preview" : "source";
}

/**
 * The file preview (full-screen route body and panel tab body): header
 * (name, source, size, tappable path, open-in-browser, jump-to-line,
 * preview/source toggle) over a body per content kind — code with line
 * numbers, markdown, CSV grid, HTML in a WebView, image, video hand-off,
 * and the loading / not-found / too-large / error / empty / binary states.
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

  // Jump to line.
  const textBodyRef = useRef<TextFilePreviewBodyHandle>(null);
  const jumpSheet = useSheet();
  const [jumpValue, setJumpValue] = useState("");
  const jumpToLine = useCallback(() => {
    const line = Number.parseInt(jumpValue.trim(), 10);
    jumpSheet.dismiss();
    if (!Number.isFinite(line) || line <= 0) return;
    if (!showsLines) setViewMode("source");
    // Let a mode switch mount the line list before scrolling.
    setTimeout(() => textBodyRef.current?.scrollToLine(line), 50);
  }, [jumpSheet, jumpValue, showsLines]);

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
          onRetry={() => void query.refetch()}
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
          onRetry={() => void query.refetch()}
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

  return (
    <View className="flex-1 bg-background" testID={testID}>
      <View className="gap-2 border-b border-border px-4 pb-2 pt-2">
        <View className="flex-row items-center gap-2">
          <Icon name="FileText" size={18} color={tokens.mutedForeground} />
          <Text
            variant="title"
            className="min-w-0 flex-1"
            numberOfLines={1}
            testID="file-preview-name"
          >
            {name}
          </Text>
          <Pill size="sm" variant="outline">
            {describeFilePreviewTargetSource(target)}
          </Pill>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy path"
          onPress={copyPath}
          className="flex-row items-center gap-1 active:opacity-70"
          testID="file-preview-path"
        >
          <Text
            variant="caption"
            mono
            numberOfLines={1}
            className="min-w-0 flex-1"
          >
            {target.path}
          </Text>
          <Icon name="Copy" size={12} color={tokens.mutedForeground} />
        </Pressable>
        <View className="flex-row items-center gap-2">
          {sizeLabel ? (
            <Text variant="caption" testID="file-preview-size">
              {sizeLabel}
            </Text>
          ) : null}
          <View className="flex-1" />
          {hasSourceToggle ? (
            <View className="flex-row overflow-hidden rounded-md border border-border">
              {(["preview", "source"] as const).map((mode) => (
                <Pressable
                  key={mode}
                  accessibilityRole="button"
                  accessibilityState={{ selected: viewMode === mode }}
                  onPress={() => setViewMode(mode)}
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
          ) : null}
          {sourceText !== null ? (
            <Button
              variant="ghost"
              size="sm"
              icon="Target"
              accessibilityLabel="Jump to line"
              onPress={() => {
                setJumpValue("");
                jumpSheet.present();
              }}
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
            onPress={() => void query.refetch()}
            testID="file-preview-refresh"
          />
        </View>
      </View>
      <View className="flex-1">{body}</View>
      <Sheet controller={jumpSheet} title="Jump to line" stackBehavior="push">
        <View className="gap-3 px-4 pb-2">
          <SheetTextInput
            value={jumpValue}
            onChangeText={setJumpValue}
            keyboardType="number-pad"
            returnKeyType="go"
            onSubmitEditing={jumpToLine}
            placeholder="Line number"
            placeholderTextColor={tokens.mutedForeground}
            autoFocus
            style={{
              height: 40,
              borderWidth: 1,
              borderColor: tokens.input,
              borderRadius: 6,
              paddingHorizontal: 12,
              color: tokens.foreground,
              fontSize: 16,
            }}
            testID="file-preview-jump-input"
          />
          <Button onPress={jumpToLine} testID="file-preview-jump-submit">
            Go
          </Button>
        </View>
      </Sheet>
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
