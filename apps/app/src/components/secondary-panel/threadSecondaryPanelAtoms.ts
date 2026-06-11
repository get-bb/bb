import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { atomFamily } from "jotai-family";
import { createLocalStorageSyncStorage } from "@/lib/browser-storage";

export const threadSecondaryPanelResizingAtom = atom(false);

type ResolvedThreadSecondaryPanelThreadId = string;
type ThreadSecondaryPanelThreadId =
  | ResolvedThreadSecondaryPanelThreadId
  | null
  | undefined;

interface ThreadSecondaryPanelStorageKeyArgs {
  prefix: string;
  threadId: ResolvedThreadSecondaryPanelThreadId;
}

function getThreadSecondaryPanelStorageKey({
  prefix,
  threadId,
}: ThreadSecondaryPanelStorageKeyArgs): string {
  return `${prefix}-${encodeURIComponent(threadId)}`;
}

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

const threadSecondaryPanelBooleanStorage =
  createLocalStorageSyncStorage<boolean>({
    parse: (storedValue, initialValue) => {
      if (storedValue === "true") return true;
      if (storedValue === "false") return false;
      return initialValue;
    },
    serialize: (value) => String(value),
  });

/**
 * Whether a given thread's secondary panel is open on wide viewports. Stored
 * separately from the tab list so the user's right-panel layout choice is
 * restored per thread even as app/fullscreen and conversation-collapse flows
 * mutate the selected tab. Defaults closed for threads with no stored value,
 * matching the empty fixed-panel state.
 */
const THREAD_SECONDARY_PANEL_OPEN_STORAGE_PREFIX =
  "bb.thread.secondaryPanel.open";

interface ThreadSecondaryPanelOpenStorageKeyArgs {
  threadId: ResolvedThreadSecondaryPanelThreadId;
}

export function getThreadSecondaryPanelOpenStorageKey({
  threadId,
}: ThreadSecondaryPanelOpenStorageKeyArgs): string {
  return getThreadSecondaryPanelStorageKey({
    prefix: THREAD_SECONDARY_PANEL_OPEN_STORAGE_PREFIX,
    threadId,
  });
}

const threadSecondaryPanelOpenAtomFamily = atomFamily(
  (threadId: ResolvedThreadSecondaryPanelThreadId) =>
    atomWithStorage<boolean>(
      getThreadSecondaryPanelOpenStorageKey({ threadId }),
      false,
      threadSecondaryPanelBooleanStorage,
      { getOnInit: true },
    ),
);

// Fallback for callers without a resolved thread id (e.g. before routing
// settles). It stays false and any write lands on this throwaway atom, so no
// real thread's panel-open state is affected.
const disabledThreadSecondaryPanelOpenAtom = atom(false);

function hasThreadId(
  threadId: ThreadSecondaryPanelThreadId,
): threadId is ResolvedThreadSecondaryPanelThreadId {
  return threadId !== null && threadId !== undefined && threadId.length > 0;
}

/**
 * The panel-open atom for a specific thread. `atomFamily` memoizes by threadId,
 * so repeated calls with the same id return a stable atom reference safe to
 * pass straight to `useAtom`/`useSetAtom`/`useAtomValue`.
 */
export function getThreadSecondaryPanelOpenAtom(
  threadId: ThreadSecondaryPanelThreadId,
) {
  return hasThreadId(threadId)
    ? threadSecondaryPanelOpenAtomFamily(threadId)
    : disabledThreadSecondaryPanelOpenAtom;
}

const THREAD_CONVERSATION_COLLAPSED_STORAGE_PREFIX =
  "bb.thread.conversation.collapsed";

/**
 * Whether a given thread's conversation/timeline pane is collapsed so the
 * secondary panel fills the whole content area. Keyed per thread (like the
 * terminal panel and recent-items state) so collapsing one thread's
 * conversation — e.g. opening an app full-screen from the sidebar — never
 * leaks into another thread or gets cleared by selecting an unrelated row.
 * Persisted per thread; only takes effect while the secondary panel is open on
 * a wide viewport — see ThreadDetailSecondaryContent for the gating.
 */
interface ThreadConversationCollapsedStorageKeyArgs {
  threadId: ResolvedThreadSecondaryPanelThreadId;
}

export function getThreadConversationCollapsedStorageKey({
  threadId,
}: ThreadConversationCollapsedStorageKeyArgs): string {
  return getThreadSecondaryPanelStorageKey({
    prefix: THREAD_CONVERSATION_COLLAPSED_STORAGE_PREFIX,
    threadId,
  });
}

const conversationCollapsedStorage = threadSecondaryPanelBooleanStorage;

const threadConversationCollapsedAtomFamily = atomFamily(
  (threadId: ResolvedThreadSecondaryPanelThreadId) =>
    atomWithStorage<boolean>(
      getThreadConversationCollapsedStorageKey({ threadId }),
      false,
      conversationCollapsedStorage,
      { getOnInit: true },
    ),
);

// Fallback for callers without a resolved thread id (e.g. before routing
// settles). It stays false and any write lands on this throwaway atom, so no
// real thread's collapse state is affected.
const disabledThreadConversationCollapsedAtom = atom(false);

/**
 * The conversation-collapsed atom for a specific thread. `atomFamily` memoizes
 * by threadId, so repeated calls with the same id return a stable atom
 * reference safe to pass straight to `useAtom`/`useSetAtom`/`useAtomValue`.
 */
export function getThreadConversationCollapsedAtom(
  threadId: ThreadSecondaryPanelThreadId,
) {
  return hasThreadId(threadId)
    ? threadConversationCollapsedAtomFamily(threadId)
    : disabledThreadConversationCollapsedAtom;
}

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

/** Set by openCommitDiff (info tab Commits row), consumed by useGitDiffPanelState to scope the diff to a commit. */
export const pendingGitDiffCommitShaAtom = atom<string | null>(null);
