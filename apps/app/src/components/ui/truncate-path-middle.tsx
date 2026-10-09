import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@bb/shared-ui/lib/utils";

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

function rootPrefixLength(head: string): number {
  const separator = head.slice(1).search(/[\\/]/);
  return separator === -1 ? 0 : separator + 2;
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
  const root = head.slice(0, rootPrefixLength(head));
  const headLength = longestFitting(root.length, head.length - 1, (length) =>
    fits(head.slice(0, length) + ELLIPSIS + tail),
  );
  if (headLength !== null) return head.slice(0, headLength) + ELLIPSIS + tail;
  const tailLength = longestFitting(1, tail.length - 1, (length) =>
    fits(root + ELLIPSIS + tail.slice(-length)),
  );
  return root + ELLIPSIS + (tailLength === null ? "" : tail.slice(-tailLength));
}

let measureContext: CanvasRenderingContext2D | null = null;

function measureTextWidth(text: string, element: HTMLElement): number {
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return 0;
  const style = getComputedStyle(element);
  measureContext.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return measureContext.measureText(text).width;
}

export function TruncatePathMiddle({
  path,
  className,
}: {
  path: string;
  className?: string;
}) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const [fitted, setFitted] = useState(path);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const fit = () =>
      setFitted(
        box.scrollWidth <= box.clientWidth
          ? path
          : fitPathMiddle(path, box.getBoundingClientRect().width - 0.5, (text) =>
              measureTextWidth(text, box),
            ),
      );
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, [path]);

  return (
    <span
      ref={boxRef}
      className={cn(
        "relative block min-w-0 overflow-hidden whitespace-pre",
        className,
      )}
    >
      <span aria-hidden className="invisible">
        {path}
      </span>
      <span className="absolute inset-y-0 left-0">{fitted}</span>
    </span>
  );
}
