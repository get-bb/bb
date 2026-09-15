import { useEffect, useRef, useState, type RefObject } from "react";

export const BROWSER_VIEW_PASSTHROUGH_ATTRIBUTE =
  "data-bb-browser-view-passthrough";
export const BROWSER_VIEW_PASSTHROUGH_PROPS = {
  [BROWSER_VIEW_PASSTHROUGH_ATTRIBUTE]: "",
} as const;

const PASSTHROUGH_SELECTOR = `[${BROWSER_VIEW_PASSTHROUGH_ATTRIBUTE}]`;
const SAMPLE_SPACING_PX = 48;
const MAX_SAMPLES_PER_AXIS = 24;
const THROTTLED_CHECK_DELAY_MS = 150;
const OCCLUDED_RECHECK_INTERVAL_MS = 1000;
const OBSERVED_ATTRIBUTES = ["style", "class", "hidden", "data-state"];

interface IsBrowserViewOccludedArgs {
  element: HTMLElement;
}

interface UseBrowserViewOcclusionArgs {
  elementRef: RefObject<HTMLElement | null>;
  enabled: boolean;
}

function sampleCount(size: number): number {
  return Math.min(
    MAX_SAMPLES_PER_AXIS,
    Math.max(1, Math.ceil(size / SAMPLE_SPACING_PX)),
  );
}

function topmostHitTarget(x: number, y: number): Element | null {
  for (const candidate of document.elementsFromPoint(x, y)) {
    if (candidate.closest(PASSTHROUGH_SELECTOR) !== null) {
      continue;
    }
    return candidate;
  }
  return null;
}

export function isBrowserViewOccluded({
  element,
}: IsBrowserViewOccludedArgs): boolean {
  if (typeof document.elementsFromPoint !== "function") {
    return false;
  }
  const rect = element.getBoundingClientRect();
  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  const width = Math.min(rect.right, window.innerWidth) - left;
  const height = Math.min(rect.bottom, window.innerHeight) - top;
  if (width <= 0 || height <= 0) {
    return false;
  }
  const columns = sampleCount(width);
  const rows = sampleCount(height);
  for (let row = 0; row < rows; row += 1) {
    const y = top + ((row + 0.5) * height) / rows;
    for (let column = 0; column < columns; column += 1) {
      const x = left + ((column + 0.5) * width) / columns;
      const target = topmostHitTarget(x, y);
      if (target === null || target === element) {
        continue;
      }
      if (element.contains(target) || target.contains(element)) {
        continue;
      }
      return true;
    }
  }
  return false;
}

export function useBrowserViewOcclusion({
  elementRef,
  enabled,
}: UseBrowserViewOcclusionArgs): boolean {
  const [occluded, setOccluded] = useState(false);
  const occludedRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let frame: number | null = null;
    let throttleTimer: ReturnType<typeof setTimeout> | null = null;

    const check = () => {
      frame = null;
      const element = elementRef.current;
      const next = element !== null && isBrowserViewOccluded({ element });
      if (next !== occludedRef.current) {
        occludedRef.current = next;
        setOccluded(next);
      }
    };
    const scheduleCheck = () => {
      if (frame !== null) {
        return;
      }
      frame = requestAnimationFrame(check);
    };
    const scheduleThrottledCheck = () => {
      if (throttleTimer !== null || frame !== null) {
        return;
      }
      throttleTimer = setTimeout(() => {
        throttleTimer = null;
        scheduleCheck();
      }, THROTTLED_CHECK_DELAY_MS);
    };

    const observer = new MutationObserver((records) => {
      if (records.some((record) => record.type === "childList")) {
        scheduleCheck();
        return;
      }
      scheduleThrottledCheck();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: OBSERVED_ATTRIBUTES,
    });
    document.addEventListener("transitionend", scheduleCheck, true);
    document.addEventListener("animationend", scheduleCheck, true);
    document.addEventListener("scroll", scheduleThrottledCheck, true);
    window.addEventListener("resize", scheduleThrottledCheck);
    const recheckInterval = setInterval(() => {
      if (occludedRef.current) {
        scheduleCheck();
      }
    }, OCCLUDED_RECHECK_INTERVAL_MS);
    scheduleCheck();

    return () => {
      observer.disconnect();
      document.removeEventListener("transitionend", scheduleCheck, true);
      document.removeEventListener("animationend", scheduleCheck, true);
      document.removeEventListener("scroll", scheduleThrottledCheck, true);
      window.removeEventListener("resize", scheduleThrottledCheck);
      clearInterval(recheckInterval);
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      if (throttleTimer !== null) {
        clearTimeout(throttleTimer);
      }
      occludedRef.current = false;
      setOccluded(false);
    };
  }, [elementRef, enabled]);

  return enabled && occluded;
}
