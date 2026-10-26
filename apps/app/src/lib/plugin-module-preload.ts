export function prefetchPluginModule(url: string): void {
  const link = document.createElement("link");
  link.rel = "modulepreload";
  link.href = url;
  link.onload = () => link.remove();
  link.onerror = () => link.remove();
  document.head.appendChild(link);
}
