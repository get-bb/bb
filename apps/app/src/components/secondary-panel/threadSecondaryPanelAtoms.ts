import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { createLocalStorageSyncStorage } from "@/lib/browser-storage";

export const threadSecondaryPanelResizingAtom = atom(false);

/**
 * User's preferred secondary panel width as a percentage of the surrounding
 * PanelGroup. Persisted across reloads. The default (50) is used when the
 * panel opens for the first time.
 */
export const DEFAULT_SECONDARY_PANEL_WIDTH_PERCENT = 50;
const secondaryPanelWidthStorage = createLocalStorageSyncStorage<number>({
  parse: (storedValue, initialValue) => {
    if (storedValue === null) return initialValue;
    const parsed = Number.parseFloat(storedValue);
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 100
      ? parsed
      : initialValue;
  },
  serialize: (value) => String(value),
});
export const secondaryPanelWidthPercentAtom = atomWithStorage<number>(
  "bb.thread.secondaryPanel.widthPercent",
  DEFAULT_SECONDARY_PANEL_WIDTH_PERCENT,
  secondaryPanelWidthStorage,
  { getOnInit: true },
);

/**
 * Whether the conversation/timeline pane is collapsed so the secondary panel
 * fills the whole content area. Persisted globally (like the panel width) so
 * it is one consistent layout preference rather than per-thread state. Only
 * takes effect while the secondary panel is open on a wide viewport — see
 * ThreadDetailSecondaryContent for the gating.
 */
const conversationCollapsedStorage = createLocalStorageSyncStorage<boolean>({
  parse: (storedValue, initialValue) => {
    if (storedValue === "true") return true;
    if (storedValue === "false") return false;
    return initialValue;
  },
  serialize: (value) => String(value),
});
export const threadConversationCollapsedAtom = atomWithStorage<boolean>(
  "bb.thread.conversation.collapsed",
  false,
  conversationCollapsedStorage,
  { getOnInit: true },
);

/** Collapsed file keys in the diff panel. Set by useGitDiffFileRenderQueue, read by ThreadSecondaryPanel. */
export const gitDiffCollapsedFileKeysAtom = atom<ReadonlySet<string>>(
  new Set<string>(),
);

/** File keys with pending render timers. Set by useGitDiffFileRenderQueue, read by ThreadSecondaryPanel. */
export const gitDiffLoadingFileKeysAtom = atom<ReadonlySet<string>>(
  new Set<string>(),
);

/** User-selected merge-base branch override. Read by prompt banner + diff panel + git-action dialog. */
export const selectedMergeBaseBranchAtom = atom<string | undefined>(undefined);

/** Set by openDiffFile (prompt banner), consumed by useGitDiffPanelState to scroll to file. */
export const pendingGitDiffScrollPathAtom = atom<string | null>(null);
