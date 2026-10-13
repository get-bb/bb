import type * as MonacoNs from "monaco-editor";

let bootPromise: Promise<typeof MonacoNs> | null = null;

/**
 * Loads the bundle once per page. The panel can mount and unmount as the
 * user navigates; re-importing Monaco each time would re-parse megabytes and
 * re-register its grammars.
 */
export function loadMonaco(baseUrl: string): Promise<typeof MonacoNs> {
  bootPromise ??= boot(baseUrl);
  return bootPromise;
}

interface MonacoModule {
  monaco?: typeof MonacoNs;
}

async function boot(baseUrl: string): Promise<typeof MonacoNs> {
  await injectStylesheet(`${baseUrl}/editor.css`);

  (globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
    getWorker: () =>
      new Worker(
        new URL(`${baseUrl}/editor.worker.js`, window.location.origin),
        { type: "module" },
      ),
  };

  const loaded: MonacoModule = await import(
    /* @vite-ignore */ `${baseUrl}/editor.js`
  );
  const monaco = loaded.monaco;
  if (!monaco) {
    throw new Error("the Notes Monaco bundle did not expose its API");
  }
  return monaco;
}

function injectStylesheet(href: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`Failed to load ${href}`));
    document.head.appendChild(link);
  });
}

const OVERFLOW_NODE_ID = "bb-plugin-notes-overflow-widgets";

/**
 * Hosts the find widget and suggestion popups outside the editor's own
 * clipping box, so they are not cut off by the panel's scroll container.
 */
export function overflowWidgetsNode(): HTMLElement {
  const existing = document.getElementById(OVERFLOW_NODE_ID);
  if (existing !== null) return existing;
  const node = document.createElement("div");
  node.id = OVERFLOW_NODE_ID;
  node.className = "monaco-editor";
  node.style.position = "absolute";
  node.style.top = "0";
  node.style.left = "0";
  node.style.zIndex = "40";
  document.body.appendChild(node);
  return node;
}

export function setOverflowWidgetsTheme(base: "vs" | "vs-dark"): void {
  const node = document.getElementById(OVERFLOW_NODE_ID);
  if (node !== null) node.className = `monaco-editor ${base}`;
}
