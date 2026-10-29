import { createContext } from "react";
import { atom, type WritableAtom } from "jotai";
import { atomWithStorage, RESET } from "jotai/utils";
import { atomFamily } from "jotai-family";
import {
  booleanLocalStorage,
  createLocalStorageSyncStorage,
} from "@/lib/browser-storage";
import { hasThreadId } from "@/lib/thread-id";

export const threadSecondaryPanelResizingAtom = atom(false);

type ResolvedThreadSecondaryPanelThreadId = string;
type ThreadSecondaryPanelThreadId =
  | ResolvedThreadSecondaryPanelThreadId
  | null
  | undefined;

const DEFAULT_SECONDARY_PANEL_WIDTH_PERCENT = 50;

function parseSecondaryPanelWidthPercent(storedValue: string | null) {
  if (storedValue === null) return null;
  const parsed = Number.parseFloat(storedValue);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 100 ? parsed : null;
}

const secondaryPanelWidthStorage = createLocalStorageSyncStorage<number>({
  parse: (storedValue, initialValue) =>
    parseSecondaryPanelWidthPercent(storedValue) ?? initialValue,
  serialize: (value) => String(value),
});
const threadSecondaryPanelWidthOverrideStorage = createLocalStorageSyncStorage<
  number | null
>({
  parse: (storedValue, initialValue) =>
    parseSecondaryPanelWidthPercent(storedValue) ?? initialValue,
  serialize: (value) => String(value),
});

export type SecondaryPanelWidthPercentAtom = WritableAtom<
  number,
  [number | typeof RESET],
  void
>;

export const secondaryPanelWidthPercentAtom: SecondaryPanelWidthPercentAtom =
  atomWithStorage<number>(
    "bb.thread.secondaryPanel.widthPercent",
    DEFAULT_SECONDARY_PANEL_WIDTH_PERCENT,
    secondaryPanelWidthStorage,
    { getOnInit: true },
  );

const threadSecondaryPanelWidthOverrideAtomFamily = atomFamily(
  (threadId: ResolvedThreadSecondaryPanelThreadId) =>
    atomWithStorage<number | null>(
      `bb.thread.secondaryPanel.widthPercent-${encodeURIComponent(threadId)}`,
      null,
      threadSecondaryPanelWidthOverrideStorage,
      { getOnInit: true },
    ),
);

const threadSecondaryPanelWidthPercentAtomFamily = atomFamily(
  (threadId: ResolvedThreadSecondaryPanelThreadId) => {
    const overrideAtom = threadSecondaryPanelWidthOverrideAtomFamily(threadId);
    const widthPercentAtom: SecondaryPanelWidthPercentAtom = atom(
      (get) => get(overrideAtom) ?? get(secondaryPanelWidthPercentAtom),
      (_get, set, widthPercent: number | typeof RESET) => {
        set(overrideAtom, widthPercent);
        if (widthPercent !== RESET) {
          set(secondaryPanelWidthPercentAtom, widthPercent);
        }
      },
    );
    return widthPercentAtom;
  },
);

export function getThreadSecondaryPanelWidthPercentAtom(
  threadId: ResolvedThreadSecondaryPanelThreadId,
): SecondaryPanelWidthPercentAtom {
  return threadSecondaryPanelWidthPercentAtomFamily(threadId);
}

const PLUGIN_PAGE_SECONDARY_PANEL_WIDTH_STORAGE_PREFIX =
  "bb.pluginPage.secondaryPanel.widthPercent";

const pluginPageSecondaryPanelWidthPercentAtomFamily = atomFamily(
  (pageKey: string): SecondaryPanelWidthPercentAtom =>
    atomWithStorage<number>(
      `${PLUGIN_PAGE_SECONDARY_PANEL_WIDTH_STORAGE_PREFIX}-${pageKey}`,
      DEFAULT_SECONDARY_PANEL_WIDTH_PERCENT,
      secondaryPanelWidthStorage,
      { getOnInit: true },
    ),
);

export function getPluginPageSecondaryPanelWidthPercentAtom({
  panelPath,
  pluginId,
}: {
  panelPath: string;
  pluginId: string;
}): SecondaryPanelWidthPercentAtom {
  return pluginPageSecondaryPanelWidthPercentAtomFamily(
    `${encodeURIComponent(pluginId)}:${encodeURIComponent(panelPath)}`,
  );
}

export const SecondaryPanelWidthPercentAtomContext =
  createContext<SecondaryPanelWidthPercentAtom>(secondaryPanelWidthPercentAtom);

const THREAD_CONVERSATION_COLLAPSED_STORAGE_PREFIX =
  "bb.thread.conversation.collapsed";

const threadConversationCollapsedAtomFamily = atomFamily(
  (threadId: ResolvedThreadSecondaryPanelThreadId) =>
    atomWithStorage<boolean>(
      `${THREAD_CONVERSATION_COLLAPSED_STORAGE_PREFIX}-${encodeURIComponent(threadId)}`,
      false,
      booleanLocalStorage,
      { getOnInit: true },
    ),
);

const disabledThreadConversationCollapsedAtom = atom(false);

export function getThreadConversationCollapsedAtom(
  threadId: ThreadSecondaryPanelThreadId,
) {
  return hasThreadId(threadId)
    ? threadConversationCollapsedAtomFamily(threadId)
    : disabledThreadConversationCollapsedAtom;
}
