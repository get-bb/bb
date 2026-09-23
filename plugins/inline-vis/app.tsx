import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { toast } from "sonner";
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

const PREVIEW_ROUTE = {
  workspace: "worktree/files",
  "thread-storage": "thread-storage/files",
} as const satisfies Record<PreviewSource, string>;

type LoadState =
  | { status: "missing-file" }
  | { status: "invalid-height"; message: string }
  | { status: "loading"; file: string }
  | {
      status: "ready";
      kind: "html";
      file: string;
      source: PreviewSource;
      content: string;
      target: PreviewTarget;
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
const EXPORT_ENDPOINT = "/api/v1/files/export";
const PRINT_IFRAME_SANDBOX = "allow-scripts allow-modals";
const CAPTURE_IFRAME_SANDBOX = "allow-scripts";
const PRINT_IFRAME_REMOVE_DELAY_MS = 60_000;
const CAPTURE_TIMEOUT_MS = 15_000;
const POST_MESSAGE_CHANNEL = "bb-document-export";
const RENDERED_CONTENT_PATTERN = /<(?:canvas|svg|script)\b/i;
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

function encodePathSegments(file: string): string {
  return file.split("/").map(encodeURIComponent).join("/");
}

function buildPreviewUrl(
  threadId: string,
  file: string,
  source: PreviewSource,
): string {
  return `/api/v1/threads/${encodeURIComponent(threadId)}/${PREVIEW_ROUTE[source]}/${encodePathSegments(file)}`;
}

function artifactBaseName(file: string): string {
  const name = file.split("/").pop() ?? file;
  const extensionIndex = name.lastIndexOf(".");
  return extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function printHtmlDocument(html: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", PRINT_IFRAME_SANDBOX);
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("tabindex", "-1");
  iframe.style.position = "fixed";
  iframe.style.top = "0";
  iframe.style.left = "0";
  iframe.style.width = "1024px";
  iframe.style.height = "768px";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  iframe.style.border = "0";
  iframe.srcdoc = html;
  document.body.append(iframe);
  window.setTimeout(() => iframe.remove(), PRINT_IFRAME_REMOVE_DELAY_MS);
}

async function requestExport(input: {
  baseHref: string;
  content: string;
  fileName: string;
  format: "docx" | "print" | "capture";
  sourceKind: "html" | "markdown";
}): Promise<Blob> {
  const response = await fetch(EXPORT_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      baseHref: input.baseHref,
      content: input.content,
      filename: input.fileName,
      format: input.format,
      sourceKind: input.sourceKind,
    }),
  });
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(raw.replace(/\s+/g, " ").trim() || `Export failed (${response.status})`);
  }
  return response.blob();
}

function hasRenderedContent(content: string): boolean {
  return RENDERED_CONTENT_PATTERN.test(content);
}

function runCaptureFrame(html: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", CAPTURE_IFRAME_SANDBOX);
    iframe.setAttribute("aria-hidden", "true");
    iframe.setAttribute("tabindex", "-1");
    iframe.style.position = "fixed";
    iframe.style.top = "0";
    iframe.style.left = "0";
    iframe.style.width = "1024px";
    iframe.style.height = "768px";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";
    iframe.style.border = "0";

    let settled = false;
    const cleanup = (): void => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      iframe.remove();
    };
    const finish = (result: { html: string } | { error: string }): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if ("html" in result) {
        resolve(result.html);
        return;
      }
      reject(new Error(result.error));
    };
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== iframe.contentWindow) return;
      const data: unknown = event.data;
      if (typeof data !== "object" || data === null) return;
      const message = data as {
        channel?: unknown;
        ok?: unknown;
        html?: unknown;
        error?: unknown;
      };
      if (message.channel !== POST_MESSAGE_CHANNEL) return;
      if (message.ok === true && typeof message.html === "string") {
        finish({ html: message.html });
        return;
      }
      finish({
        error:
          typeof message.error === "string"
            ? message.error
            : "Rendered capture failed",
      });
    };
    const timeout = window.setTimeout(() => {
      finish({ error: "Rendered capture timed out" });
    }, CAPTURE_TIMEOUT_MS);

    window.addEventListener("message", onMessage);
    iframe.srcdoc = html;
    document.body.append(iframe);
  });
}

function reportExportError(error: unknown): void {
  toast.error(error instanceof Error ? error.message : String(error));
}

function InlineVisExportMenu({
  content,
  file,
  kind,
  threadId,
  source,
}: {
  content: string;
  file: string;
  kind: "html" | "markdown";
  threadId: string;
  source: PreviewSource;
}) {
  const [busy, setBusy] = useState(false);
  const baseName = artifactBaseName(file);
  const sourceExtension = kind === "markdown" ? "md" : "html";
  const sourceMimeType = kind === "markdown" ? "text/markdown" : "text/html";
  const baseHref = new URL(
    buildPreviewUrl(threadId, file, source),
    window.location.href,
  ).toString();

  const exportDocument = (format: "print") => {
    setBusy(true);
    void requestExport({
      baseHref,
      content,
      fileName: file,
      format,
      sourceKind: kind,
    })
      .then(async (blob) => {
        printHtmlDocument(await blob.text());
      })
      .catch(reportExportError)
      .finally(() => {
        setBusy(false);
      });
  };

  const exportWord = () => {
    setBusy(true);
    void (async () => {
      try {
        let wordContent = content;
        let wordSourceKind: "html" | "markdown" = kind;
        if (kind === "html" && hasRenderedContent(content)) {
          try {
            const captureBlob = await requestExport({
              baseHref,
              content,
              fileName: file,
              format: "capture",
              sourceKind: kind,
            });
            wordContent = await runCaptureFrame(await captureBlob.text());
            wordSourceKind = "html";
          } catch {
            wordContent = content;
            wordSourceKind = kind;
          }
        }
        const blob = await requestExport({
          baseHref,
          content: wordContent,
          fileName: file,
          format: "docx",
          sourceKind: wordSourceKind,
        });
        downloadBlob(blob, `${baseName}.docx`);
      } catch (error) {
        reportExportError(error);
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={busy}
          aria-label={`Export ${file}`}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Icon name="Download" aria-hidden className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => {
            downloadBlob(
              new Blob([content], { type: sourceMimeType }),
              `${baseName}.${sourceExtension}`,
            );
          }}
        >
          Save {kind === "markdown" ? "Markdown" : "HTML"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={exportWord}>
          Word (.docx)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => exportDocument("print")}>
          Печать
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-background">
      <div
        className={`flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground ${collapsed ? "" : "border-b border-border"}`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 font-semibold">inline-vis</span>
          <span className="truncate opacity-70">{file}</span>
        </div>
        {action}
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} visualization ${file}`}
          title={collapsed ? "Expand visualization" : "Collapse visualization"}
          className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => onCollapsedChange(!collapsed)}
        >
          <Icon
            name={collapsed ? "ChevronRight" : "ChevronDown"}
            aria-hidden
            className="size-3"
          />
        </button>
      </div>
      {collapsed ? null : children}
    </div>
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
        action={<span aria-hidden className="size-5 shrink-0" />}
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
        <>
          <button
            type="button"
            aria-label={`Open ${state.file} in sidebar`}
            title="Open in sidebar"
            className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => {
              navigate.experimental_openFilePreview({
                target: state.target,
                location: null,
              });
            }}
          >
            <Icon name="ExternalLink" aria-hidden className="size-3" />
          </button>
          <InlineVisExportMenu
            content={state.content}
            file={state.file}
            kind={state.kind}
            source={state.source}
            threadId={message.threadId}
          />
        </>
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
          src={buildPreviewUrl(message.threadId, state.file, state.source)}
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
