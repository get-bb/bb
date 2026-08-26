import type * as MonacoNs from "monaco-editor";

/**
 * Loads the Monaco bundle this plugin builds for itself, from a URL, the
 * first time a file tab opens.
 *
 * Not bundled into app.js: `bb plugin build` emits one file with no code
 * splitting, so Monaco would parse at app boot for every user — including
 * everyone who never opens a file — and its worker could not be emitted at
 * all. Loading it from a URL keeps the plugin bundle at a few KB and defers
 * every byte of Monaco until it is needed.
 *
 * The bundle is built by `scripts/stage-assets.mjs` into `dist/monaco` and
 * served by `bb.sdk.files.createPreview` (see server.ts) — same origin as the
 * app, so the worker is not cross-origin.
 */

/** One load per app window, shared by every open editor tab. */
let bootPromise: Promise<typeof MonacoNs> | null = null;

export function loadMonaco(baseUrl: string): Promise<typeof MonacoNs> {
  bootPromise ??= boot(baseUrl);
  return bootPromise;
}

interface MonacoModule {
  monaco?: typeof MonacoNs;
}

async function boot(baseUrl: string): Promise<typeof MonacoNs> {
  // Monaco styles its widgets from a stylesheet esbuild emits beside the
  // bundle; without it the editor mounts and paints nothing.
  await injectStylesheet(`${baseUrl}/editor.css`);

  // Workers are same-origin, so a plain module worker is enough — no blob
  // trampoline. Set before the editor loads: Monaco reads this when it first
  // needs a worker, which can be during the first `create`.
  (globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
    getWorker: () =>
      new Worker(new URL(`${baseUrl}/editor.worker.js`, window.location.origin), {
        type: "module",
      }),
  };

  // The URL is a runtime value, so the plugin's own bundler leaves this
  // import alone rather than trying to inline the module.
  const loaded: MonacoModule = await import(
    /* @vite-ignore */ `${baseUrl}/editor.js`
  );
  const monaco = loaded.monaco;
  if (!monaco) {
    throw new Error("the Monaco bundle did not expose its API");
  }
  registerOccurrenceHighlighting(monaco);
  return monaco;
}

/**
 * Highlights every occurrence of the identifier under the cursor.
 *
 * Monaco's word-highlight contribution ships in the bundle but does nothing
 * on its own: it renders whatever a `DocumentHighlightProvider` reports, and
 * the only provider that would register one is a language service. Monaco has
 * a textual provider of its own (`textualHighlightProvider.js`) but never
 * wires it into the standalone editor, and it takes internal services a
 * plugin cannot reach — so supply one through the public API instead.
 *
 * Textual by design: matches are whole-word and case-sensitive, with no
 * notion of whether two spellings mean the same symbol. That is what makes it
 * useful without a language server, and it costs nothing to ship.
 */
function registerOccurrenceHighlighting(monaco: typeof MonacoNs): void {
  const languageIds = monaco.languages.getLanguages().map((entry) => entry.id);
  monaco.languages.registerDocumentHighlightProvider(languageIds, {
    provideDocumentHighlights(model, position) {
      const word = model.getWordAtPosition(position);
      if (word === null) return [];
      return model
        .findMatches(
          word.word,
          false,
          false,
          true,
          // Non-null word separators make this whole-word, so `set` does not
          // light up every `offset` in the file.
          USUAL_WORD_SEPARATORS,
          false,
          MAX_OCCURRENCE_MATCHES,
        )
        .map((match) => ({
          range: match.range,
          kind: monaco.languages.DocumentHighlightKind.Text,
        }));
    },
  });
}

/** Monaco's own default; repeated because the constant is not exported. */
const USUAL_WORD_SEPARATORS = "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?";

/** A ceiling so a hot loop over a huge file cannot stall the editor. */
const MAX_OCCURRENCE_MATCHES = 1000;

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

const OVERFLOW_NODE_ID = "bb-plugin-monaco-editor-overflow-widgets";

/**
 * A body-level host for Monaco's "overflow widgets" — hovers, the suggest
 * list, the parameter hints, the context menu.
 *
 * By default Monaco renders these inside the editor's own DOM, where BB's
 * panel chrome clips them: a hover wider than the panel is cut off at its
 * edge rather than overflowing across the conversation.
 *
 * `fixedOverflowWidgets: true` alone is not enough here. It switches the
 * widgets to `position: fixed`, which normally escapes ancestor clipping —
 * but one of the panel's ancestors is a Tailwind `@container`, and
 * `container-type: inline-size` establishes a containing block for fixed
 * descendants, so they stay trapped. Giving Monaco a node outside that
 * subtree is what actually frees them.
 *
 * Shared by every open editor (Monaco supports that) and deliberately not
 * torn down: it is one empty div, and removing it while another tab's editor
 * still references it would break that editor's widgets.
 */
export function overflowWidgetsNode(): HTMLElement {
  const existing = document.getElementById(OVERFLOW_NODE_ID);
  if (existing !== null) return existing;
  const node = document.createElement("div");
  node.id = OVERFLOW_NODE_ID;
  // Monaco's widget CSS is scoped under `.monaco-editor`, so the host node
  // has to carry that class or the hovers render unstyled.
  node.className = "monaco-editor";
  node.style.position = "absolute";
  node.style.top = "0";
  node.style.left = "0";
  // Above BB's panel chrome. Kept below the 50+ band that dialogs and the
  // app header occupy, and since radix portals mount later in the body they
  // still stack over this.
  node.style.zIndex = "40";
  document.body.appendChild(node);
  return node;
}

/**
 * Keeps the overflow host on the same Monaco theme as the editors.
 *
 * Only the base matters: Monaco emits one global stylesheet for the active
 * theme and keys the light/dark half of it on `vs` / `vs-dark`, so a custom
 * theme's own name never appears in a class list.
 */
export function setOverflowWidgetsTheme(base: "vs" | "vs-dark"): void {
  const node = document.getElementById(OVERFLOW_NODE_ID);
  if (node !== null) node.className = `monaco-editor ${base}`;
}
