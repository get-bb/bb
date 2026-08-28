import { useSyncExternalStore } from "react";

export const DARK_COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

type MediaQueryRef = {
  mql: MediaQueryList;
  subscribe: (notify: () => void) => () => void;
};

const mediaQueryCache = new Map<string, MediaQueryRef>();

function getBrowserWindow(): Window | null {
  if (!("window" in globalThis)) return null;
  return globalThis.window ?? null;
}

function createMediaQueryRef(query: string): MediaQueryRef | null {
  const browserWindow = getBrowserWindow();
  if (browserWindow === null || !browserWindow.matchMedia) return null;

  let ref = mediaQueryCache.get(query);
  if (ref) return ref;

  const mql = browserWindow.matchMedia(query);
  const listeners = new Set<() => void>();
  const onChange = () => {
    for (const listener of listeners) listener();
  };

  ref = {
    mql,
    subscribe(notify) {
      const wasEmpty = listeners.size === 0;
      listeners.add(notify);
      if (wasEmpty) {
        mql.addEventListener("change", onChange);
      }
      return () => {
        listeners.delete(notify);
        if (listeners.size === 0) {
          mql.removeEventListener("change", onChange);
          mediaQueryCache.delete(query);
        }
      };
    },
  };
  mediaQueryCache.set(query, ref);
  return ref;
}

export function subscribeMediaQuery(
  query: string,
  notify: () => void,
): () => void {
  return createMediaQueryRef(query)?.subscribe(notify) ?? (() => {});
}

export function getMediaQuerySnapshot(query: string): boolean {
  const browserWindow = getBrowserWindow();
  if (browserWindow === null || !browserWindow.matchMedia) return false;
  return (
    mediaQueryCache.get(query)?.mql.matches ??
    browserWindow.matchMedia(query).matches
  );
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => subscribeMediaQuery(query, notify),
    () => getMediaQuerySnapshot(query),
    () => false,
  );
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY);
}
