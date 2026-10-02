import { useLayoutEffect, useState } from "react";
import {
  definePluginApp,
  experimental_Icon as Icon,
  type PluginFileOpenerProps,
} from "@get-bb/plugin-sdk/app";
import { loadPdfBlob, resolvePdfUrl } from "./pdf-source.js";

type PreviewState =
  | { status: "loading" }
  | { status: "ready"; frameLoaded: boolean; url: string }
  | { status: "error"; message: string };

type PdfCache = Map<string, Blob>;
const MAX_CACHED_PDF_BYTES = 32 * 1024 * 1024;
const MAX_CACHED_PDFS = 8;

function rememberPdf(cache: PdfCache, url: string, blob: Blob): void {
  cache.delete(url);
  cache.set(url, blob);
  let bytes = [...cache.values()].reduce(
    (total, value) => total + value.size,
    0,
  );
  for (const [key, value] of cache) {
    if (cache.size <= MAX_CACHED_PDFS && bytes <= MAX_CACHED_PDF_BYTES) break;
    cache.delete(key);
    bytes -= value.size;
  }
}

async function samePdf(first: Blob, second: Blob): Promise<boolean> {
  if (first.size !== second.size) return false;
  const [left, right] = await Promise.all([
    first.arrayBuffer(),
    second.arrayBuffer(),
  ]);
  const bytes = new Uint8Array(right);
  return new Uint8Array(left).every((value, index) => value === bytes[index]);
}

function PdfFileOpener(props: PluginFileOpenerProps & { cache: PdfCache }) {
  const url = resolvePdfUrl(props.path, props.source);
  return url === null ? (
    <props.Original />
  ) : (
    <PdfDocument key={url} url={url} path={props.path} cache={props.cache} />
  );
}

function PdfDocument({
  path,
  url,
  cache,
}: {
  path: string;
  url: string;
  cache: PdfCache;
}) {
  const [reloadNonce, setReloadNonce] = useState(0);
  const [state, setState] = useState<PreviewState>({ status: "loading" });

  useLayoutEffect(() => {
    const controller = new AbortController();
    const objectUrls: string[] = [];
    const cached = cache.get(url);
    const display = (blob: Blob) => {
      const objectUrl = URL.createObjectURL(blob);
      objectUrls.push(objectUrl);
      setState({ status: "ready", frameLoaded: false, url: objectUrl });
    };
    if (cached) display(cached);

    void loadPdfBlob(url, controller.signal)
      .then(async (blob) => {
        const unchanged = cached !== undefined && (await samePdf(cached, blob));
        if (controller.signal.aborted) return;
        rememberPdf(cache, url, blob);
        if (!unchanged) display(blob);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || cached) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      controller.abort();
      for (const objectUrl of objectUrls) URL.revokeObjectURL(objectUrl);
    };
  }, [cache, reloadNonce, url]);

  if (state.status === "error") {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <div className="max-w-md space-y-3 text-center" role="alert">
          <p className="text-sm text-destructive">
            Failed to load PDF: {state.message}
          </p>
          <button
            type="button"
            className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => setReloadNonce((current) => current + 1)}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div
        className="flex h-full min-h-0 items-center justify-center gap-2 text-sm text-muted-foreground"
        role="status"
        aria-label={`Loading ${path}`}
      >
        <Icon name="Spinner" className="size-4 animate-spin" aria-hidden />
        Loading PDF…
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-background">
      {state.frameLoaded ? null : (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background text-sm text-muted-foreground"
          role="status"
          aria-label={`Rendering ${path}`}
        >
          <Icon name="Spinner" className="size-4 animate-spin" aria-hidden />
          Rendering PDF…
        </div>
      )}
      <iframe
        src={state.url}
        title={path}
        className="block h-full w-full border-0"
        onLoad={() => {
          setState((current) =>
            current.status === "ready"
              ? { ...current, frameLoaded: true }
              : current,
          );
        }}
        onError={() => {
          setState({
            status: "error",
            message: "The browser could not open the PDF viewer.",
          });
        }}
      />
    </div>
  );
}

export default definePluginApp((app) => {
  const cache: PdfCache = new Map();
  app.slots.fileOpener({
    id: "pdf",
    title: "PDF viewer",
    extensions: ["pdf"],
    component: (props) => <PdfFileOpener {...props} cache={cache} />,
  });
});
