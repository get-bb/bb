import {
  useEffect,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { Icon } from "@/components/ui/icon";
import {
  CONTEXT_CARD_CLASS,
  CONTEXT_CARD_INSET_CLASS,
  CONTEXT_CARD_SEGMENT_CLASS,
  CONTEXT_CARD_CHEVRON_CLASS,
} from "@/components/ui/chrome-style-tokens";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  definePluginApp,
  Markdown,
  useBbNavigate,
  useRpc,
  type PluginMessageDirectiveProps,
  type MarkdownProps,
} from "@get-bb/plugin-sdk/app";
import type { inlineVisRpcContract } from "./server.js";

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

const DEFAULT_HEIGHT_PX = 224;
const MIN_HEIGHT_PX = 120;
const MAX_HEIGHT_PX = 1_200;
const COLLAPSED_STORAGE_KEY = "bb.inline-vis.collapsed";

function readCollapsedPreference(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "true"
    );
  } catch {
    return false;
  }
}

function writeCollapsedPreference(collapsed: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch {
    return;
  }
}

function parsePreviewHeight(value: string | undefined): number | null {
  const normalized = value?.trim() ?? "";
  if (normalized.length === 0) return DEFAULT_HEIGHT_PX;
  if (!/^\d+$/.test(normalized)) return null;
  const height = Number(normalized);
  return Number.isSafeInteger(height) &&
    height >= MIN_HEIGHT_PX &&
    height <= MAX_HEIGHT_PX
    ? height
    : null;
}

function PreviewCard({
  file,
  action,
  collapsed,
  onCollapsedChange,
  children,
}: {
  file: string;
  action: ReactNode;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className={cn("my-2 overflow-hidden", CONTEXT_CARD_CLASS)}>
      <div
        className={cn(
          "flex items-stretch text-xs text-muted-foreground",
          !collapsed && "border-b border-border",
        )}
      >
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} visualization ${file}`}
          title={collapsed ? "Expand preview here" : "Collapse preview"}
          className={cn(
            "flex cursor-pointer items-center text-xs",
            CONTEXT_CARD_SEGMENT_CLASS,
            "min-w-0 flex-1 gap-1.5 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
            collapsed ? "text-muted-foreground" : "text-foreground",
          )}
          onClick={() => onCollapsedChange(!collapsed)}
        >
          <span className="shrink-0">inline-vis</span>
          <span className="truncate">{file}</span>
          <Icon
            name="ChevronDown"
            aria-hidden
            className={cn(
              CONTEXT_CARD_CHEVRON_CLASS,
              !collapsed && "rotate-180",
            )}
          />
        </button>
        <div
          className={cn("flex shrink-0 items-center", CONTEXT_CARD_INSET_CLASS)}
        >
          {action}
        </div>
      </div>
      {collapsed ? null : children}
    </div>
  );
}

const OPEN_ACTION_CLASS = cn(
  "flex cursor-pointer items-center text-xs",
  CONTEXT_CARD_SEGMENT_CLASS,
  "shrink-0 justify-center text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
);

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
}: {
  file: string;
  pageUrl: string | null;
  onOpenPreview: () => void;
}) {
  const icon = <Icon name="ExternalLink" aria-hidden className="size-3" />;
  if (pageUrl === null) {
    return (
      <button
        type="button"
        aria-label={`Open ${file} in sidebar`}
        title="Open in sidebar"
        className={OPEN_ACTION_CLASS}
        onClick={onOpenPreview}
      >
        {icon}
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
      className={OPEN_ACTION_CLASS}
      onClick={(event) => {
        if (event.defaultPrevented || isModifiedClick(event)) return;
        event.preventDefault();
        onOpenPreview();
      }}
    >
      {icon}
    </a>
  );
}

function InlineVisDirective({
  attributes,
  source,
  message,
}: PluginMessageDirectiveProps) {
  const rpc = useRpc<typeof inlineVisRpcContract>();
  const navigate = useBbNavigate();
  const fileAttr = attributes.file?.trim() ?? "";
  const sourceAttr = attributes.source;
  const heightAttr = attributes.height;
  const previewHeight = parsePreviewHeight(heightAttr);
  const heightError =
    previewHeight === null
      ? `inline-vis height must be a whole number from ${MIN_HEIGHT_PX} to ${MAX_HEIGHT_PX} pixels.`
      : null;
  const [state, setState] = useState<LoadState>(() =>
    heightError
      ? { status: "invalid-height", message: heightError }
      : fileAttr
        ? { status: "loading", file: fileAttr }
        : { status: "missing-file" },
  );
  const [collapsed, setCollapsed] = useState(readCollapsedPreference);

  const handleCollapsedChange = (nextCollapsed: boolean) => {
    setCollapsed(nextCollapsed);
    writeCollapsedPreference(nextCollapsed);
  };

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
    setState({ status: "loading", file: fileAttr });

    void (async () => {
      try {
        const result = await rpc.call("preparePreview", {
          threadId: message.threadId,
          file: fileAttr,
          ...(sourceAttr === undefined ? {} : { source: sourceAttr }),
        });
        if (cancelled) return;
        setState({ status: "ready", ...result });
      } catch (error) {
        if (cancelled) return;
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
  }, [fileAttr, heightError, message.threadId, rpc, sourceAttr]);

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
    return (
      <PreviewCard
        file={state.file}
        action={<span aria-hidden className="h-6 w-7 shrink-0" />}
        collapsed={collapsed}
        onCollapsedChange={handleCollapsedChange}
      >
        <div
          role="status"
          aria-busy="true"
          aria-label={`Loading visualization ${state.file}`}
          style={{ height: previewHeight ?? DEFAULT_HEIGHT_PX }}
          className="w-full p-3"
        >
          <Skeleton className="size-full" />
        </div>
      </PreviewCard>
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

  return (
    <PreviewCard
      file={state.file}
      collapsed={collapsed}
      onCollapsedChange={handleCollapsedChange}
      action={
        <OpenPreviewAction
          file={state.file}
          pageUrl={state.kind === "html" ? state.url : null}
          onOpenPreview={() => {
            navigate.experimental_openFilePreview({
              target: state.target,
              location: null,
            });
          }}
        />
      }
    >
      {state.kind === "markdown" ? (
        <div
          style={{ height: previewHeight ?? DEFAULT_HEIGHT_PX }}
          className="overflow-auto p-3"
        >
          <Markdown
            content={state.content}
            experimental_document={{
              threadId: message.threadId,
              rootPath: state.rootPath,
              target: state.target,
            }}
          />
        </div>
      ) : (
        <iframe
          title={`inline-vis: ${state.file}`}
          src={state.url}
          sandbox="allow-scripts"
          style={{ height: previewHeight ?? DEFAULT_HEIGHT_PX }}
          className="block w-full border-0 bg-background"
        />
      )}
    </PreviewCard>
  );
}

export default definePluginApp((app) => {
  app.slots.messageDirective({
    id: "inline-vis",
    component: InlineVisDirective,
  });
});
