import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  definePluginApp,
  Markdown,
  useBbNavigate,
  useRpc,
  type ExperimentalCodeFenceRendererProps,
  type PluginMessageDirectiveProps,
  type MarkdownProps,
} from "@get-bb/plugin-sdk/app";
import {
  FRAME_HEIGHT_BEFORE_FIRST_REPORT,
  FRAME_MAX_HEIGHT,
  FRAME_MIN_HEIGHT,
  frameDocument,
  frameHeight,
  frameResult,
  frameThemeMessage,
  readFrameContentHeight,
  readFrameLinkRequest,
} from "./frame";
import type { inlineVisRpcContract } from "./server.js";
import { appFontCss, useFrameTheme } from "./theme";

type PreviewSource = "workspace" | "thread-storage";

type PreviewTarget = NonNullable<
  MarkdownProps["experimental_document"]
>["target"];

type LoadState =
  | { status: "missing-file" }
  | { status: "invalid-height"; message: string }
  | { status: "loading"; file: string }
  | {
      status: "ready";
      kind: "html";
      file: string;
      source: PreviewSource;
      target: PreviewTarget;
      url: string;
      content: string;
      sha256: string;
    }
  | {
      status: "ready";
      kind: "markdown";
      file: string;
      source: PreviewSource;
      target: PreviewTarget;
      rootPath: string;
      content: string;
    }
  | { status: "error"; file: string; message: string };

type ReadyPreview = Extract<LoadState, { status: "ready" }>;
type PreviewCache = Map<string, ReadyPreview>;
const MAX_CACHED_PREVIEWS = 8;
const MAX_REMEMBERED_FRAME_HEIGHTS = 200;
const MAX_REMEMBERED_EXPANDED_DOCUMENTS = 200;

function rememberBounded<Value>(
  cache: Map<string, Value>,
  key: string,
  value: Value,
  limit: number,
): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

const DOCUMENT_PREVIEW_HEIGHT_PX = 256;
const DOCUMENT_PREVIEW_SLACK_PX = 64;
const DOCUMENT_COPIED_MS = 1_500;

function parseRequestedHeight(
  value: string | undefined,
): number | null | "invalid" {
  const normalized = value?.trim() ?? "";
  if (normalized.length === 0) return null;
  if (!/^\d+$/.test(normalized)) return "invalid";
  const height = Number(normalized);
  return height >= FRAME_MIN_HEIGHT && height <= FRAME_MAX_HEIGHT
    ? height
    : "invalid";
}

function isHtmlFile(file: string): boolean {
  return /\.html?$/i.test(file);
}

const DOCUMENT_ACTION_CLASS =
  "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function splitDocumentPath(file: string): { name: string; folder: string } {
  const separator = file.lastIndexOf("/");
  return separator === -1
    ? { name: file, folder: "" }
    : { name: file.slice(separator + 1), folder: file.slice(0, separator) };
}

function DocumentCard({
  file,
  actions,
  footer,
  children,
}: {
  file: string;
  actions: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { name, folder } = splitDocumentPath(file);
  return (
    <section
      aria-label={file}
      className="my-2 min-w-0 overflow-hidden rounded-lg border border-border bg-background"
    >
      <header className="flex items-center gap-2 border-b border-border py-1.5 pl-3 pr-1.5">
        <Icon
          name="FileText"
          aria-hidden
          className="size-3.5 shrink-0 text-subtle-foreground"
        />
        <div className="flex min-w-0 flex-1 items-baseline gap-2 text-xs">
          <span className="truncate font-medium text-foreground">{name}</span>
          {folder.length === 0 ? null : (
            <span className="truncate text-subtle-foreground">{folder}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
      </header>
      {children}
      {footer}
    </section>
  );
}

function CopyDocumentAction({
  file,
  content,
}: {
  file: string;
  content: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), DOCUMENT_COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      aria-label={`Copy ${file}`}
      title={copied ? "Copied" : "Copy Markdown"}
      className={DOCUMENT_ACTION_CLASS}
      onClick={() => {
        void navigator.clipboard.writeText(content).then(
          () => setCopied(true),
          () => undefined,
        );
      }}
    >
      <Icon name={copied ? "Check" : "Copy"} aria-hidden className="size-3.5" />
    </button>
  );
}

const expandedDocuments = new Map<string, true>();

function MarkdownDocument({
  file,
  content,
  previewHeight,
  rememberKey,
  actions,
  children,
}: {
  file: string;
  content: string;
  previewHeight: number;
  rememberKey: string;
  actions: ReactNode;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(() =>
    expandedDocuments.has(rememberKey),
  );
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = contentRef.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setContentHeight(element.getBoundingClientRect().height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const collapsible =
    contentHeight !== null &&
    contentHeight > previewHeight + DOCUMENT_PREVIEW_SLACK_PX;
  const clamped = contentHeight === null || (collapsible && !expanded);
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) {
      rememberBounded(
        expandedDocuments,
        rememberKey,
        true,
        MAX_REMEMBERED_EXPANDED_DOCUMENTS,
      );
    } else {
      expandedDocuments.delete(rememberKey);
    }
  };

  return (
    <DocumentCard
      file={file}
      actions={
        <>
          <CopyDocumentAction file={file} content={content} />
          {actions}
        </>
      }
      footer={
        collapsible ? (
          <button
            type="button"
            aria-expanded={expanded}
            className="flex w-full cursor-pointer items-center justify-center gap-1 border-t border-border py-1.5 text-xs text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={toggle}
          >
            {expanded ? "Show less" : "Show more"}
            <Icon
              name="ChevronDown"
              aria-hidden
              className={cn(
                "size-3.5 transition-transform duration-200",
                expanded && "rotate-180",
              )}
            />
          </button>
        ) : undefined
      }
    >
      <div
        data-inline-vis-document=""
        className="relative overflow-hidden"
        style={clamped ? { maxHeight: previewHeight } : undefined}
      >
        <div ref={contentRef} className="px-4 py-3">
          {children}
        </div>
        {collapsible && !expanded ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background to-transparent"
          />
        ) : null}
      </div>
    </DocumentCard>
  );
}

const FRAME_OPEN_ACTION_CLASS =
  "flex size-6 cursor-pointer items-center justify-center rounded-md border border-border bg-background/90 text-muted-foreground shadow-xs transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function isModifiedClick(event: ReactMouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button !== 0 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  );
}

function newPageClickHint(): string {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  return /Mac|iPhone|iPad/.test(platform) ? "⌘-click" : "Ctrl-click";
}

function OpenPreviewAction({
  file,
  pageUrl,
  onOpenPreview,
  icon,
  className,
}: {
  file: string;
  pageUrl: string | null;
  onOpenPreview: () => void;
  icon: "PanelRight" | "Maximize2";
  className: string;
}) {
  const glyph = (
    <Icon
      name={icon}
      aria-hidden
      className={pageUrl === null ? "size-3.5" : "size-3"}
    />
  );
  if (pageUrl === null) {
    return (
      <button
        type="button"
        aria-label={`Open ${file} in sidebar`}
        title="Open in sidebar"
        className={className}
        onClick={onOpenPreview}
      >
        {glyph}
      </button>
    );
  }
  return (
    <a
      href={pageUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${file} in sidebar`}
      title={`Open in sidebar\n${newPageClickHint()} to open in the browser`}
      className={className}
      onClick={(event) => {
        if (event.defaultPrevented || isModifiedClick(event)) return;
        event.preventDefault();
        onOpenPreview();
      }}
    >
      {glyph}
    </a>
  );
}

const rememberedFrameHeights = new Map<string, number>();

function HtmlFrame({
  title,
  content,
  baseHref,
  heightKey,
  requested,
  action,
}: {
  title: string;
  content: string;
  baseHref: string;
  heightKey: string;
  requested: number | null;
  action: ReactNode;
}) {
  const theme = useFrameTheme();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const latestTheme = useRef(theme);
  useLayoutEffect(() => {
    latestTheme.current = theme;
  }, [theme]);
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void appFontCss().then((fontCss) => {
      if (!live) return;
      const options = { theme: latestTheme.current, baseHref, fontCss };
      setSrcDoc(frameDocument(content, options));
    });
    return () => {
      live = false;
    };
  }, [content, baseHref]);
  const [loaded, setLoaded] = useState(false);
  const [contentHeight, setContentHeight] = useState<number>();
  const height = frameHeight({
    requested,
    contentHeight,
    remembered: rememberedFrameHeights.get(heightKey),
  });

  const postTheme = () => {
    const message = frameThemeMessage(theme);
    frameRef.current?.contentWindow?.postMessage(message, "*");
  };
  useEffect(postTheme, [theme]);

  useLayoutEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (frame === null || event.source !== frame.contentWindow) return;
      const reported = readFrameContentHeight(event.data);
      if (reported !== undefined) {
        rememberBounded(
          rememberedFrameHeights,
          heightKey,
          reported,
          MAX_REMEMBERED_FRAME_HEIGHTS,
        );
        setContentHeight(reported);
        return;
      }
      const link = readFrameLinkRequest(event.data);
      if (
        link === undefined ||
        document.activeElement !== frame ||
        navigator.userActivation?.isActive === false
      ) {
        return;
      }
      window.open(link.url, "_blank", "noopener,noreferrer");
      frame.contentWindow?.postMessage(frameResult(link.id), "*");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [heightKey]);

  return (
    <div
      data-inline-vis-frame=""
      className="group/inline-vis relative my-2"
      style={{ height }}
    >
      {srcDoc === null ? null : (
        <iframe
          ref={frameRef}
          title={title}
          srcDoc={srcDoc}
          sandbox="allow-scripts allow-forms"
          onLoad={() => {
            setLoaded(true);
            postTheme();
          }}
          className="block size-full border-0"
          style={{ colorScheme: loaded ? theme.appearance : "light" }}
        />
      )}
      <div className="absolute right-2 top-2 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/inline-vis:opacity-100 pointer-coarse:opacity-100">
        {action}
      </div>
    </div>
  );
}

function InlineVisDirective({
  attributes,
  source,
  message,
  previewCache,
}: PluginMessageDirectiveProps & { previewCache: PreviewCache }) {
  const rpc = useRpc<typeof inlineVisRpcContract>();
  const navigate = useBbNavigate();
  const fileAttr = attributes.file?.trim() ?? "";
  const sourceAttr = attributes.source;
  const heightAttr = attributes.height;
  const parsedHeight = parseRequestedHeight(heightAttr);
  const requestedHeight = parsedHeight === "invalid" ? null : parsedHeight;
  const heightError =
    parsedHeight === "invalid"
      ? `inline-vis height must be a whole number from ${FRAME_MIN_HEIGHT} to ${FRAME_MAX_HEIGHT} pixels.`
      : null;
  const cacheKey = JSON.stringify([
    message.threadId,
    message.id,
    sourceAttr ?? "workspace",
    fileAttr,
  ]);
  const [state, setState] = useState<LoadState>(() =>
    heightError
      ? { status: "invalid-height", message: heightError }
      : fileAttr
        ? (previewCache.get(cacheKey) ?? { status: "loading", file: fileAttr })
        : { status: "missing-file" },
  );
  useEffect(() => {
    if (heightError) {
      setState({ status: "invalid-height", message: heightError });
      return;
    }
    if (!fileAttr) {
      setState({ status: "missing-file" });
      return;
    }
    let cancelled = false;
    const cachedPreview = previewCache.get(cacheKey);
    setState(cachedPreview ?? { status: "loading", file: fileAttr });

    void (async () => {
      try {
        const result = await rpc.call("preparePreview", {
          threadId: message.threadId,
          file: fileAttr,
          ...(sourceAttr === undefined ? {} : { source: sourceAttr }),
        });
        if (cancelled) return;
        if (result.kind === "not-found") {
          previewCache.delete(cacheKey);
          setState({
            status: "error",
            file: result.file,
            message: `Preview file not found: ${result.file}`,
          });
          return;
        }
        const preview: ReadyPreview = { status: "ready", ...result };
        rememberBounded(previewCache, cacheKey, preview, MAX_CACHED_PREVIEWS);
        setState(preview);
      } catch (error) {
        if (cancelled || cachedPreview) return;
        setState({
          status: "error",
          file: fileAttr,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    cacheKey,
    fileAttr,
    heightError,
    message.threadId,
    previewCache,
    rpc,
    sourceAttr,
  ]);

  if (state.status === "missing-file") {
    return (
      <div
        role="alert"
        className="my-2 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
        title={source}
      >
        inline-vis requires a file attribute, e.g.{" "}
        <code>::inline-vis{'{file="demo.html"}'}</code>
      </div>
    );
  }

  if (state.status === "invalid-height") {
    return (
      <div
        role="alert"
        className="my-2 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
        title={source}
      >
        {state.message}
      </div>
    );
  }

  if (state.status === "loading") {
    if (isHtmlFile(state.file)) {
      return (
        <div
          role="status"
          aria-busy="true"
          aria-label={`Loading visualization ${state.file}`}
          style={{
            height: requestedHeight ?? FRAME_HEIGHT_BEFORE_FIRST_REPORT,
          }}
          className="my-2"
        />
      );
    }
    return (
      <DocumentCard
        file={state.file}
        actions={<span aria-hidden className="size-6 shrink-0" />}
      >
        <div
          role="status"
          aria-busy="true"
          aria-label={`Loading document ${state.file}`}
          className="flex flex-col gap-2.5 px-4 py-4"
        >
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      </DocumentCard>
    );
  }

  if (state.status === "error") {
    return (
      <div
        role="alert"
        className="my-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        title={source}
      >
        Failed to load {state.file}: {state.message}
      </div>
    );
  }

  const openPreview = () => {
    navigate.experimental_openFilePreview({
      target: state.target,
      location: null,
    });
  };

  if (state.kind === "html") {
    return (
      <HtmlFrame
        key={state.sha256}
        title={`inline-vis: ${state.file}`}
        content={state.content}
        baseHref={new URL(state.url, window.location.href).href}
        heightKey={state.sha256}
        requested={requestedHeight}
        action={
          <OpenPreviewAction
            file={state.file}
            pageUrl={state.url}
            onOpenPreview={openPreview}
            icon="Maximize2"
            className={FRAME_OPEN_ACTION_CLASS}
          />
        }
      />
    );
  }

  return (
    <MarkdownDocument
      file={state.file}
      content={state.content}
      previewHeight={requestedHeight ?? DOCUMENT_PREVIEW_HEIGHT_PX}
      rememberKey={cacheKey}
      actions={
        <OpenPreviewAction
          file={state.file}
          pageUrl={null}
          onOpenPreview={openPreview}
          icon="PanelRight"
          className={DOCUMENT_ACTION_CLASS}
        />
      }
    >
      <Markdown
        content={state.content}
        experimental_document={{
          threadId: message.threadId,
          rootPath: state.rootPath,
          target: state.target,
        }}
      />
    </MarkdownDocument>
  );
}

function InlineVisFence({
  code,
  status,
  index,
  message,
  Original,
}: ExperimentalCodeFenceRendererProps) {
  const [sourceShown, setSourceShown] = useState(false);

  if (status === "streaming") {
    return (
      <div role="status" className="my-2 text-xs text-muted-foreground">
        Writing visualization…
      </div>
    );
  }
  if (status === "unclosed" || code.trim().length === 0) {
    return <Original />;
  }

  const sourceLabel = sourceShown ? "Hide source" : "Show source";
  return (
    <>
      <HtmlFrame
        title="inline-vis"
        content={code}
        baseHref={new URL("/", window.location.href).href}
        heightKey={`fence:${message.id}:${index}`}
        requested={null}
        action={
          <button
            type="button"
            aria-pressed={sourceShown}
            aria-label={sourceLabel}
            title={sourceLabel}
            className={FRAME_OPEN_ACTION_CLASS}
            onClick={() => setSourceShown(!sourceShown)}
          >
            <Icon name="Code" aria-hidden className="size-3" />
          </button>
        }
      />
      {sourceShown ? <Original /> : null}
    </>
  );
}

export default definePluginApp((app) => {
  const previewCache: PreviewCache = new Map();
  app.slots.messageDirective({
    id: "inline-vis",
    component: (props) => (
      <InlineVisDirective
        key={JSON.stringify([
          props.message.threadId,
          props.message.id,
          props.attributes.source ?? "workspace",
          props.attributes.file?.trim() ?? "",
        ])}
        {...props}
        previewCache={previewCache}
      />
    ),
  });
  app.slots.experimental_codeFenceRenderer({
    id: "inline-vis",
    languages: ["inline-vis"],
    component: InlineVisFence,
  });
});
