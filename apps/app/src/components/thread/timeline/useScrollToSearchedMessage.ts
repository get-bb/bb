import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useBottomAnchoredScroll } from "@/components/ui/bottom-anchored-scroll-body.js";

// Structural subset of a timeline view row — every row carries an event-sequence
// range, which is how we map a searched message's sequence to its rendered row.
interface SeqAnchoredRow {
  id: string;
  sourceSeqStart: number;
  sourceSeqEnd: number;
}

const FLASH_CLASS_NAME = "bb-search-flash";
const FLASH_DURATION_MS = 1700;

// Sidebar search hands the matched message's event sequence to the thread route
// via `navigate(path, { state: { searchMessageSeq } })`.
function readSearchMessageSeq(state: unknown): number | null {
  if (
    state !== null &&
    typeof state === "object" &&
    "searchMessageSeq" in state
  ) {
    const value = (state as { searchMessageSeq: unknown }).searchMessageSeq;
    return typeof value === "number" ? value : null;
  }
  return null;
}

/**
 * When the thread was opened from a sidebar search result whose match was in a
 * message body, scroll that message into view and briefly highlight it.
 *
 * Keyed off `location.key` so it fires once per navigation (not on every render
 * or row update). The effect also depends on `rows`, so if the timeline hasn't
 * hydrated the target row yet it simply retries once the rows arrive.
 */
export function useScrollToSearchedMessage(
  rows: readonly SeqAnchoredRow[],
): void {
  const location = useLocation();
  const bottomAnchor = useBottomAnchoredScroll();
  const handledKeyRef = useRef<string | null>(null);
  const targetSeq = readSearchMessageSeq(location.state);

  useEffect(() => {
    if (targetSeq === null || handledKeyRef.current === location.key) {
      return;
    }
    const targetRow = rows.find(
      (row) => row.sourceSeqStart <= targetSeq && targetSeq <= row.sourceSeqEnd,
    );
    if (targetRow === undefined) {
      // Target row not rendered yet (still loading, or inside a collapsed
      // group). Leave the key unhandled so a later rows change can retry.
      return;
    }
    const selector = `[data-timeline-row-id="${CSS.escape(targetRow.id)}"]`;
    if (document.querySelector(selector) === null) {
      return;
    }
    handledKeyRef.current = location.key;

    let flashed = false;
    const revealTarget = () => {
      const element = document.querySelector<HTMLElement>(selector);
      if (element === null) {
        return;
      }
      if (bottomAnchor !== null) {
        // scrollElementIntoView suppresses stick-to-bottom so this wins over the
        // default open-at-bottom behavior.
        bottomAnchor.scrollElementIntoView({
          element,
          options: { block: "center" },
        });
      } else {
        element.scrollIntoView({ block: "center" });
      }
      if (!flashed) {
        flashed = true;
        element.classList.add(FLASH_CLASS_NAME);
        window.setTimeout(() => {
          element.classList.remove(FLASH_CLASS_NAME);
        }, FLASH_DURATION_MS);
      }
    };

    // Reveal on the next frame, then once more after layout settles, so a late
    // scroll-anchor restore can't leave the target off-screen.
    const frame = requestAnimationFrame(revealTarget);
    const settle = window.setTimeout(revealTarget, 320);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, [bottomAnchor, location.key, rows, targetSeq]);
}
