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

export function idleSplitDownload(id: string) {
  return {
    preloadPolicy: "idle" as const,
    async preload() {
      if (importing.has(id)) return;
      let pending = downloads.get(id);
      if (pending === undefined) {
        pending = downloadSplitAssets(id).catch(() => undefined);
        downloads.set(id, pending);
      }
      await pending;
    },
  };
}
