export interface RenderedMermaidDiagram {
  maxWidth: number | null;
  svg: string;
}

export const MERMAID_SOURCE_RENDER_DEBOUNCE_MS = 300;

const MERMAID_VIEWPORT_ROOT_MARGIN = "256px 0px";

export const MERMAID_RENDER_CACHE_LIMIT = 32;

const renderCache = new Map<string, RenderedMermaidDiagram>();

export function peekMermaidRenderCache(
  source: string,
): RenderedMermaidDiagram | null {
  return renderCache.get(source) ?? null;
}

export function readMermaidRenderCache(
  source: string,
): RenderedMermaidDiagram | null {
  const cached = renderCache.get(source);
  if (cached === undefined) {
    return null;
  }
  renderCache.delete(source);
  renderCache.set(source, cached);
  return cached;
}

export function storeMermaidRenderCache(
  source: string,
  diagram: RenderedMermaidDiagram,
): void {
  renderCache.delete(source);
  renderCache.set(source, diagram);
  while (renderCache.size > MERMAID_RENDER_CACHE_LIMIT) {
    const oldestKey = renderCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    renderCache.delete(oldestKey);
  }
}

export function clearMermaidRenderCache(): void {
  renderCache.clear();
}

export function getMermaidRenderCacheSize(): number {
  return renderCache.size;
}

type ViewportEntryCallback = () => void;

let sharedViewportObserver: IntersectionObserver | null = null;
const viewportEntryCallbacks = new Map<Element, ViewportEntryCallback>();

function getSharedViewportObserver(): IntersectionObserver {
  sharedViewportObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }
        const callback = viewportEntryCallbacks.get(entry.target);
        if (callback === undefined) {
          continue;
        }
        viewportEntryCallbacks.delete(entry.target);
        sharedViewportObserver?.unobserve(entry.target);
        callback();
      }
      releaseSharedViewportObserverIfIdle();
    },
    { rootMargin: MERMAID_VIEWPORT_ROOT_MARGIN },
  );
  return sharedViewportObserver;
}

function releaseSharedViewportObserverIfIdle(): void {
  if (viewportEntryCallbacks.size === 0 && sharedViewportObserver !== null) {
    sharedViewportObserver.disconnect();
    sharedViewportObserver = null;
  }
}

export function observeMermaidViewportEntry(
  element: Element,
  onEnter: ViewportEntryCallback,
): () => void {
  if (typeof IntersectionObserver === "undefined") {
    onEnter();
    return () => {};
  }
  viewportEntryCallbacks.set(element, onEnter);
  getSharedViewportObserver().observe(element);
  return () => {
    if (viewportEntryCallbacks.delete(element)) {
      sharedViewportObserver?.unobserve(element);
    }
    releaseSharedViewportObserverIfIdle();
  };
}
