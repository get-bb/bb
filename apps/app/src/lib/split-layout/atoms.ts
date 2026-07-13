import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import {
  createLocalStorageSyncStorage,
  type SyncStorage,
} from "@/lib/browser-storage";
import { listPanes, removePane } from "./ops";
import {
  deserializeSplitLayout,
  serializeSplitLayout,
  SPLIT_LAYOUT_STORAGE_KEY,
} from "./persistence";
import type { SplitLayout } from "./types";

function createSplitLayoutStorage(): SyncStorage<SplitLayout | null> {
  return createLocalStorageSyncStorage<SplitLayout | null>({
    // A malformed or stale value deserializes to null, which the split area
    // reads as "seed a single pane from the current route".
    parse: (storedValue) => deserializeSplitLayout(storedValue),
    serialize: (value) => (value === null ? "" : serializeSplitLayout(value)),
  });
}

/**
 * Global split layout, shared across projects like {@link
 * sidebarCollapsedAtoms}. Null until the first thread view seeds a single pane
 * from the route; persisted through the versioned split-layout codec so reload
 * restores the arrangement (the URL's thread claims focus). The focused pane is
 * carried inside {@link SplitLayout.focusedPaneId}, not a separate atom.
 */
export const splitLayoutAtom = atomWithStorage<SplitLayout | null>(
  SPLIT_LAYOUT_STORAGE_KEY,
  null,
  createSplitLayoutStorage(),
  { getOnInit: true },
);

export interface ClosePanesForThreadsResult {
  /** True when at least one pane closed, so the caller should not navigate. */
  removedAny: boolean;
}

/**
 * Closes every pane whose thread is in `threadIds`, one at a time, while more
 * than one pane remains (the layout never collapses below a single pane). This
 * bridges archive/delete: a thread open in a split pane closes that pane
 * instead of navigating the whole window away. Returns whether anything closed
 * so the caller can fall back to its single-pane navigation when nothing did.
 */
export const closePanesForThreadsAtom = atom(
  null,
  (get, set, threadIds: readonly string[]): ClosePanesForThreadsResult => {
    const current = get(splitLayoutAtom);
    if (current === null || threadIds.length === 0) {
      return { removedAny: false };
    }
    const targets = new Set(threadIds);
    let layout = current;
    let removedAny = false;
    for (;;) {
      const pane = listPanes(layout.root).find(
        (candidate) =>
          candidate.content.kind === "thread" &&
          targets.has(candidate.content.threadId),
      );
      if (pane === undefined) {
        break;
      }
      const next = removePane(layout, pane.paneId);
      if (next === layout) {
        // removePane refuses to remove the last pane.
        break;
      }
      layout = next;
      removedAny = true;
    }
    if (removedAny) {
      set(splitLayoutAtom, layout);
    }
    return { removedAny };
  },
);
