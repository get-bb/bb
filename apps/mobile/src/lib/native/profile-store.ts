import {
  createProfileStore,
  type ProfileStore,
} from "../profiles/profile-store";
import { expoSecureStorage } from "./expo-secure-storage";

let instance: ProfileStore | null = null;

/** App-wide profile store persisted in expo-secure-store. */
export function getProfileStore(): ProfileStore {
  if (!instance) {
    instance = createProfileStore({ storage: expoSecureStorage });
  }
  return instance;
}
