import { atomWithStorage } from "jotai/utils";
import { createJsonLocalStorage } from "@/lib/browser-storage";

const NEW_TAB_ACTION_ORDER_STORAGE_KEY = "bb.newTab.actionOrder";

export const newTabActionOrderAtom = atomWithStorage<string[]>(
  NEW_TAB_ACTION_ORDER_STORAGE_KEY,
  [],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);
