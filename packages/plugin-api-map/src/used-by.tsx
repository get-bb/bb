import { useState, type ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";

import { FOCUS_RING_CLASS } from "./annotation";

const SCROLL_OVERLAP_PX = 32;
const MIN_SCROLL_STEP_PX = 80;

export function usedByScrollStep(clientWidth: number): number {
  return Math.max(clientWidth - SCROLL_OVERLAP_PX, MIN_SCROLL_STEP_PX);
}

export interface UsedByScrollTarget {
  clientWidth: number;
  scrollBy(options: { left: number; behavior: ScrollBehavior }): void;
}

export function scrollUsedBy(
  viewport: UsedByScrollTarget,
  direction: -1 | 1,
  { reducedMotion }: { reducedMotion: boolean },
): void {
  viewport.scrollBy({
    left: direction * usedByScrollStep(viewport.clientWidth),
    behavior: reducedMotion ? "auto" : "smooth",
  });
}

export function UsedByList({
  items,
  renderItem,
}: {
  items: readonly string[];
  renderItem: (item: string) => ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const currentIndex = Math.min(index, items.length - 1);
  const item = items[currentIndex];
  if (!item) return null;

  return (
    <div
      role="group"
      aria-label="Example plugins"
      className="flex min-w-0 flex-1 items-center gap-1"
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        event.stopPropagation();
        setIndex(Math.max(0, Math.min(
          items.length - 1,
          currentIndex + (event.key === "ArrowLeft" ? -1 : 1),
        )));
      }}
    >
      {items.length > 1 ? (
        <button
          type="button"
          aria-label="Previous example plugin"
          disabled={currentIndex === 0}
          onClick={() => setIndex(currentIndex - 1)}
          className={`inline-flex size-9 @2xl/guide:size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:cursor-default disabled:opacity-35 ${FOCUS_RING_CLASS}`}
        >
          <Icon name="ChevronLeft" className="size-3.5" />
        </button>
      ) : null}
      <div className="min-w-0 flex-1" aria-live="polite" aria-atomic="true">
        <span className="sr-only">Example {currentIndex + 1} of {items.length}: </span>
        {renderItem(item)}
      </div>
      {items.length > 1 ? (
        <button
          type="button"
          aria-label="Next example plugin"
          disabled={currentIndex === items.length - 1}
          onClick={() => setIndex(currentIndex + 1)}
          className={`inline-flex size-9 @2xl/guide:size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:cursor-default disabled:opacity-35 ${FOCUS_RING_CLASS}`}
        >
          <Icon name="ChevronRight" className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
