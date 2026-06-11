import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { createJsonLocalStorage } from "./browser-storage";

export const NAVIGATE_TO_THREAD_AFTER_CREATE_STORAGE_KEY =
  "bb.root-compose.navigate-after-create";

export const NAVIGATE_TO_THREAD_AFTER_CREATE_DEFAULT = false;

const navigateToThreadAfterCreateStorage = createJsonLocalStorage<boolean>();

export const navigateToThreadAfterCreatePreferenceAtom =
  atomWithStorage<boolean>(
    NAVIGATE_TO_THREAD_AFTER_CREATE_STORAGE_KEY,
    NAVIGATE_TO_THREAD_AFTER_CREATE_DEFAULT,
    navigateToThreadAfterCreateStorage,
    { getOnInit: true },
  );

export function useNavigateToThreadAfterCreatePreference() {
  return useAtom(navigateToThreadAfterCreatePreferenceAtom);
}
