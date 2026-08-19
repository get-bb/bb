import type { RenderResult } from "mermaid";
import type { Theme } from "@/hooks/useTheme";

/**
 * Module-level helpers that keep Mermaid rendering off the hot path:
 *
 * - `observeMermaidViewportEntry` shares one `IntersectionObserver` across every
 *   diagram so a message with many diagrams (or many mounted messages) does not
 *   allocate an observer each, and reports the first time a diagram comes near
 *   the viewport. Diagrams stay unrendered until then.
 * - The render cache remembers the last rendered SVGs keyed by
 *   (source, theme, palette epoch) so a diagram that remounts (streaming
 *   settled/tail hand-off, collapsed turn re-expansion, navigating back to a
 *   thread) or flips back to a previous theme paints synchronously instead of
 *   running Mermaid again.
 */

export interface RenderedMermaidDiagram {
  bindFunctions: RenderResult["bindFunctions"];
  svg: string;
}

export interface MermaidRenderCacheKeyArgs {
  appThemeEpoch: number;
  preferredTheme: Theme;
  source: string;
}

/**
 * Trailing delay applied when a mounted diagram's `source` changes (streaming
 * deltas). The first render of a diagram and theme changes are immediate.
 */
export const MERMAID_SOURCE_RENDER_DEBOUNCE_MS = 300;

/** Diagrams enter the render gate this far before they scroll into view. */
export const MERMAID_VIEWPORT_ROOT_MARGIN = "256px 0px";

export const MERMAID_RENDER_CACHE_LIMIT = 32;

const renderCache = new Map<string, RenderedMermaidDiagram>();

export function buildMermaidRenderCacheKey({
  appThemeEpoch,
  preferredTheme,
  source,
}: MermaidRenderCacheKeyArgs): string {
  return `${preferredTheme}\u0000${appThemeEpoch}\u0000${source}`;
}

/** Reads without touching LRU order (safe to call during render). */
export function peekMermaidRenderCache(
  key: string,
): RenderedMermaidDiagram | null {
  return renderCache.get(key) ?? null;
}

export function readMermaidRenderCache(
  key: string,
): RenderedMermaidDiagram | null {
  const cached = renderCache.get(key);
  if (cached === undefined) {
    return null;
  }
  // Re-insert so the map's iteration order doubles as LRU order.
  renderCache.delete(key);
  renderCache.set(key, cached);
  return cached;
}

export function storeMermaidRenderCache(
  key: string,
  diagram: RenderedMermaidDiagram,
): void {
  renderCache.delete(key);
  renderCache.set(key, diagram);
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

/**
 * Calls `onEnter` once, the first time `element` intersects the viewport
 * (expanded by {@link MERMAID_VIEWPORT_ROOT_MARGIN}). Environments without
 * `IntersectionObserver` enter immediately. Returns an unsubscribe function.
 */
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
