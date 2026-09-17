import { useMemo, type ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";
import {
  definePluginApp,
  type PluginFileOpenerProps,
  type PluginMessageDirectiveProps,
} from "@get-bb/plugin-sdk/app";
import { TypstArtifactActions } from "./components/typst-artifact-actions.js";
import { TypstSheet } from "./components/typst-sheet.js";
import { directiveSource, openedSource } from "./lib/artifact-source.js";
import { rasterizeTypstPages } from "./lib/typst-raster.js";
import { useTypstDocument } from "./lib/use-typst-document.js";

const DEFAULT_HEIGHT_PX = 224;
const MIN_HEIGHT_PX = 120;
const MAX_HEIGHT_PX = 1_200;

const ACTION_BUTTON_CLASS =
  "inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

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

function TypstDirective({
  attributes,
  source,
  message,
  openWorkspaceFile,
}: PluginMessageDirectiveProps) {
  const fileAttr = attributes.file?.trim() ?? "";
  const sourceAttr = attributes.source;
  const previewHeight = parsePreviewHeight(attributes.height);
  const heightError =
    previewHeight === null
      ? `typst-inline height must be a whole number from ${MIN_HEIGHT_PX} to ${MAX_HEIGHT_PX} pixels.`
      : null;
  const sourceResult = useMemo(
    () => directiveSource(message.threadId, sourceAttr),
    [message.threadId, sourceAttr],
  );
  const { reload, state } = useTypstDocument({
    file: fileAttr,
    source: heightError === null && sourceResult.ok ? sourceResult.source : null,
  });

  if (heightError !== null) {
    return <Alert title={source}>{heightError}</Alert>;
  }

  if (!sourceResult.ok) {
    return <Alert title={source}>{sourceResult.message}</Alert>;
  }

  if (fileAttr.length === 0) {
    return (
      <Alert title={source}>
        typst-inline requires a file attribute, e.g.{" "}
        <code>::typst{'{file="report.typ"}'}</code>
      </Alert>
    );
  }

  if (state.status === "loading" || state.status === "missing-file") {
    return (
      <div className="my-2 overflow-hidden rounded-lg border border-border bg-background">
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0 font-semibold">typst</span>
            <span className="truncate opacity-70">{fileAttr}</span>
          </div>
          {openWorkspaceFile === null ? null : (
            <span aria-hidden className="size-5 shrink-0" />
          )}
        </div>
        <div
          role="status"
          aria-busy="true"
          aria-label={`Rendering Typst document ${fileAttr}`}
          style={{ height: previewHeight ?? DEFAULT_HEIGHT_PX }}
          className="w-full p-3"
        >
          <Skeleton className="size-full" />
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <Alert destructive title={source}>
        <span className="min-w-0 flex-1">
          Failed to render {state.file}: {state.message}
        </span>
        <TryAgainButton file={state.file} onRetry={reload} />
      </Alert>
    );
  }

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 font-semibold">typst</span>
          <span className="truncate opacity-70">{state.file}</span>
        </div>
        {sourceResult.source.kind === "thread-workspace" &&
        openWorkspaceFile !== null ? (
          <button
            type="button"
            aria-label={`Open ${state.file} in sidebar`}
            title="Open in sidebar"
            className={ACTION_BUTTON_CLASS}
            onClick={() => {
              openWorkspaceFile(state.file);
            }}
          >
            <Icon name="ExternalLink" aria-hidden className="size-3" />
          </button>
        ) : null}
        <TypstArtifactActions
          fileName={state.file}
          svg={state.svg}
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
      </div>
      <TypstSheet
        pages={state.pages}
        style={{ height: previewHeight ?? DEFAULT_HEIGHT_PX }}
        viewportClassName="overflow-auto bg-muted p-3"
      />
    </div>
  );
}

function TypstFileOpener({ path, source, Original }: PluginFileOpenerProps) {
  const artifactSource = useMemo(
    () => openedSource(source),
    [
      source.environmentId,
      source.experimental_hostId,
      source.kind,
      source.projectId,
      source.threadId,
    ],
  );
  const { reload, state } = useTypstDocument({
    file: path,
    source: artifactSource,
  });

  if (artifactSource === null) return <Original />;

  if (state.status === "error") {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <div className="max-w-md space-y-3 text-center" role="alert">
          <p className="text-sm text-destructive">
            Failed to render {state.file}: {state.message}
          </p>
          <button
            type="button"
            aria-label={`Try again for ${state.file}`}
            className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={reload}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (state.status === "loading" || state.status === "missing-file") {
    return (
      <div
        className="flex h-full min-h-0 items-center justify-center gap-2 text-sm text-muted-foreground"
        role="status"
        aria-busy="true"
        aria-label={`Rendering Typst document ${path}`}
      >
        <span className="size-4 animate-spin rounded-full border-2 border-border border-t-foreground" />
        Rendering Typst document…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 font-semibold">typst</span>
          <span className="truncate opacity-70">{state.file}</span>
        </div>
        <TypstArtifactActions
          fileName={state.file}
          svg={state.svg}
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
      </div>
      <TypstSheet
        pages={state.pages}
        viewportClassName="min-h-0 flex-1 overflow-auto bg-muted p-4"
      />
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.messageDirective({
    id: "typst",
    component: TypstDirective,
  });
  app.slots.fileOpener({
    id: "typst",
    title: "Typst viewer",
    extensions: ["typ"],
    component: TypstFileOpener,
  });
});
