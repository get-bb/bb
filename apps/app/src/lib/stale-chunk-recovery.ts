import { flushPendingPromptDraftPersists } from "../hooks/usePromptDraftStorage";

const RELOAD_GUARD_KEY = "bb.stale-chunk-reload";
const SAME_BUILD_RELOAD_KEY = "bb.module-import-reload";
const SAME_BUILD_RELOAD_INTERVAL_MS = 5 * 60_000;
const ENTRY_SCRIPT_SELECTOR = 'script[type="module"][src]';

export function isModuleImportFailure(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    /^(Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed)/i.test(
      error.message,
    )
  );
}

export function isModuleDownloadFailure(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    error.message.startsWith("Unable to download module script")
  );
}

export function isChunkDownloadError(error: unknown): boolean {
  return isModuleImportFailure(error) || isModuleDownloadFailure(error);
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

export function reloadAfterModuleImportFailure(): boolean {
  if (!flushPendingPromptDraftPersists()) return false;
  window.location.reload();
  return true;
}

let checking = false;
let reloading = false;
let sameBuildReloadRequested = false;

async function recover(reloadSameBuild: boolean): Promise<void> {
  if (reloadSameBuild) sameBuildReloadRequested = true;
  if (checking || reloading) return;
  const loadedEntry = readEntryScript(document);
  if (loadedEntry === null) {
    sameBuildReloadRequested = false;
    return;
  }
  checking = true;
  try {
    const deployedEntry = await readDeployedEntryScript();
    if (deployedEntry === null) return;
    const storage = window.sessionStorage;
    if (deployedEntry === loadedEntry) {
      if (!sameBuildReloadRequested) return;
      const lastReload = Number(storage.getItem(SAME_BUILD_RELOAD_KEY));
      if (Date.now() - lastReload < SAME_BUILD_RELOAD_INTERVAL_MS) return;
      if (!flushPendingPromptDraftPersists()) return;
      storage.setItem(SAME_BUILD_RELOAD_KEY, String(Date.now()));
    } else {
      if (storage.getItem(RELOAD_GUARD_KEY) === deployedEntry) return;
      if (!flushPendingPromptDraftPersists()) return;
      storage.setItem(RELOAD_GUARD_KEY, deployedEntry);
    }
    reloading = true;
    window.location.reload();
  } catch {
    return;
  } finally {
    checking = false;
    sameBuildReloadRequested = false;
  }
}

export function recoverFromVisibleModuleImportFailure(): void {
  void recover(true);
}

export function installStaleChunkRecovery(): () => void {
  checking = false;
  reloading = false;
  sameBuildReloadRequested = false;
  const onPreloadError = (event: Event) => {
    if ("payload" in event && isChunkDownloadError(event.payload)) {
      void recover(false);
    }
  };
  window.addEventListener("vite:preloadError", onPreloadError);
  return () => window.removeEventListener("vite:preloadError", onPreloadError);
}
