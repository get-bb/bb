import { createMMKV } from "react-native-mmkv";
import type { ClearableStorage } from "@/lib/e2e";

/**
 * The client-local preferences store (`bb.preferences`; theme mode lives
 * here, see `src/theme/theme-storage.ts`). MMKV instances with the same id
 * share one backing store, so this handle can wipe it for the e2e reset.
 */
export function getPreferencesStorage(): ClearableStorage {
  return createMMKV({ id: "bb.preferences" });
}
