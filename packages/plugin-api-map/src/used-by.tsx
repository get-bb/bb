import { useEffect, useRef, useState, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";

import { cn } from "./cn";
import {
  SCROLLBAR_HIDDEN_CLASS,
  scrollEdgeFadeStyle,
  useScrollEdges,
} from "./scroll-edges";

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

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) {
      return;
    }
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return reduced;
}

function Caret({
  direction,
  shown,
  onClick,
}: {
  direction: "left" | "right";
  shown: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={`Scroll ${direction}`}
      aria-hidden={!shown}
      disabled={!shown}
      onClick={onClick}
      className={cn(
        "inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-subtle-foreground transition-colors hover:bg-state-hover hover:text-foreground",
        !shown && "invisible",
      )}
    >
      <HugeiconsIcon
        icon={direction === "left" ? ArrowLeft01Icon : ArrowRight01Icon}
        className="size-3.5"
      />
    </button>
  );
}

export function UsedByList({
  items,
  renderItem,
}: {
  items: readonly string[];
  renderItem: (item: string) => ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const scroll = useScrollEdges(viewportRef);
  const reducedMotion = useReducedMotion();

  const page = (direction: -1 | 1) => {
    const viewport = viewportRef.current;
    if (viewport) {
      scrollUsedBy(viewport, direction, { reducedMotion });
    }
  };

  const scrollable = scroll.canScrollLeft || scroll.canScrollRight;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      {scrollable ? (
        <Caret
          direction="left"
          shown={scroll.canScrollLeft}
          onClick={() => page(-1)}
        />
      ) : null}
      <div
        ref={viewportRef}
        {...(scrollable
          ? { tabIndex: 0, role: "group", "aria-label": "Used by" }
          : {})}
        onKeyDown={(event) => {
          if (
            scrollable &&
            (event.key === "ArrowLeft" || event.key === "ArrowRight")
          ) {
            event.stopPropagation();
          }
        }}
        className={cn(
          "min-w-0 flex-1 overflow-x-auto focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          SCROLLBAR_HIDDEN_CLASS,
        )}
        style={scrollEdgeFadeStyle(scroll.canScrollLeft, scroll.canScrollRight)}
      >
        <ul className="flex w-max gap-x-3">
          {items.map((item) => (
            <li key={item} className="shrink-0">
              {renderItem(item)}
            </li>
          ))}
        </ul>
      </div>
      {scrollable ? (
        <Caret
          direction="right"
          shown={scroll.canScrollRight}
          onClick={() => page(1)}
        />
      ) : null}
    </div>
  );
}
