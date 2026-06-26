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
import type { SelectedLineRange, SupportedLanguages } from "@pierre/diffs";
import type { UrlTransform } from "react-markdown";
import { Button } from "@/components/ui/button.js";
import { usePierreLineSelectionActions } from "@/components/git-diff/PierreLineSelectionActions.js";
import { COARSE_POINTER_TEXT_SM_CLASS } from "@/components/ui/coarse-pointer-sizing.js";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { CopyButton } from "@/components/ui/copy-button.js";
import { Icon } from "@/components/ui/icon.js";
import { OpenInEditorButton } from "@/components/ui/open-in-editor-button.js";
import type { MarkdownLinkRouting } from "@/components/ui/markdown-link-routing.js";
import { MarkdownPreview } from "@/components/ui/markdown-preview.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.js";
import { TruncateStart } from "@/components/ui/truncate-start.js";
import { usePreferredTheme } from "@/hooks/useTheme";
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
import { cn } from "@/lib/utils";
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
      showMarkdownModeToggle: boolean;
      markdownUrlTransform?: UrlTransform;
    };

export interface FilePreviewProps {
  state: FilePreviewState;
  path: string;
  copyPath?: string | null;
  headerMode?: FilePreviewHeaderMode;
  onSelectionAddToChat?: (text: string) => void;
  onOpenInEditor?: (path: string) => void;
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

type FilePreviewViewMode = "preview" | "source";
type FilePreviewToggleKind = "html" | "markdown";
export type FilePreviewHeaderMode = "file" | "none";
type IframeLoadState = "loading" | "loaded" | "error";

const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set([
  "md",
  "mdx",
  "markdown",
]);

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

function isMarkdownFile(name: string): boolean {
  const extension = name.split(".").pop()?.toLowerCase();
  return extension !== undefined && MARKDOWN_EXTENSIONS.has(extension);
}

function getFilePreviewToggleKind(
  state: FilePreviewState,
): FilePreviewToggleKind | null {
  if (state.kind === "html") {
    return "html";
  }
  if (
    state.kind === "ready" &&
    state.showMarkdownModeToggle &&
    isMarkdownFile(state.file.name)
  ) {
    return "markdown";
  }
  return null;
}

function getToggleAriaLabel(kind: FilePreviewToggleKind): string {
  return kind === "html" ? "HTML view mode" : "Markdown view mode";
}

function getFileContentsCopyLabel(kind: FilePreviewToggleKind | null): string {
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
  if (toggleKind === "markdown") {
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

  return !isMarkdownFile(state.file.name) || viewMode === "source";
}

export function FilePreview({
  state,
  path,
  copyPath = null,
  headerMode = "file",
  onSelectionAddToChat,
  onOpenInEditor,
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
    isMarkdownFile(state.file.name) &&
    bodyViewMode === "preview";
  const usesContentHeightLayout = usesCodeLayout || usesMarkdownPreviewLayout;

  // Establish a `@container/page` scope so MarkdownPreview's `100cqw`-based
  // table breakout sizes against this panel, not the viewport.
  return (
    <div
      className={
        usesIframeLayout
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
  if (isMarkdownFile(state.file.name) && viewMode === "preview") {
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
  statusLabel,
  toggleKind,
  showLineOverflowToggle,
  lineOverflowMode,
  onLineOverflowModeChange,
  viewMode,
  onViewModeChange,
}: FilePreviewHeaderProps) {
  const showHeaderControls = showLineOverflowToggle || toggleKind !== null;
  const copyFileContentsLabel = getFileContentsCopyLabel(toggleKind);

  return (
    // The wrapper carries an opaque `bg-background` base so the translucent
    // `bg-surface-recessed` tint on the bar composites to a solid tone — without
    // it, body content scrolling under the sticky header would bleed through.
    <div className="sticky top-0 z-10 bg-background">
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <OpenInEditorButton onClick={() => onOpenInEditor(path)} />
                </TooltipTrigger>
                <TooltipContent side="bottom">Open in editor</TooltipContent>
              </Tooltip>
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
    // Render the markdown document on a faint "paper" wash so the rendered
    // viewer reads as a distinct surface from the white chat — one tonal step
    // lighter than the recessed header (matching the raised-body / recessed-
    // header pairing used elsewhere in this panel).
    <SecondaryPanelSelectionActions
      className="contents"
      onSelectionAddToChat={onSelectionAddToChat}
    >
      <div className="flex-auto bg-surface-raised px-4 py-4">
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

function clearPreviewTargetLine(container: HTMLElement) {
  const targetLines = container.querySelectorAll(
    "[data-file-preview-target-line]",
  );
  for (const targetLine of targetLines) {
    targetLine.removeAttribute("data-file-preview-target-line");
    targetLine.removeAttribute("data-selected-line");
  }
}

function findPreviewTargetLine(
  container: HTMLElement,
  lineNumber: number,
): HTMLElement | null {
  const lines = container.querySelectorAll(`[data-line="${lineNumber}"]`);
  for (const line of lines) {
    if (line instanceof HTMLElement && line.dataset.lineIndex !== undefined) {
      return line;
    }
  }
  for (const line of lines) {
    if (line instanceof HTMLElement) {
      return line;
    }
  }
  return null;
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
      clearPreviewTargetLine(container.ownerDocument.body);
      if (targetLineNumber === null) return;

      const line =
        findPreviewTargetLine(container, targetLineNumber) ??
        findPreviewTargetLine(container.ownerDocument.body, targetLineNumber);
      if (line) {
        line.setAttribute("data-file-preview-target-line", "");
        line.setAttribute("data-selected-line", "single");
        line.scrollIntoView?.({ block: "center" });
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
        clearPreviewTargetLine(cleanupContainer.ownerDocument.body);
      }
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [file.contents, file.name, targetLineNumber]);

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
