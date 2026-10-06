const requested = new Set<string>();

async function downloadSplitAssets(id: string): Promise<void> {
  const data = document.getElementById(`bb-prefetch-${id}`)?.textContent;
  if (!data) return;
  const urls: unknown = JSON.parse(data);
  if (!Array.isArray(urls) || !urls.every((url) => typeof url === "string"))
    return;
  await Promise.all(
    urls.map(async (path: string) => {
      const url = new URL(path, document.baseURI).href;
      if (requested.has(url) || performance.getEntriesByName(url).length > 0)
        return;
      requested.add(url);
      try {
        const response = await fetch(url, {
          cache: "force-cache",
          priority: "low",
        });
        if (!response.ok)
          throw new Error(`Prefetch failed: ${response.status}`);
        await response.arrayBuffer();
      } catch {
        requested.delete(url);
      }
    }),
  );
}

const importing = new Set<string>();
const downloads = new Map<string, Promise<void>>();

export function prepareSplitImport(id: string): Promise<void> {
  importing.add(id);
  return downloads.get(id) ?? Promise.resolve();
}

export async function downloadSplit(id: string): Promise<void> {
  if (importing.has(id)) return;
  let pending = downloads.get(id);
  if (pending === undefined) {
    pending = downloadSplitAssets(id).catch(() => undefined);
    downloads.set(id, pending);
  }
  await pending;
}

const preloadQueue = new Set<() => Promise<void>>();
let preloadingStarted = false;
let drainScheduled = false;
let pendingCriticalLoads = 0;
const settledWaiters: Array<() => void> = [];

function resolveSettledWaitersAfterRender() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (pendingCriticalLoads > 0) return;
      for (const resolve of settledWaiters.splice(0)) resolve();
    });
  });
}

export function trackCriticalLoad<T>(load: Promise<T>): Promise<T> {
  pendingCriticalLoads += 1;
  const settle = () => {
    pendingCriticalLoads -= 1;
    if (pendingCriticalLoads > 0) return;
    resolveSettledWaitersAfterRender();
    if (preloadingStarted) scheduleDrain();
  };
  load.then(settle, settle);
  return load;
}

export function whenCriticalLoadsSettled(): Promise<void> {
  const settled = new Promise<void>((resolve) => settledWaiters.push(resolve));
  if (pendingCriticalLoads === 0) resolveSettledWaitersAfterRender();
  return settled;
}

function drainPreloadQueue() {
  drainScheduled = false;
  if (pendingCriticalLoads > 0) return;
  const warmers = [...preloadQueue];
  preloadQueue.clear();
  for (const warm of warmers) void warm();
}

function scheduleDrain() {
  if (drainScheduled || preloadQueue.size === 0) return;
  drainScheduled = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(drainPreloadQueue, { timeout: 1000 });
      } else {
        window.setTimeout(drainPreloadQueue, 1000);
      }
    });
  });
}

export function queueSplitPreload(warm: () => Promise<void>): void {
  preloadQueue.add(warm);
  if (preloadingStarted) scheduleDrain();
}

export function queueSplitDownload(id: string): void {
  queueSplitPreload(() => downloadSplit(id));
}

export function startSplitPreloading(): void {
  if (preloadingStarted) return;
  preloadingStarted = true;
  scheduleDrain();
}
