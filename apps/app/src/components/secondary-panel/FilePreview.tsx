import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { File as PierreFile } from "@pierre/diffs/react";
import type { FileOptions } from "@pierre/diffs/react";
import type { SelectedLineRange, SupportedLanguages } from "@pierre/diffs";
import type { UrlTransform } from "react-markdown";
import { Button } from "@/components/ui/button.js";
import {
  COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
  COARSE_POINTER_TEXT_SM_CLASS,
} from "@/components/ui/coarse-pointer-sizing.js";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { CopyButton } from "@/components/ui/copy-button.js";
import { Icon } from "@/components/ui/icon.js";
import { OpenInEditorButton } from "@/components/ui/open-in-editor-button.js";
import type { MarkdownLinkRouting } from "@/components/ui/markdown-link-routing.js";
import { MarkdownPreview } from "@/components/ui/markdown-preview.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { TruncateStart } from "@/components/ui/truncate-start.js";
import { usePreferredTheme } from "@/hooks/useTheme";
import type {
  FilePreviewLineRange,
  WorkspaceFilePreviewStatusLabel,
} from "@/lib/file-preview";
import {
  DEFAULT_CODE_OVERFLOW_MODE,
  getNextCodeOverflowMode,
  type CodeOverflowMode,
  type CodeOverflowModeChangeHandler,
} from "@/lib/code-overflow-mode";
import { cn } from "@/lib/utils";

export interface FilePreviewFile {
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
}

interface HtmlFilePreviewBodyProps {
  lineOverflowMode: CodeOverflowMode;
  state: Extract<FilePreviewState, { kind: "html" }>;
  viewMode: FilePreviewViewMode;
}

interface FilePreviewHeaderProps {
  path: string;
  copyPath: string | null;
  onOpenInEditor?: (path: string) => void;
  statusLabel: WorkspaceFilePreviewStatusLabel | null;
  toggleKind: FilePreviewToggleKind | null;
  showLineOverflowToggle: boolean;
  lineOverflowMode: CodeOverflowMode;
  onLineOverflowModeChange: CodeOverflowModeChangeHandler;
  viewMode: FilePreviewViewMode;
  onViewModeChange: (mode: FilePreviewViewMode) => void;
}

interface MarkdownFilePreviewProps {
  file: FilePreviewFile;
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

function getRawToggleTitle(kind: FilePreviewToggleKind): string {
  return kind === "html" ? "HTML source" : "Markdown source";
}

function getFilePreviewLineRange(
  state: FilePreviewState,
): FilePreviewLineRange | null {
  if (state.kind === "html" || state.kind === "ready") {
    return state.lineRange;
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
  onOpenInEditor,
  markdownLinkRouting,
  statusLabel = null,
}: FilePreviewProps) {
  const toggleKind = getFilePreviewToggleKind(state);
  const filePreviewLineRange = getFilePreviewLineRange(state);
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
  const usesFullHeightLayout = usesIframeLayout || usesCodeLayout;
  // The markdown preview renders on a raised "paper" surface that should fill
  // the panel to the bottom even for short documents. `min-h-full` (vs the
  // iframe layout's `h-full min-h-0`) keeps the column growable, so long
  // documents still scroll the outer panel rather than an inner box.
  const usesMarkdownPreviewLayout =
    state.kind === "ready" &&
    isMarkdownFile(state.file.name) &&
    bodyViewMode === "preview";

  // Establish a `@container/page` scope so MarkdownPreview's `100cqw`-based
  // table breakout sizes against this panel, not the viewport.
  return (
    <div
      className={
        usesFullHeightLayout
          ? "@container/page flex h-full min-h-0 flex-col"
          : usesMarkdownPreviewLayout
            ? "@container/page flex min-h-full flex-col"
            : "@container/page"
      }
      style={FILE_PREVIEW_WRAPPER_STYLE}
    >
      {headerMode === "file" ? (
        <FilePreviewHeader
          path={path}
          copyPath={copyPath}
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
      />
    );
  }
  return (
    <FilePreviewCode
      file={state.file}
      lineOverflowMode={lineOverflowMode}
      lineRange={state.lineRange ?? null}
    />
  );
}

function FilePreviewHeader({
  path,
  copyPath,
  onOpenInEditor,
  statusLabel,
  toggleKind,
  showLineOverflowToggle,
  lineOverflowMode,
  onLineOverflowModeChange,
  viewMode,
  onViewModeChange,
}: FilePreviewHeaderProps) {
  // The fade is `absolute top-full` so the bar's bottom border is the actual
  // overflow edge — content scrolls under right at the border. The fade lives
  // in the sticky element so it pins with the header, but `absolute` keeps it
  // out of flow so the body's `pt-4` controls the initial gap, not this strip.
  return (
    // The wrapper carries an opaque `bg-background` base so the translucent
    // `bg-surface-recessed` tint on the bar composites to a solid tone — without
    // it, body content scrolling under the sticky header would bleed through.
    <div className="sticky top-0 z-10 bg-background">
      <div className="flex h-9 items-center gap-2 border-b border-border-seam bg-surface-raised px-4">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Icon
            name="File"
            className="size-3.5 shrink-0 text-subtle-foreground"
          />
          <TruncateStart
            className={cn(
              "min-w-0 font-mono font-medium leading-5 text-file-accent",
              COARSE_POINTER_TEXT_SM_CLASS,
            )}
            title={path}
          >
            {path}
          </TruncateStart>
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
          {copyPath === null ? null : (
            <CopyButton
              text={copyPath}
              label="Copy file path"
              className="shrink-0 rounded-md hover:bg-state-hover hover:text-foreground"
            />
          )}
          {onOpenInEditor ? (
            <OpenInEditorButton onClick={() => onOpenInEditor(path)} />
          ) : null}
        </div>
        {showLineOverflowToggle || toggleKind !== null ? (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {showLineOverflowToggle ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
                  "text-muted-foreground",
                )}
                onClick={() =>
                  onLineOverflowModeChange(
                    getNextCodeOverflowMode(lineOverflowMode),
                  )
                }
                aria-label={
                  lineOverflowMode === "wrap"
                    ? "Disable source line wrap"
                    : "Wrap source lines"
                }
                aria-pressed={lineOverflowMode === "wrap"}
                title={
                  lineOverflowMode === "wrap"
                    ? "Disable source line wrap"
                    : "Wrap source lines"
                }
              >
                <Icon name="TextWrap" />
              </Button>
            ) : null}
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
                  title="Rendered preview"
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
                  title={getRawToggleTitle(toggleKind)}
                >
                  Raw
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-full h-4 bg-gradient-to-b from-background to-transparent"
      />
    </div>
  );
}

function HtmlFilePreviewBody({
  lineOverflowMode,
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
        />
      </div>
    </>
  );
}

function MarkdownFilePreview({
  file,
  urlTransform,
  markdownLinkRouting,
}: MarkdownFilePreviewProps) {
  return (
    // Render the markdown document on a faint "paper" wash so the rendered
    // viewer reads as a distinct surface from the white chat — one tonal step
    // lighter than the recessed header (matching the raised-body / recessed-
    // header pairing used elsewhere in this panel).
    <div className="flex-1 bg-surface-raised px-4 py-4">
      <MarkdownPreview
        allowHtml
        content={file.contents}
        urlTransform={urlTransform}
        linkRouting={markdownLinkRouting}
      />
    </div>
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
}: FilePreviewCodeProps) {
  const preferredTheme = usePreferredTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const options = useMemo<FileOptions<undefined>>(
    () => ({
      themeType: preferredTheme,
      overflow: lineOverflowMode,
      disableFileHeader: true,
      enableLineSelection: lineRange !== null,
    }),
    [lineOverflowMode, lineRange, preferredTheme],
  );
  const selectedLines = useMemo<SelectedLineRange | null>(
    () =>
      lineRange === null
        ? null
        : {
            start: lineRange.startLineNumber,
            end: lineRange.endLineNumber,
          },
    [lineRange],
  );
  const targetLineNumber = selectedLines?.start ?? null;

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

  return (
    <div
      ref={containerRef}
      className="min-h-0 flex-1"
      style={FILE_PREVIEW_VIEW_STYLE}
      data-file-preview-line-number={targetLineNumber ?? undefined}
    >
      <PierreFile file={file} options={options} selectedLines={selectedLines} />
    </div>
  );
}
