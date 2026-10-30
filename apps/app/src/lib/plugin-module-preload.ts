const preloadedUrls = new Set<string>();

export function prefetchPluginModule(url: string): void {
  if (preloadedUrls.has(url)) return;
  preloadedUrls.add(url);
  const link = document.createElement("link");
  link.rel = "modulepreload";
  link.href = url;
  link.onload = () => link.remove();
  link.onerror = () => link.remove();
  document.head.appendChild(link);
}
