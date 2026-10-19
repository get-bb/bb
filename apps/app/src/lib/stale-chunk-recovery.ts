import { flushPendingPromptDraftPersists } from "../hooks/usePromptDraftStorage";

const RELOAD_GUARD_KEY = "bb.stale-chunk-reload";
const ENTRY_SCRIPT_SELECTOR = 'script[type="module"][src]';

export function isChunkDownloadError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    /^(Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed)/i.test(
      error.message,
    )
  );
}

function readEntryScript(root: ParentNode): string | null {
  const src = root
    .querySelector<HTMLScriptElement>(ENTRY_SCRIPT_SELECTOR)
    ?.getAttribute("src");
  return src ? new URL(src, document.baseURI).href : null;
}

async function readDeployedEntryScript(): Promise<string | null> {
  try {
    const response = await fetch("/", {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const html = await response.text();
    return readEntryScript(new DOMParser().parseFromString(html, "text/html"));
  } catch {
    return null;
  }
}

export function installStaleChunkRecovery(): () => void {
  let checking = false;
  let reloading = false;
  const recover = async () => {
    if (checking || reloading) return;
    const loadedEntry = readEntryScript(document);
    if (loadedEntry === null) return;
    checking = true;
    try {
      const deployedEntry = await readDeployedEntryScript();
      if (deployedEntry === null || deployedEntry === loadedEntry) return;
      const storage = window.sessionStorage;
      if (storage.getItem(RELOAD_GUARD_KEY) === deployedEntry) return;
      if (!flushPendingPromptDraftPersists()) return;
      storage.setItem(RELOAD_GUARD_KEY, deployedEntry);
      reloading = true;
      window.location.reload();
    } catch {
      return;
    } finally {
      checking = false;
    }
  };
  const onPreloadError = (event: Event) => {
    if ("payload" in event && isChunkDownloadError(event.payload)) {
      void recover();
    }
  };
  window.addEventListener("vite:preloadError", onPreloadError);
  return () => window.removeEventListener("vite:preloadError", onPreloadError);
}
