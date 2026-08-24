import { useAtom } from "jotai";
import { createBooleanPreferenceAtom } from "./browser-storage";

const NAVIGATE_TO_THREAD_AFTER_CREATE_STORAGE_KEY =
  "bb.root-compose.navigate-after-create";

const NAVIGATE_TO_THREAD_AFTER_CREATE_DEFAULT = true;

const navigateToThreadAfterCreatePreferenceAtom = createBooleanPreferenceAtom(
  NAVIGATE_TO_THREAD_AFTER_CREATE_STORAGE_KEY,
  NAVIGATE_TO_THREAD_AFTER_CREATE_DEFAULT,
);

export function useNavigateToThreadAfterCreatePreference() {
  return useAtom(navigateToThreadAfterCreatePreferenceAtom);
}
