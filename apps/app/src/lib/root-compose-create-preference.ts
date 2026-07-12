import { useAtom } from "jotai";
import { createBooleanPreferenceAtom } from "./browser-storage";

export const NAVIGATE_TO_THREAD_AFTER_CREATE_STORAGE_KEY =
  "bb.root-compose.navigate-after-create";

export const NAVIGATE_TO_THREAD_AFTER_CREATE_DEFAULT = true;

export const navigateToThreadAfterCreatePreferenceAtom =
  createBooleanPreferenceAtom(
    NAVIGATE_TO_THREAD_AFTER_CREATE_STORAGE_KEY,
    NAVIGATE_TO_THREAD_AFTER_CREATE_DEFAULT,
  );

export function useNavigateToThreadAfterCreatePreference() {
  return useAtom(navigateToThreadAfterCreatePreferenceAtom);
}
