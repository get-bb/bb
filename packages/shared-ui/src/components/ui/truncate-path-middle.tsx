import { useLayoutEffect, useRef, useState } from "react";
import { observeSharedResize } from "../../lib/shared-resize-observer";

const KEPT_TAIL_SEGMENTS = 2;
const ELLIPSIS = "…";

export function splitPathForMiddleTruncation(path: string): {
  head: string;
  tail: string;
} {
  let splitIndex = path.length;
  for (let kept = 0; kept < KEPT_TAIL_SEGMENTS; kept += 1) {
    splitIndex = Math.max(
      path.lastIndexOf("/", splitIndex - 1),
      path.lastIndexOf("\\", splitIndex - 1),
    );
    if (splitIndex <= 0) return { head: "", tail: path };
  }
  return { head: path.slice(0, splitIndex), tail: path.slice(splitIndex) };
}

function longestFitting(
  min: number,
  max: number,
  fits: (length: number) => boolean,
): number | null {
  if (max < min || !fits(min)) return null;
  let low = min;
  let high = max;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(mid)) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}

export function fitPathMiddle(
  path: string,
  availableWidth: number,
  measure: (text: string) => number,
): string {
  if (measure(path) <= availableWidth) return path;
  const { head, tail } = splitPathForMiddleTruncation(path);
  const fits = (text: string) => measure(text) <= availableWidth;
  const separator = tail.startsWith("\\") ? "\\" : "/";
  const boundaries: number[] = [];
  for (let index = 1; index < head.length; index += 1) {
    if (head[index] === "/" || head[index] === "\\") boundaries.push(index);
  }
  for (let index = boundaries.length - 1; index >= 0; index -= 1) {
    const candidate =
      head.slice(0, boundaries[index]) + separator + ELLIPSIS + tail;
    if (fits(candidate)) return candidate;
  }
  const root = head.slice(0, boundaries[0] ?? head.length);
  const prefix = root + (root ? separator : "") + ELLIPSIS;
  const lastSegment = tail.slice(
    Math.max(tail.lastIndexOf("/"), tail.lastIndexOf("\\")),
  );
  if (lastSegment !== tail && fits(prefix + lastSegment)) {
    return prefix + lastSegment;
  }
  const tailLength = longestFitting(1, tail.length - 1, (length) =>
    fits(prefix + tail.slice(-length)),
  );
  return prefix + (tailLength === null ? "" : tail.slice(-tailLength));
}

let measureContext: CanvasRenderingContext2D | null = null;

function measureTextWidth(text: string, element: HTMLElement): number {
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return 0;
  const style = getComputedStyle(element);
  measureContext.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return measureContext.measureText(text).width;
}

export function useFittedPathMiddle<T extends HTMLElement>(
  path: string,
  measureReservedWidth: (container: T) => number,
) {
  const containerRef = useRef<T>(null);
  const [fitted, setFitted] = useState(path);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const lifecycle = { disposed: false };
    const measure = () =>
      fitPathMiddle(
        path,
        container.getBoundingClientRect().width -
          measureReservedWidth(container) -
          0.5,
        (text) => measureTextWidth(text, container),
      );
    const fit = () => {
      if (lifecycle.disposed) return;
      setFitted(measure());
    };
    fit();
    const unobserve = observeSharedResize(container, {
      read: measure,
      write: setFitted,
    });
    void document.fonts?.ready?.then(fit);
    return () => {
      lifecycle.disposed = true;
      unobserve();
    };
  }, [path, measureReservedWidth]);

  return { containerRef, fitted };
}
