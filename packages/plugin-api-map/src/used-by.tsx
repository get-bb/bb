/**
 * The "Used by" row: the shipped plugins that ship on a surface.
 *
 * A short list renders as one plain row, exactly as it always has. A list too
 * long for the row keeps its single line and scrolls sideways, driven by the
 * reader: carets page through it, and the trackpad, wheel, drag, and arrow
 * keys all work because the row is an ordinary scroll container.
 *
 * Nothing moves on its own, so there is no motion to suppress under
 * `prefers-reduced-motion`; that setting only decides whether a caret click
 * animates or jumps.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";

import { cn } from "./cn";
import { SCROLLBAR_HIDDEN_CLASS, scrollEdgeFadeStyle } from "./scroll-edges";

/** Sub-pixel slack: a 0.5px remainder is not something left to scroll to. */
const SCROLL_EPSILON_PX = 1;
/** Kept on screen across a paged scroll, so the eye has an anchor. */
const SCROLL_OVERLAP_PX = 32;
/** Floor for the step, so a very narrow row still advances usefully. */
const MIN_SCROLL_STEP_PX = 80;

export interface UsedByScrollState {
  canScrollLeft: boolean;
  canScrollRight: boolean;
}

/** Geometry of a scroll container, as much of it as these helpers need. */
export interface UsedByScrollMetrics {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

/**
 * Which carets to offer. Both false means everything fits and the row shows
 * no scroll affordance at all.
 *
 * Pure so the extents are testable without a layout engine.
 */
export function usedByScrollState({
  scrollLeft,
  scrollWidth,
  clientWidth,
}: UsedByScrollMetrics): UsedByScrollState {
  const maxScroll = scrollWidth - clientWidth;
  if (maxScroll <= SCROLL_EPSILON_PX) {
    return { canScrollLeft: false, canScrollRight: false };
  }
  return {
    canScrollLeft: scrollLeft > SCROLL_EPSILON_PX,
    canScrollRight: scrollLeft < maxScroll - SCROLL_EPSILON_PX,
  };
}

/** Roughly one visible width, less an overlap so nothing jumps past unread. */
export function usedByScrollStep(clientWidth: number): number {
  return Math.max(clientWidth - SCROLL_OVERLAP_PX, MIN_SCROLL_STEP_PX);
}

/** The minimum a caret needs from its viewport, so tests can stand one in. */
export interface UsedByScrollTarget {
  clientWidth: number;
  scrollBy(options: { left: number; behavior: ScrollBehavior }): void;
}

/** One caret press: a page in `direction`, instant when motion is reduced. */
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
      // The scroll region itself is focusable and arrow-key scrollable, so
      // these stay out of the tab order rather than adding two stops per row.
      tabIndex={-1}
      aria-label={`Scroll ${direction}`}
      aria-hidden={!shown}
      disabled={!shown}
      onClick={onClick}
      className={cn(
        "inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-subtle-foreground transition-colors hover:bg-state-hover hover:text-foreground",
        // Hidden carets keep their slot, so the row does not jitter as the
        // ends come in and out of reach.
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
  const [scroll, setScroll] = useState<UsedByScrollState>({
    canScrollLeft: false,
    canScrollRight: false,
  });
  const reducedMotion = useReducedMotion();

  const sync = useCallback(() => {
    const viewport = viewportRef.current;
    if (viewport) {
      setScroll(usedByScrollState(viewport));
    }
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    sync();
    // The viewport resizes with the card; the row inside it resizes with the
    // items. Either changes what is left to scroll to.
    const observer = new ResizeObserver(sync);
    observer.observe(viewport);
    const row = viewport.firstElementChild;
    if (row) {
      observer.observe(row);
    }
    viewport.addEventListener("scroll", sync, { passive: true });
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", sync);
    };
  }, [items, sync]);

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
        // Focusable only while there is something to scroll, so a row that
        // fits adds no tab stop. Focus makes it arrow-key scrollable.
        {...(scrollable
          ? { tabIndex: 0, role: "group", "aria-label": "Used by" }
          : {})}
        // A focused scroll container scrolls itself on arrow keys, but the
        // carousel above also steers on them and would pan the whole slide
        // out from under the row. Keep horizontal arrows here; the native
        // scroll still happens because nothing calls preventDefault.
        onKeyDown={(event) => {
          if (
            scrollable &&
            (event.key === "ArrowLeft" || event.key === "ArrowRight")
          ) {
            event.stopPropagation();
          }
        }}
        // The shared chip-bar treatment: hidden scrollbar plus an edge fade
        // on whichever side has overflow, so a cut entry reads as "more this
        // way" rather than a torn glyph beside the caret.
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
