import { useRouter } from "expo-router";
import { useCallback } from "react";
import { getProfileStore } from "@/lib/native";
import { threadHref } from "@/screens/shell/hrefs";
import { waitForActiveConnection } from "./connector";

/**
 * Open a thread that may live on a profile other than the active one
 * (notification taps, universal links, the realtime `thread-open` signal):
 * switch the active profile first, wait for its connection, then push the
 * thread route. Returns false when the profile is unknown.
 */
export function useOpenThreadInProfile(): (
  profileId: string,
  threadId: string,
) => Promise<boolean> {
  const router = useRouter();
  return useCallback(
    async (profileId, threadId) => {
      const store = getProfileStore();
      await store.load();
      if (!store.getProfile(profileId)) return false;
      if (store.getSnapshot().activeProfileId !== profileId) {
        await store.setActiveProfile(profileId);
        await waitForActiveConnection(profileId);
      }
      router.push(threadHref(threadId));
      return true;
    },
    [router],
  );
}
