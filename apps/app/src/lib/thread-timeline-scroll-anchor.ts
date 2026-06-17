import { atom } from "jotai";
import { atomFamily } from "jotai-family";

/**
 * A captured timeline scroll position for one thread.
 *
 * Anchored to a row id (not a raw pixel offset) so it survives the
 * `key={threadId}` remount and async row hydration, where row heights and
 * absolute offsets differ. `offsetWithinRow` is how far the scroll area's top
 * edge sits below the anchored row's top (>= 0). `atBottom` records whether the
 * thread was pinned to the bottom when left, so a returning live-streaming
 * thread keeps following the bottom instead of jumping to a stale row.
 */
export interface ScrollAnchor {
  rowId: string;
  offsetWithinRow: number;
  atBottom: boolean;
}

/**
 * Per-thread, in-memory only. Never persisted: a stale pixel offset across
 * reloads or content changes is fragile, and the value's only job is to bridge
 * the force-remount that happens when switching threads within a session.
 */
export const threadTimelineScrollAnchorAtomFamily = atomFamily(
  (_threadId: string) => atom<ScrollAnchor | null>(null),
);
