import {
  storedSessionSchema,
  type SessionCacheLike,
} from "../session/session-cache";
import { expoSecureStorage } from "./expo-secure-storage";

function key(profileId: string): string {
  return `bb.connectSession.${profileId}`;
}

function parse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export const nativeSessionCache: SessionCacheLike = {
  async read(profileId) {
    const raw = await expoSecureStorage.getItem(key(profileId));
    if (raw === null) return null;
    const result = storedSessionSchema.safeParse(parse(raw));
    return result.success ? result.data : null;
  },
  write: (profileId, stored) =>
    expoSecureStorage.setItem(key(profileId), JSON.stringify(stored)),
  clear: (profileId) => expoSecureStorage.deleteItem(key(profileId)),
};
