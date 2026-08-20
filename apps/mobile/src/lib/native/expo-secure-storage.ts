import * as SecureStore from "expo-secure-store";
import type { SecureStorageLike } from "../profiles/secure-storage";

// Readable after the first unlock so foreground resumes and future background
// work can reach the credential; never migrated to another device via backup
// (a connect machine slot belongs to this phone).
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** `expo-secure-store` behind the storage contract the profile store uses. */
export const expoSecureStorage: SecureStorageLike = {
  getItem: (key) => SecureStore.getItemAsync(key, OPTIONS),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, OPTIONS),
  deleteItem: (key) => SecureStore.deleteItemAsync(key, OPTIONS),
};
