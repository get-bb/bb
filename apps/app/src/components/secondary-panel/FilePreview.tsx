import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { File as PierreFile, useWorkerPool } from "@pierre/diffs/react";
import type { FileOptions } from "@pierre/diffs/react";
import {
  DIFFS_TAG_NAME,
  type SelectedLineRange,
  type SupportedLanguages,
} from "@pierre/diffs";
import type { UrlTransform } from "react-markdown";
import { Button } from "@bb/shared-ui/button";
import { usePierreLineSelectionActions } from "@/components/git-diff/PierreLineSelectionActions.js";
import { COARSE_POINTER_TEXT_SM_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { CopyButton } from "@/components/ui/copy-button.js";
import { Icon } from "@bb/shared-ui/icon";
import { OpenInEditorButton } from "@/components/ui/open-in-editor-button.js";
import { useAppCommandShortcut } from "@/components/commands/AppCommandProvider";
import { AppCommandShortcutHint } from "@/components/commands/AppCommandShortcutHint";
import type { MarkdownLinkRouting } from "@/components/ui/markdown-link-routing.js";
import { MarkdownPreview } from "@/components/ui/markdown-preview.js";
import { Skeleton } from "@bb/shared-ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { TruncateStart } from "@/components/ui/truncate-start.js";
import { usePreferredTheme } from "@/hooks/useTheme";
import { useResolvedCodeThemePair } from "@/lib/code-theme";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import type {
  FilePreviewLineRange,
  WorkspaceFilePreviewStatusLabel,
} from "@/lib/file-preview";
import {
  DEFAULT_CODE_OVERFLOW_MODE,
  type CodeOverflowMode,
  type CodeOverflowModeChangeHandler,
} from "@/lib/code-overflow-mode";
import { cn } from "@bb/shared-ui/lib/utils";
import { SecondaryPanelSelectionActions } from "./SecondaryPanelSelectionActions.js";

export interface FilePreviewFile {
  cacheKey?: string;
  name: string;
  contents: string;
  lang?: SupportedLanguages;
}

export type IframePreviewSandbox = "allow-scripts";

export interface IframeFilePreviewTarget {
  sandbox: IframePreviewSandbox | null;
  title: string;
  url: string;
}

export type FilePreviewState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "not-found" }
  | { kind: "error"; message?: string }
  | { kind: "image"; url: string }
  | { kind: "video"; url: string }
  | ({ kind: "iframe" } & IframeFilePreviewTarget)
  | {
      kind: "html";
      file: FilePreviewFile;
      iframe: IframeFilePreviewTarget;
      lineRange: FilePreviewLineRange | null;
    }
  | {
      kind: "ready";
      file: FilePreviewFile;
      lineRange: FilePreviewLineRange | null;
      textPreviewKind: TextFilePreviewKind | null;
      markdownUrlTransform?: UrlTransform;
    };

export interface FilePreviewProps {
  state: FilePreviewState;
  path: string;
  copyPath?: string | null;
  headerMode?: FilePreviewHeaderMode;
  onSelectionAddToChat?: (text: string) => void;
  onOpenInEditor?: (path: string) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  markdownLinkRouting?: MarkdownLinkRouting;
  statusLabel?: WorkspaceFilePreviewStatusLabel | null;
}

interface FilePreviewBodyProps {
  state: FilePreviewState;
  path: string;
  lineOverflowMode: CodeOverflowMode;
  viewMode: FilePreviewViewMode;
  markdownLinkRouting?: MarkdownLinkRouting;
  onSelectionAddToChat?: (text: string) => void;
}

interface HtmlFilePreviewBodyProps {
  lineOverflowMode: CodeOverflowMode;
  onSelectionAddToChat?: (text: string) => void;
  state: Extract<FilePreviewState, { kind: "html" }>;
  viewMode: FilePreviewViewMode;
}

interface FilePreviewHeaderProps {
  path: string;
  copyPath: string | null;
  rawContents: string | null;
  onOpenInEditor?: (path: string) => void;
  onRefresh?: () => void;
  isRefreshing: boolean;
  statusLabel: WorkspaceFilePreviewStatusLabel | null;
  toggleKind: FilePreviewToggleKind | null;
  showLineOverflowToggle: boolean;
  lineOverflowMode: CodeOverflowMode;
  onLineOverflowModeChange: CodeOverflowModeChangeHandler;
  viewMode: FilePreviewViewMode;
  onViewModeChange: (mode: FilePreviewViewMode) => void;
}

interface FilePreviewLineWrapButtonProps {
  showLineOverflowToggle: boolean;
  lineOverflowMode: CodeOverflowMode;
  onLineOverflowModeChange: CodeOverflowModeChangeHandler;
}

interface FilePreviewPathProps {
  path: string;
  copyPath: string | null;
}

interface MarkdownFilePreviewProps {
  file: FilePreviewFile;
  onSelectionAddToChat?: (text: string) => void;
  urlTransform?: UrlTransform;
  markdownLinkRouting?: MarkdownLinkRouting;
}

interface CsvFilePreviewProps {
  file: FilePreviewFile;
  onSelectionAddToChat?: (text: string) => void;
}

interface FilePreviewImageProps {
  url: string;
  alt: string;
}

interface FilePreviewVideoProps {
  url: string;
  title: string;
}

interface FilePreviewMessageProps {
  message: string;
  role?: "alert";
}

interface FilePreviewCodeProps {
  file: FilePreviewFile;
  lineOverflowMode: CodeOverflowMode;
  lineRange: FilePreviewLineRange | null;
  onSelectionAddToChat?: (text: string) => void;
  path: string;
}

interface FilePreviewWorkerPoolStats {
  managerState: "waiting" | "initializing" | "initialized";
  workersFailed: boolean;
  totalWorkers: number;
  busyWorkers: number;
  queuedTasks: number;
  activeTasks: number;
  themeSubscribers: number;
  fileCacheSize: number;
  diffCacheSize: number;
}

interface GetInitialFilePreviewViewModeArgs {
  lineRange: FilePreviewLineRange | null;
  toggleKind: FilePreviewToggleKind | null;
}

interface CsvPreviewData {
  columnCount: number;
  rows: string[][];
  truncatedColumns: boolean;
  truncatedRows: boolean;
}

type FilePreviewViewMode = "preview" | "source";
export type TextFilePreviewKind = "csv" | "markdown";
type FilePreviewToggleKind = "csv" | "html" | "markdown";
export type FilePreviewHeaderMode = "file" | "none";
type IframeLoadState = "loading" | "loaded" | "error";

const CSV_PREVIEW_MAX_COLUMNS = 100;
const CSV_PREVIEW_MAX_ROWS = 500;

const FILE_PREVIEW_VIEW_STYLE = {
  "--diffs-font-size": "12px",
  "--diffs-line-height": "18px",
  // Pierre paints its theme bg inside this gap, so the top breathing room of
  // the code body lives on Pierre's bg — not on the panel's bg-background.
  // Without this, the gap above Pierre would show a visible bg-color seam.
  "--diffs-gap-block": "16px",
} as CSSProperties;

// `--md-content-w` tells MarkdownPreview the surrounding text-column width so
// narrow tables sit flush with the prose on the left instead of centering in
// the panel. `100cqi` resolves against the `@container/page` scope on the
// wrapper below — i.e. the panel width.
const FILE_PREVIEW_WRAPPER_STYLE = {
  "--md-content-w": "100cqi",
} as CSSProperties;

const HTML_FILE_PREVIEW_IFRAME_STYLE = {
  width: "100%",
  height: "100%",
  border: 0,
} as CSSProperties;
const IFRAME_LOADING_INDICATOR_DELAY_MS = 160;
const FILE_PREVIEW_HEADER_ICON_BUTTON_CLASS =
  "h-5 w-5 rounded-sm p-0 [&_svg]:size-3 max-md:pointer-coarse:h-9 max-md:pointer-coarse:w-9 max-md:pointer-coarse:[&_svg]:size-5";

function getFilePreviewToggleKind(
  state: FilePreviewState,
): FilePreviewToggleKind | null {
  if (state.kind === "html") {
    return "html";
  }
  if (state.kind === "ready") {
    return state.textPreviewKind;
  }
  return null;
}

function getToggleAriaLabel(kind: FilePreviewToggleKind): string {
  switch (kind) {
    case "csv":
      return "CSV view mode";
    case "html":
      return "HTML view mode";
    case "markdown":
      return "Markdown view mode";
  }
}

function getFileContentsCopyLabel(kind: FilePreviewToggleKind | null): string {
  if (kind === "csv") {
    return "Copy CSV";
  }
  if (kind === "markdown") {
    return "Copy markdown";
  }
  if (kind === "html") {
    return "Copy HTML source";
  }
  return "Copy file contents";
}

function getLineWrapToggleLabel(lineOverflowMode: CodeOverflowMode): string {
  return lineOverflowMode === "wrap" ? "Disable line wrap" : "Wrap lines";
}

function getFilePreviewLineRange(
  state: FilePreviewState,
): FilePreviewLineRange | null {
  if (state.kind === "html" || state.kind === "ready") {
    return state.lineRange;
  }
  return null;
}

function getRawFilePreviewContents(state: FilePreviewState): string | null {
  if (state.kind === "html" || state.kind === "ready") {
    return state.file.contents;
  }
  return null;
}

function getInitialFilePreviewViewMode({
  lineRange,
  toggleKind,
}: GetInitialFilePreviewViewModeArgs): FilePreviewViewMode {
  if (toggleKind === "csv" || toggleKind === "markdown") {
    return "preview";
  }
  return lineRange === null ? "preview" : "source";
}

function usesCodeViewLayout(
  state: FilePreviewState,
  viewMode: FilePreviewViewMode,
): boolean {
  if (state.kind === "html") {
    return viewMode === "source";
  }

  if (state.kind !== "ready") {
    return false;
  }

  return state.textPreviewKind === null || viewMode === "source";
}

interface ParsedCsvRows {
  rows: string[][];
  truncatedRows: boolean;
}

// Stops scanning once `maxRows` rows are collected, so a multi-megabyte CSV
// only pays for the previewed prefix.
function parseCsvRows(contents: string, maxRows: number): ParsedCsvRows {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let quotedField = false;
  let endedWithLineBreak = false;

  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index];
    endedWithLineBreak = false;

    if (inQuotes) {
      if (character === '"') {
        if (contents[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      inQuotes = true;
      quotedField = true;
      continue;
    }

    if (character === ",") {
      row.push(field);
      field = "";
      quotedField = false;
      continue;
    }

    if (character === "\n" || character === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      quotedField = false;
      endedWithLineBreak = true;
      if (character === "\r" && contents[index + 1] === "\n") {
        index += 1;
      }
      if (rows.length >= maxRows) {
        return { rows, truncatedRows: index + 1 < contents.length };
      }
      continue;
    }

    field += character;
  }

  if (
    field.length > 0 ||
    row.length > 0 ||
    quotedField ||
    !endedWithLineBreak
  ) {
    row.push(field);
    rows.push(row);
  }

  return { rows, truncatedRows: false };
}

export function buildCsvPreviewData(contents: string): CsvPreviewData {
  // +1: the first parsed row is the header, so the cap counts data rows.
  const { rows, truncatedRows } = parseCsvRows(
    contents,
    CSV_PREVIEW_MAX_ROWS + 1,
  );
  // Column stats only consider the previewed rows; a wider row past the row
  // cap won't flag truncatedColumns. Fine for a preview.
  const columnCount = rows.reduce(
    (maximum, row) => Math.max(maximum, row.length),
    0,
  );

  return {
    columnCount: Math.min(columnCount, CSV_PREVIEW_MAX_COLUMNS),
    rows,
    truncatedColumns: columnCount > CSV_PREVIEW_MAX_COLUMNS,
    truncatedRows,
  };
}

export function getCsvTruncationNote(
  preview: CsvPreviewData,
  dataRowCount: number,
): string | null {
  const limits: string[] = [];
  if (preview.truncatedRows) {
    limits.push(`${dataRowCount.toLocaleString()} rows`);
  }
  if (preview.truncatedColumns) {
    limits.push(`${preview.columnCount.toLocaleString()} columns`);
  }
  if (limits.length === 0) {
    return null;
  }
  return `Showing the first ${limits.join(" and ")}.`;
}

export function FilePreview({
  state,
  path,
  copyPath = null,
  headerMode = "file",
  onSelectionAddToChat,
  onOpenInEditor,
  onRefresh,
  isRefreshing = false,
  markdownLinkRouting,
  statusLabel = null,
}: FilePreviewProps) {
  const toggleKind = getFilePreviewToggleKind(state);
  const filePreviewLineRange = getFilePreviewLineRange(state);
  const rawContents = getRawFilePreviewContents(state);
  const [viewMode, setViewMode] = useState<FilePreviewViewMode>(
    getInitialFilePreviewViewMode({
      lineRange: filePreviewLineRange,
      toggleKind,
    }),
  );
  const [lineOverflowMode, setLineOverflowMode] = useState<CodeOverflowMode>(
    DEFAULT_CODE_OVERFLOW_MODE,
  );
  // Each new file opens in the appropriate default mode; the user re-toggles
  // per file rather than carrying their last choice across unrelated files.
  useEffect(() => {
    setViewMode(
      getInitialFilePreviewViewMode({
        lineRange: filePreviewLineRange,
        toggleKind,
      }),
    );
  }, [filePreviewLineRange, path, toggleKind]);

  const usesIframeLayout =
    state.kind === "iframe" ||
    (state.kind === "html" && viewMode === "preview");
  const bodyViewMode: FilePreviewViewMode =
    toggleKind === null ? "preview" : viewMode;
  const usesCodeLayout = usesCodeViewLayout(state, bodyViewMode);
  const showLineOverflowToggle = usesCodeLayout;
  // The markdown preview renders on a raised "paper" surface that should fill
  // the panel to the bottom even for short documents. `min-h-full` (vs the
  // iframe layout's `h-full min-h-0`) keeps the column growable, so long
  // documents still scroll the outer panel rather than an inner box.
  const usesMarkdownPreviewLayout =
    state.kind === "ready" &&
    state.textPreviewKind === "markdown" &&
    bodyViewMode === "preview";
  // The CSV table needs one scroller that owns both axes: its sticky header
  // row and row-number gutter only stick against their own scrollport, and
  // splitting the axes (panel scrolls vertically, inner box horizontally)
  // strands the horizontal scrollbar at the bottom of the full-height table
  // and lets the sticky gutter paint over the panel header. So fill the panel
  // like the iframe layout and let CsvFilePreview scroll internally.
  const usesCsvPreviewLayout =
    state.kind === "ready" &&
    state.textPreviewKind === "csv" &&
    bodyViewMode === "preview";
  const usesFullHeightLayout = usesIframeLayout || usesCsvPreviewLayout;
  const usesContentHeightLayout = usesCodeLayout || usesMarkdownPreviewLayout;

  // Establish a `@container/page` scope so MarkdownPreview's `100cqw`-based
  // table breakout sizes against this panel, not the viewport.
  return (
    <div
      className={
        usesFullHeightLayout
          ? "@container/page flex h-full min-h-0 flex-col"
          : usesContentHeightLayout
            ? "@container/page flex min-h-full flex-col"
            : "@container/page min-h-full"
      }
      style={FILE_PREVIEW_WRAPPER_STYLE}
    >
      {headerMode === "file" ? (
        <FilePreviewHeader
          path={path}
          copyPath={copyPath}
          rawContents={rawContents}
          onOpenInEditor={onOpenInEditor}
          onRefresh={onRefresh}
          isRefreshing={isRefreshing}
          statusLabel={statusLabel}
          toggleKind={toggleKind}
          showLineOverflowToggle={showLineOverflowToggle}
          lineOverflowMode={lineOverflowMode}
          onLineOverflowModeChange={setLineOverflowMode}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      ) : null}
      <FilePreviewBody
        state={state}
        path={path}
        lineOverflowMode={lineOverflowMode}
        viewMode={bodyViewMode}
        markdownLinkRouting={markdownLinkRouting}
        onSelectionAddToChat={onSelectionAddToChat}
      />
    </div>
  );
}

function FilePreviewBody({
  state,
  path,
  lineOverflowMode,
  viewMode,
  markdownLinkRouting,
  onSelectionAddToChat,
}: FilePreviewBodyProps) {
  if (state.kind === "loading") {
    return <FilePreviewLoading />;
  }
  if (state.kind === "empty") {
    return <FilePreviewMessage message="Empty file." />;
  }
  if (state.kind === "not-found") {
    return <FilePreviewMessage message="File not found." role="alert" />;
  }
  if (state.kind === "error") {
    return (
      <FilePreviewMessage
        message={state.message ?? "Failed to load file"}
        role={state.message === undefined ? "alert" : undefined}
      />
    );
  }
  if (state.kind === "image") {
    return <FilePreviewImage url={state.url} alt={path} />;
  }
  if (state.kind === "video") {
    return <FilePreviewVideo url={state.url} title={path} />;
  }
  if (state.kind === "iframe") {
    return (
      <IframeFilePreview
        sandbox={state.sandbox}
        title={state.title}
        url={state.url}
      />
    );
  }
  if (state.kind === "html") {
    return (
      <HtmlFilePreviewBody
        lineOverflowMode={lineOverflowMode}
        onSelectionAddToChat={onSelectionAddToChat}
        state={state}
        viewMode={viewMode}
      />
    );
  }
  if (state.textPreviewKind === "csv" && viewMode === "preview") {
    return (
      <CsvFilePreview
        file={state.file}
        onSelectionAddToChat={onSelectionAddToChat}
      />
    );
  }
  if (state.textPreviewKind === "markdown" && viewMode === "preview") {
    return (
      <MarkdownFilePreview
        file={state.file}
        urlTransform={state.markdownUrlTransform}
        markdownLinkRouting={markdownLinkRouting}
        onSelectionAddToChat={onSelectionAddToChat}
      />
    );
  }
  return (
    <FilePreviewCode
      file={state.file}
      lineOverflowMode={lineOverflowMode}
      lineRange={state.lineRange ?? null}
      onSelectionAddToChat={onSelectionAddToChat}
      path={path}
    />
  );
}

function FilePreviewHeader({
  path,
  copyPath,
  rawContents,
  onOpenInEditor,
  onRefresh,
  isRefreshing,
  statusLabel,
  toggleKind,
  showLineOverflowToggle,
  lineOverflowMode,
  onLineOverflowModeChange,
  viewMode,
  onViewModeChange,
}: FilePreviewHeaderProps) {
  const openShortcut = useAppCommandShortcut("workspace.openPreferred");
  const showHeaderControls = showLineOverflowToggle || toggleKind !== null;
  const copyFileContentsLabel = getFileContentsCopyLabel(toggleKind);

  return (
    // The wrapper carries an opaque panel-surface base so the translucent
    // `bg-surface-recessed` tint on the bar composites to a solid tone — without
    // it, body content scrolling under the sticky header would bleed through.
    <div className="sticky top-0 z-10 bg-sidebar">
      <div className="flex h-9 items-center gap-2 bg-surface-raised px-4">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Icon
            name="File"
            className="size-3.5 shrink-0 text-subtle-foreground"
          />
          <FilePreviewPath path={path} copyPath={copyPath} />
          {statusLabel === null ? null : (
            <span
              className={cn(
                "shrink-0 leading-5 text-muted-foreground",
                COARSE_POINTER_TEXT_SM_CLASS,
              )}
            >
              ({statusLabel})
            </span>
          )}
          <TooltipProvider delayDuration={300}>
            {onRefresh ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      FILE_PREVIEW_HEADER_ICON_BUTTON_CLASS,
                      "shrink-0 text-muted-foreground hover:bg-state-hover hover:text-foreground",
                    )}
                    onClick={onRefresh}
                    disabled={isRefreshing}
                    aria-label={
                      isRefreshing ? "Refreshing file" : "Refresh file"
                    }
                  >
                    <Icon
                      name={isRefreshing ? "Spinner" : "RotateCcw"}
                      className={cn(isRefreshing && "animate-spin")}
                      aria-hidden
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {isRefreshing ? "Refreshing file" : "Refresh file"}
                </TooltipContent>
              </Tooltip>
            ) : null}
            {rawContents === null ? null : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <CopyButton
                    text={rawContents}
                    label={copyFileContentsLabel}
                    className="shrink-0 rounded-md hover:bg-state-hover hover:text-foreground"
                  />
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {copyFileContentsLabel}
                </TooltipContent>
              </Tooltip>
            )}
            {onOpenInEditor ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <OpenInEditorButton
                      onClick={() => onOpenInEditor(path)}
                      label={
                        openShortcut
                          ? `Open in editor (${openShortcut.label})`
                          : "Open in editor"
                      }
                      aria-keyshortcuts={openShortcut?.ariaKeyshortcuts}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {openShortcut
                      ? `Open in editor (${openShortcut.label})`
                      : "Open in editor"}
                  </TooltipContent>
                </Tooltip>
                <AppCommandShortcutHint shortcut={openShortcut} />
              </>
            ) : null}
          </TooltipProvider>
        </div>
        {showHeaderControls ? (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <FilePreviewLineWrapButton
              showLineOverflowToggle={showLineOverflowToggle}
              lineOverflowMode={lineOverflowMode}
              onLineOverflowModeChange={onLineOverflowModeChange}
            />
            {toggleKind !== null ? (
              <div
                className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border p-0.5"
                role="tablist"
                aria-label={getToggleAriaLabel(toggleKind)}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-5 rounded-sm px-2 text-muted-foreground max-md:pointer-coarse:h-9",
                    COARSE_POINTER_TEXT_SM_CLASS,
                  )}
                  onClick={() => onViewModeChange("preview")}
                  aria-pressed={viewMode === "preview"}
                >
                  Preview
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-5 rounded-sm px-2 text-muted-foreground max-md:pointer-coarse:h-9",
                    COARSE_POINTER_TEXT_SM_CLASS,
                  )}
                  onClick={() => onViewModeChange("source")}
                  aria-pressed={viewMode === "source"}
                >
                  Raw
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FilePreviewPath({ path, copyPath }: FilePreviewPathProps) {
  const copyTarget = copyPath ?? path;
  const label = "Copy file path";
  const className = cn(
    "min-w-0 font-mono font-medium leading-5 text-file-accent",
    COARSE_POINTER_TEXT_SM_CLASS,
  );

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              className,
              "cursor-pointer rounded-sm text-left underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
            aria-label={label}
            onClick={() => {
              void copyToClipboardWithToast(copyTarget, {
                successMessage: "File path copied",
                errorMessage: "Failed to copy file path",
              });
            }}
          >
            <TruncateStart>{path}</TruncateStart>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function FilePreviewLineWrapButton({
  showLineOverflowToggle,
  lineOverflowMode,
  onLineOverflowModeChange,
}: FilePreviewLineWrapButtonProps) {
  if (!showLineOverflowToggle) {
    return null;
  }

  const label = getLineWrapToggleLabel(lineOverflowMode);

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              FILE_PREVIEW_HEADER_ICON_BUTTON_CLASS,
              "text-muted-foreground",
            )}
            aria-label={label}
            aria-pressed={lineOverflowMode === "wrap"}
            onClick={() => {
              onLineOverflowModeChange(
                lineOverflowMode === "wrap" ? "scroll" : "wrap",
              );
            }}
          >
            <Icon name="TextWrap" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function HtmlFilePreviewBody({
  lineOverflowMode,
  onSelectionAddToChat,
  state,
  viewMode,
}: HtmlFilePreviewBodyProps) {
  const isPreviewVisible = viewMode === "preview";
  return (
    <>
      <div
        className={isPreviewVisible ? "contents" : "hidden"}
        aria-hidden={isPreviewVisible ? undefined : true}
      >
        <IframeFilePreview
          sandbox={state.iframe.sandbox}
          title={state.iframe.title}
          url={state.iframe.url}
        />
      </div>
      <div
        className={isPreviewVisible ? "hidden" : "contents"}
        aria-hidden={isPreviewVisible ? true : undefined}
      >
        <FilePreviewCode
          file={state.file}
          lineOverflowMode={lineOverflowMode}
          lineRange={state.lineRange}
          onSelectionAddToChat={onSelectionAddToChat}
          path={state.file.name}
        />
      </div>
    </>
  );
}

function MarkdownFilePreview({
  file,
  onSelectionAddToChat,
  urlTransform,
  markdownLinkRouting,
}: MarkdownFilePreviewProps) {
  return (
    // Keep rendered Markdown on the ordinary document background. Its parent
    // owns the boundary, so another raised "paper" layer would make nested
    // file viewers feel like cards stacked inside cards.
    <SecondaryPanelSelectionActions
      className="contents"
      onSelectionAddToChat={onSelectionAddToChat}
    >
      <div className="flex-auto bg-background px-4 py-4">
        <MarkdownPreview
          allowHtml
          content={file.contents}
          urlTransform={urlTransform}
          linkRouting={markdownLinkRouting}
        />
      </div>
    </SecondaryPanelSelectionActions>
  );
}

function CsvFilePreview({ file, onSelectionAddToChat }: CsvFilePreviewProps) {
  const preview = useMemo(
    () => buildCsvPreviewData(file.contents),
    [file.contents],
  );
  const headerRow = preview.rows[0] ?? [];
  const bodyRows = preview.rows.slice(1);
  const columns = Array.from({ length: preview.columnCount }, (_, index) => ({
    index,
    label: headerRow[index] ?? "",
  }));
  const tableWidth = `max(100%, ${3 + columns.length * 18}rem)`;
  const truncationNote = getCsvTruncationNote(preview, bodyRows.length);

  return (
    <SecondaryPanelSelectionActions
      className="contents"
      onSelectionAddToChat={onSelectionAddToChat}
    >
      {/* Single scroll container for both axes: the sticky header row and
          row-number gutter stick against this box, the horizontal scrollbar
          stays visible at the panel bottom, and the sticky cells are clipped
          here so they can't paint over the panel header. */}
      <div className="flex min-h-0 flex-auto flex-col bg-surface-raised px-4 py-4">
        {/* overscroll-contain: panning a wide table past its edge must not
            chain into the browser back/forward gesture (kept alive globally —
            see app.css overscroll notes) or scroll an ancestor. */}
        <div className="persistent-scrollbar min-h-0 overflow-auto overscroll-contain rounded-md border border-border bg-background">
          <table
            className="min-w-full table-fixed border-separate border-spacing-0 font-mono text-xs leading-5"
            aria-label={`${file.name} CSV preview`}
            style={{ width: tableWidth }}
          >
            <colgroup>
              <col className="w-12" />
              {columns.map((column) => (
                <col key={column.index} className="w-72" />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 top-0 z-30 w-12 min-w-12 border-b border-r border-border bg-surface-recessed-solid px-2 py-1 text-right font-medium text-muted-foreground"
                >
                  #
                </th>
                {columns.map((column) => (
                  <th
                    key={column.index}
                    scope="col"
                    className="sticky top-0 z-20 w-72 max-w-72 border-b border-r border-border bg-surface-recessed-solid px-2 py-1 text-left font-medium text-foreground"
                    title={column.label}
                  >
                    <span className="block max-w-full truncate">
                      {column.label || `Column ${column.index + 1}`}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 w-12 min-w-12 border-b border-r border-border bg-surface-recessed-solid px-2 py-1 text-right font-medium text-muted-foreground"
                  >
                    {rowIndex + 2}
                  </th>
                  {columns.map((column) => {
                    const cell = row[column.index] ?? "";
                    return (
                      <td
                        key={column.index}
                        className="w-72 max-w-72 overflow-hidden border-b border-r border-border px-2 py-1 align-top text-foreground"
                        title={cell}
                      >
                        <span className="block max-w-full truncate">
                          {cell}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {truncationNote === null ? null : (
          <p className="mt-2 shrink-0 text-xs leading-5 text-muted-foreground">
            {truncationNote}
          </p>
        )}
      </div>
    </SecondaryPanelSelectionActions>
  );
}

function FilePreviewImage({ url, alt }: FilePreviewImageProps) {
  return (
    <div className="pt-4">
      <img
        src={url}
        alt={alt}
        className="block max-h-[34rem] w-full object-contain"
      />
    </div>
  );
}

function FilePreviewVideo({ url, title }: FilePreviewVideoProps) {
  return (
    <div className="pt-4">
      <video
        src={url}
        title={title}
        className="block max-h-[34rem] w-full bg-black"
        controls
        preload="metadata"
      />
    </div>
  );
}

function IframeFilePreview({ sandbox, title, url }: IframeFilePreviewTarget) {
  const [loadState, setLoadState] = useState<IframeLoadState>("loading");
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(false);

  useEffect(() => {
    setLoadState("loading");
  }, [url]);

  useEffect(() => {
    if (loadState !== "loading") {
      setShowLoadingIndicator(false);
      return;
    }

    setShowLoadingIndicator(false);
    const timeoutId = window.setTimeout(() => {
      setShowLoadingIndicator(true);
    }, IFRAME_LOADING_INDICATOR_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadState, url]);

  if (loadState === "error") {
    return (
      <div className="min-h-0 flex-1 overflow-hidden">
        <FilePreviewMessage
          message="Failed to load HTML preview."
          role="alert"
        />
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {loadState === "loading" && showLoadingIndicator ? (
        <div className="absolute inset-x-0 top-0 z-10">
          <FilePreviewLoading />
        </div>
      ) : null}
      <iframe
        title={title}
        src={url}
        sandbox={sandbox === null ? undefined : sandbox}
        style={HTML_FILE_PREVIEW_IFRAME_STYLE}
        onLoad={() => setLoadState("loaded")}
        onError={() => setLoadState("error")}
      />
    </div>
  );
}

function getPreviewTargetRoots(container: HTMLElement): ParentNode[] {
  const roots: ParentNode[] = [container];
  // Pierre owns its rendered line elements inside an open shadow root, which
  // normal descendant queries on the React wrapper cannot cross.
  for (const pierreContainer of container.querySelectorAll<HTMLElement>(
    DIFFS_TAG_NAME,
  )) {
    if (pierreContainer.shadowRoot !== null) {
      roots.push(pierreContainer.shadowRoot);
    }
  }
  return roots;
}

function clearPreviewTargetLine(container: HTMLElement) {
  for (const root of getPreviewTargetRoots(container)) {
    const targetLines = root.querySelectorAll(
      "[data-file-preview-target-line]",
    );
    for (const targetLine of targetLines) {
      targetLine.removeAttribute("data-file-preview-target-line");
      targetLine.removeAttribute("data-selected-line");
    }
  }
}

function findPreviewTargetLine(
  container: HTMLElement,
  lineNumber: number,
): HTMLElement | null {
  const roots = getPreviewTargetRoots(container);
  for (const root of roots) {
    const lines = root.querySelectorAll(`[data-line="${lineNumber}"]`);
    for (const line of lines) {
      if (line instanceof HTMLElement && line.dataset.lineIndex !== undefined) {
        return line;
      }
    }
  }
  for (const root of roots) {
    const lines = root.querySelectorAll(`[data-line="${lineNumber}"]`);
    for (const line of lines) {
      if (line instanceof HTMLElement) {
        return line;
      }
    }
  }
  return null;
}

function findPreviewScrollViewport(container: HTMLElement): HTMLElement | null {
  const view = container.ownerDocument.defaultView;
  if (view === null) return null;

  let candidate = container.parentElement;
  while (candidate !== null) {
    const overflowY = view.getComputedStyle(candidate).overflowY;
    if (
      overflowY === "auto" ||
      overflowY === "scroll" ||
      overflowY === "overlay"
    ) {
      return candidate;
    }
    candidate = candidate.parentElement;
  }
  return null;
}

function scrollPreviewTargetLine(
  container: HTMLElement,
  line: HTMLElement,
) {
  const viewport = findPreviewScrollViewport(container);
  if (viewport === null) return;

  const lineRect = line.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();
  const lineCenter = lineRect.top + lineRect.height / 2;
  const viewportCenter = viewportRect.top + viewportRect.height / 2;
  // Adjust only the vertical scroll offset. `scrollIntoView()` can also move
  // the horizontal axis when a long source line extends beyond the viewport.
  viewport.scrollTop += lineCenter - viewportCenter;
}

function formatLineRange(startLineNumber: number, endLineNumber: number) {
  return startLineNumber === endLineNumber
    ? String(startLineNumber)
    : `${startLineNumber}-${endLineNumber}`;
}

function buildFilePreviewLineSelectionText({
  contents,
  path,
  range,
}: {
  contents: string;
  path: string;
  range: SelectedLineRange;
}): string | null {
  const startLineNumber = Math.max(1, Math.min(range.start, range.end));
  const endLineNumber = Math.max(
    startLineNumber,
    Math.max(range.start, range.end),
  );
  const lines = contents.split(/\r\n|\n|\r/);
  const selectedLines = lines.slice(startLineNumber - 1, endLineNumber);
  if (selectedLines.length === 0) {
    return null;
  }
  const selectedText = selectedLines.join("\n").trimEnd();
  if (selectedText.trim().length === 0) {
    return null;
  }
  return `${path}:${formatLineRange(startLineNumber, endLineNumber)}\n${selectedText}`;
}

function FilePreviewLoading() {
  return (
    <div className="space-y-2 px-4 pt-4" aria-busy>
      <Skeleton className="h-3 w-3/4 rounded-sm" />
      <Skeleton className="h-3 w-full rounded-sm" />
      <Skeleton className="h-3 w-5/6 rounded-sm" />
      <Skeleton className="h-3 w-2/3 rounded-sm" />
      <Skeleton className="h-3 w-full rounded-sm" />
      <Skeleton className="h-3 w-3/5 rounded-sm" />
    </div>
  );
}

function FilePreviewMessage({ message, role }: FilePreviewMessageProps) {
  return (
    <EmptyStatePanel role={role} className="mx-4 mt-4 rounded-lg">
      {message}
    </EmptyStatePanel>
  );
}

function FilePreviewCode({
  file,
  lineOverflowMode,
  lineRange,
  onSelectionAddToChat,
  path,
}: FilePreviewCodeProps) {
  const preferredTheme = usePreferredTheme();
  const codeTheme = useResolvedCodeThemePair();
  const containerRef = useRef<HTMLDivElement>(null);
  const workerPool = useWorkerPool();
  const lastWorkerPoolStatsKeyRef = useRef<string | null>(null);
  const [workerPoolStats, setWorkerPoolStats] =
    useState<FilePreviewWorkerPoolStats | null>(null);
  const [, rerenderAfterWorkerPoolChange] = useState(0);
  const buildSelectionText = useCallback(
    (range: SelectedLineRange) =>
      buildFilePreviewLineSelectionText({
        contents: file.contents,
        path,
        range,
      }),
    [file.contents, path],
  );
  const lineSelectionActions = usePierreLineSelectionActions({
    buildSelectionText,
    containerRef,
    enabled: onSelectionAddToChat !== undefined,
    onSelectionAddToChat,
  });
  const options = useMemo<FileOptions<undefined>>(
    () => ({
      themeType: preferredTheme,
      theme: codeTheme,
      overflow: lineOverflowMode,
      disableFileHeader: true,
      enableGutterUtility: onSelectionAddToChat !== undefined,
      enableLineSelection:
        lineRange !== null || onSelectionAddToChat !== undefined,
      lineHoverHighlight:
        onSelectionAddToChat === undefined ? "disabled" : "number",
      onGutterUtilityClick:
        onSelectionAddToChat === undefined
          ? undefined
          : lineSelectionActions.onGutterUtilityClick,
      onLineSelectionChange: lineSelectionActions.onLineSelectionChange,
      onLineSelectionEnd: lineSelectionActions.onLineSelectionEnd,
      onLineSelectionStart: lineSelectionActions.onLineSelectionStart,
    }),
    [
      codeTheme,
      lineOverflowMode,
      lineRange,
      lineSelectionActions.onGutterUtilityClick,
      lineSelectionActions.onLineSelectionChange,
      lineSelectionActions.onLineSelectionEnd,
      lineSelectionActions.onLineSelectionStart,
      onSelectionAddToChat,
      preferredTheme,
    ],
  );
  const selectedLines = useMemo<SelectedLineRange | null>(() => {
    if (lineSelectionActions.selectedRange !== null) {
      return lineSelectionActions.selectedRange;
    }
    return lineRange === null
      ? null
      : {
          start: lineRange.startLineNumber,
          end: lineRange.endLineNumber,
        };
  }, [lineRange, lineSelectionActions.selectedRange]);
  const targetLineNumber = selectedLines?.start ?? null;

  useEffect(() => {
    if (!workerPool) {
      setWorkerPoolStats(null);
      return;
    }

    lastWorkerPoolStatsKeyRef.current = null;
    return workerPool.subscribeToStatChanges((stats) => {
      setWorkerPoolStats(stats);
      const statsKey = [
        stats.managerState,
        stats.workersFailed,
        stats.busyWorkers,
        stats.queuedTasks,
        stats.activeTasks,
        stats.fileCacheSize,
      ].join(":");
      if (lastWorkerPoolStatsKeyRef.current === statsKey) {
        return;
      }
      lastWorkerPoolStatsKeyRef.current = statsKey;
      rerenderAfterWorkerPoolChange((version) => version + 1);
    });
  }, [file.contents, file.name, workerPool]);

  const shouldWaitForWorkerPool =
    workerPool !== undefined &&
    workerPoolStats?.managerState !== "initialized" &&
    workerPoolStats?.workersFailed !== true;
  // Pierre can mount an empty zero-height <pre> while its worker highlighter is
  // still initializing, and the imperative instance does not always recover
  // when the highlighted AST is cached later. Wait for readiness, then remount
  // once the cache entry for this exact file appears so syntax highlighting
  // replaces the plain-text fallback.
  const workerHighlightCacheState =
    workerPool?.getFileResultCache(file) !== undefined
      ? "highlighted"
      : "plain";

  useEffect(() => {
    const cleanupContainer = containerRef.current;
    let animationFrame: number | null = null;
    let attempts = 0;

    // Retry on the next frame (the target line may not be in the DOM yet). One
    // rAF channel only: `scrollToLine` overwrites `animationFrame` on each
    // reschedule, so at most one callback is ever pending and cleanup cancels
    // it — no doubling or leaked stale callbacks marking the wrong line.
    function scheduleRetry() {
      animationFrame = window.requestAnimationFrame(scrollToLine);
    }

    function scrollToLine() {
      const container = containerRef.current;
      if (!container) return;
      clearPreviewTargetLine(container);
      if (targetLineNumber === null) return;

      const line = findPreviewTargetLine(container, targetLineNumber);
      if (line) {
        line.setAttribute("data-file-preview-target-line", "");
        line.setAttribute("data-selected-line", "single");
        scrollPreviewTargetLine(container, line);
        return;
      }

      attempts += 1;
      if (attempts < 8) {
        scheduleRetry();
      }
    }

    scrollToLine();
    return () => {
      if (cleanupContainer) {
        clearPreviewTargetLine(cleanupContainer);
      }
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [
    file.contents,
    file.name,
    shouldWaitForWorkerPool,
    targetLineNumber,
    workerHighlightCacheState,
  ]);

  if (shouldWaitForWorkerPool) {
    return <FilePreviewLoading />;
  }

  return (
    <div
      ref={containerRef}
      className="min-h-0 flex-auto"
      style={FILE_PREVIEW_VIEW_STYLE}
      data-file-preview-line-number={targetLineNumber ?? undefined}
      onPointerDownCapture={lineSelectionActions.onPointerDownCapture}
      onPointerMoveCapture={lineSelectionActions.onPointerMoveCapture}
      onPointerUpCapture={lineSelectionActions.onPointerUpCapture}
    >
      <PierreFile
        key={`${file.cacheKey ?? file.name}:${workerHighlightCacheState}`}
        disableWorkerPool={workerPoolStats?.workersFailed === true}
        file={file}
        options={options}
        selectedLines={selectedLines}
      />
      {lineSelectionActions.menu}
    </div>
  );
}
