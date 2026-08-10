import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { atomFamily } from "jotai-family";
import { createLocalStorageSyncStorage } from "@/lib/browser-storage";

const OPEN_STORAGE_PREFIX = "bb.thread.bottomTerminal.open";
const HEIGHT_STORAGE_PREFIX = "bb.thread.bottomTerminal.heightPercent";

export const DEFAULT_BOTTOM_TERMINAL_HEIGHT_PERCENT = 36;
export const MIN_BOTTOM_TERMINAL_HEIGHT_PERCENT = 20;
export const MAX_BOTTOM_TERMINAL_HEIGHT_PERCENT = 70;

const booleanStorage = createLocalStorageSyncStorage<boolean>({
  parse: (storedValue, initialValue) => {
    if (storedValue === "true") return true;
    if (storedValue === "false") return false;
    return initialValue;
  },
  serialize: String,
});

const heightStorage = createLocalStorageSyncStorage<number>({
  parse: (storedValue, initialValue) => {
    if (storedValue === null) return initialValue;
    const value = Number.parseFloat(storedValue);
    return Number.isFinite(value) &&
      value >= MIN_BOTTOM_TERMINAL_HEIGHT_PERCENT &&
      value <= MAX_BOTTOM_TERMINAL_HEIGHT_PERCENT
      ? value
      : initialValue;
  },
  serialize: String,
});

function storageKey(prefix: string, threadId: string): string {
  return `${prefix}-${encodeURIComponent(threadId)}`;
}

const openAtomFamily = atomFamily((threadId: string) =>
  atomWithStorage(
    storageKey(OPEN_STORAGE_PREFIX, threadId),
    false,
    booleanStorage,
    { getOnInit: true },
  ),
);

const heightAtomFamily = atomFamily((threadId: string) =>
  atomWithStorage(
    storageKey(HEIGHT_STORAGE_PREFIX, threadId),
    DEFAULT_BOTTOM_TERMINAL_HEIGHT_PERCENT,
    heightStorage,
    { getOnInit: true },
  ),
);

const disabledOpenAtom = atom(false);
const disabledHeightAtom = atom(DEFAULT_BOTTOM_TERMINAL_HEIGHT_PERCENT);

export function getThreadBottomTerminalOpenAtom(threadId: string | undefined) {
  return threadId ? openAtomFamily(threadId) : disabledOpenAtom;
}

export function getThreadBottomTerminalHeightAtom(
  threadId: string | undefined,
) {
  return threadId ? heightAtomFamily(threadId) : disabledHeightAtom;
}
