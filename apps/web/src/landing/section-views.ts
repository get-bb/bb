import { useEffect } from "react";

import { trackLandingEvent } from "./analytics";

export const SECTION_VIEW_RATIO = 0.4;
export const SECTION_VIEW_DWELL_MS = 1000;

const THRESHOLDS = Array.from({ length: 21 }, (_, i) => i / 20);

function isVisibleEnough(entry: IntersectionObserverEntry): boolean {
  if (!entry.isIntersecting) return false;
  if (entry.intersectionRatio >= SECTION_VIEW_RATIO) return true;
  const viewportHeight = entry.rootBounds?.height ?? window.innerHeight;
  return (
    viewportHeight > 0 &&
    entry.intersectionRect.height >= viewportHeight * SECTION_VIEW_RATIO
  );
}

export function observeSectionViews(
  root: ParentNode,
  onView: (section: string) => void,
): () => void {
  if (typeof IntersectionObserver === "undefined") return () => {};

  const seen = new Set<string>();
  const timers = new Map<Element, number>();
  const clearTimer = (target: Element) => {
    const timer = timers.get(target);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.delete(target);
    }
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const target = entry.target;
        const section = target.getAttribute("data-section");
        if (!section || seen.has(section)) {
          observer.unobserve(target);
          clearTimer(target);
          continue;
        }
        if (!isVisibleEnough(entry)) {
          clearTimer(target);
          continue;
        }
        if (timers.has(target)) continue;
        timers.set(
          target,
          window.setTimeout(() => {
            timers.delete(target);
            if (seen.has(section)) return;
            seen.add(section);
            observer.unobserve(target);
            onView(section);
          }, SECTION_VIEW_DWELL_MS),
        );
      }
    },
    { threshold: THRESHOLDS },
  );

  for (const target of root.querySelectorAll("[data-section]")) {
    observer.observe(target);
  }

  return () => {
    observer.disconnect();
    for (const timer of timers.values()) window.clearTimeout(timer);
    timers.clear();
  };
}

export function useSectionViews(): void {
  useEffect(
    () =>
      observeSectionViews(document, (section) =>
        trackLandingEvent({
          name: "landing_section_viewed",
          properties: { section },
        }),
      ),
    [],
  );
}
