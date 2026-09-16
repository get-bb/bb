import { useMemo, useState, type ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";
import {
  definePluginApp,
  experimental_SourceCode as SourceCode,
  useBbNavigate,
  type PluginMessageDirectiveProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import type { TypstMdSource } from "./server.js";
import { TypstArtifactActions } from "./components/typst-artifact-actions.js";
import { TypstSheet } from "./components/typst-sheet.js";
import { directiveSource } from "./lib/artifact-source.js";
import { buildSourceBaseHref, requestMarkdownDocx } from "./lib/docx-export.js";
import { parseTypstMdPanelTarget } from "./lib/panel-target.js";
import { rasterizeTypstPages } from "./lib/typst-raster.js";
import { useTypstDocument } from "./lib/use-typst-document.js";

const DEFAULT_HEIGHT_PX = 224;
const MIN_HEIGHT_PX = 120;
const MAX_HEIGHT_PX = 1_200;
const PANEL_ACTION_ID = "document";

const ACTION_BUTTON_CLASS =
  "inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const SOURCE_TOGGLE_CLASS =
  "shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 font-medium text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

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

function Alert({
  children,
  destructive = false,
  title,
}: {
  children: ReactNode;
  destructive?: boolean;
  title?: string;
}) {
  return (
    <div
      role="alert"
      title={title}
      className={
        destructive
          ? "my-2 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          : "my-2 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
      }
    >
      {children}
    </div>
  );
}

function TryAgainButton({
  file,
  onRetry,
}: {
  file: string;
  onRetry: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Try again for ${file}`}
      className="shrink-0 cursor-pointer rounded-md px-2 py-0.5 font-medium hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      onClick={onRetry}
    >
      Try again
    </button>
  );
}

interface TypstMdDocumentViewProps {
  file: string;
  source: TypstMdSource;
  height: number | null;
  variant: "card" | "panel";
  openInSidebar: (() => void) | null;
}

function TypstMdDocumentView({
  file,
  source,
  height,
  variant,
  openInSidebar,
}: TypstMdDocumentViewProps) {
  const { reload, state } = useTypstDocument({ file, source });
  const [view, setView] = useState<"rendered" | "source">("rendered");
  const panel = variant === "panel";
  const sourceKind =
    source.kind === "thread-storage" ? "thread-storage" : "workspace";
  const baseHref = useMemo(
    () =>
      buildSourceBaseHref({
        threadId: source.threadId,
        file,
        sourceKind,
      }),
    [source.threadId, sourceKind, file],
  );

  if (state.status === "error") {
    const alert = (
      <div
        role="alert"
        className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        <span className="min-w-0 flex-1">
          Failed to render {state.file}: {state.message}
        </span>
        <TryAgainButton file={state.file} onRetry={reload} />
      </div>
    );
    return panel ? (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-md">{alert}</div>
      </div>
    ) : (
      <div className="my-2">{alert}</div>
    );
  }

  const ready = state.status === "ready";
  const fileName = ready ? state.file : file;

  return (
    <div
      className={
        panel
          ? "flex h-full min-h-0 flex-col bg-background"
          : "my-2 overflow-hidden rounded-lg border border-border bg-background"
      }
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 font-semibold">typst-md</span>
          <span className="truncate opacity-70">{fileName}</span>
        </div>
        {ready ? (
          <>
            <button
              type="button"
              aria-label={
                view === "source"
                  ? `Show rendered ${state.file}`
                  : `Show Markdown source ${state.file}`
              }
              title={
                view === "source"
                  ? "Show rendered document"
                  : "Show Markdown source"
              }
              className={SOURCE_TOGGLE_CLASS}
              onClick={() => {
                setView((current) =>
                  current === "source" ? "rendered" : "source",
                );
              }}
            >
              {view === "source" ? "Rendered" : "Source"}
            </button>
            {openInSidebar === null ? null : (
              <button
                type="button"
                aria-label={`Open ${fileName} in sidebar`}
                title="Open in sidebar"
                className={ACTION_BUTTON_CLASS}
                onClick={openInSidebar}
              >
                <Icon name="ExternalLink" aria-hidden className="size-3" />
              </button>
            )}
            <TypstArtifactActions
              fileName={state.file}
              svg={state.svg}
              markdown={state.content}
              loadDocx={() =>
                requestMarkdownDocx({
                  baseHref,
                  content: state.content,
                  fileName: state.file,
                })
              }
              loadPdf={() => state.document.pdf()}
              loadPngs={() => state.document.svg.then(rasterizeTypstPages)}
            />
            <button
              type="button"
              aria-label={`Re-render ${state.file}`}
              title="Re-render"
              className={ACTION_BUTTON_CLASS}
              onClick={reload}
            >
              <Icon name="RotateCcw" aria-hidden className="size-3" />
            </button>
          </>
        ) : openInSidebar === null ? null : (
          <span aria-hidden className="size-5 shrink-0" />
        )}
      </div>
      {ready ? (
        view === "source" ? (
          <div
            style={height === null ? undefined : { height }}
            className={
              panel
                ? "min-h-0 flex-1 overflow-auto bg-muted p-4"
                : "overflow-auto bg-muted p-3"
            }
          >
            <SourceCode
              content={state.content}
              path={state.file}
              overflow="wrap"
            />
          </div>
        ) : (
          <TypstSheet
            svg={state.svg}
            style={height === null ? undefined : { height }}
            viewportClassName={
              panel
                ? "min-h-0 flex-1 overflow-auto bg-muted p-4"
                : "overflow-auto bg-muted p-3"
            }
          />
        )
      ) : (
        <div
          role="status"
          aria-busy="true"
          aria-label={`Rendering Markdown document ${file}`}
          style={height === null ? undefined : { height }}
          className={
            panel
              ? "flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"
              : "w-full p-3"
          }
        >
          {panel ? (
            <>
              <span className="size-4 animate-spin rounded-full border-2 border-border border-t-foreground" />
              Rendering Markdown document…
            </>
          ) : (
            <Skeleton className="size-full" />
          )}
        </div>
      )}
    </div>
  );
}

function TypstMdDirective({
  attributes,
  source,
  message,
  openWorkspaceFile,
}: PluginMessageDirectiveProps) {
  const navigate = useBbNavigate();
  const fileAttr = attributes.file?.trim() ?? "";
  const sourceAttr = attributes.source;
  const previewHeight = parsePreviewHeight(attributes.height);
  const heightError =
    previewHeight === null
      ? `typst-md height must be a whole number from ${MIN_HEIGHT_PX} to ${MAX_HEIGHT_PX} pixels.`
      : null;
  const sourceResult = useMemo(
    () => directiveSource(message.threadId, sourceAttr),
    [message.threadId, sourceAttr],
  );

  if (heightError !== null) {
    return <Alert title={source}>{heightError}</Alert>;
  }

  if (!sourceResult.ok) {
    return <Alert title={source}>{sourceResult.message}</Alert>;
  }

  if (fileAttr.length === 0) {
    return (
      <Alert title={source}>
        typst-md requires a file attribute, e.g.{" "}
        <code>::typst-md{'{file="report.md"}'}</code>
      </Alert>
    );
  }

  const sourceParam =
    sourceResult.source.kind === "thread-storage" ? "thread-storage" : "workspace";
  const openInSidebar = (): void => {
    const opened = navigate.openThreadPanel({
      actionId: PANEL_ACTION_ID,
      title: fileAttr,
      params: { file: fileAttr, source: sourceParam },
    });
    if (!opened && sourceParam === "workspace") openWorkspaceFile?.(fileAttr);
  };

  return (
    <TypstMdDocumentView
      file={fileAttr}
      source={sourceResult.source}
      height={previewHeight ?? DEFAULT_HEIGHT_PX}
      variant="card"
      openInSidebar={openInSidebar}
    />
  );
}

function TypstMdPanel({ threadId, params }: PluginThreadPanelProps) {
  const target = useMemo(
    () => parseTypstMdPanelTarget({ threadId, params }),
    [threadId, params],
  );

  if (target === null) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Open a typst-md card from a message to view it here.
      </div>
    );
  }

  return (
    <TypstMdDocumentView
      key={`${target.source.kind}:${target.file}`}
      file={target.file}
      source={target.source}
      height={null}
      variant="panel"
      openInSidebar={null}
    />
  );
}

export default definePluginApp((app) => {
  app.slots.messageDirective({
    id: "typst-md",
    component: TypstMdDirective,
  });
  app.slots.threadPanelAction({
    id: PANEL_ACTION_ID,
    title: "Markdown document",
    icon: "FileText",
    layout: "flush",
    component: TypstMdPanel,
  });
});
