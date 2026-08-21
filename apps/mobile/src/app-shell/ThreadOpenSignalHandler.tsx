import { usePathname, useRouter } from "expo-router";
import { useEffect } from "react";
import { threadHref } from "@/screens/shell/hrefs";
import { useProfiles } from "./ProfilesProvider";

/**
 * The realtime `thread-open` signal (`POST /threads/:id/open`, the CLI's
 * `bb thread open`, agents handing a thread to the user): navigate to the
 * thread on the active profile, like the web's `wsManager.onThreadOpen` →
 * `navigate(route)`. The socket is closed in the background, so this only
 * fires while the app is foregrounded; already being on the thread is a
 * no-op. Render once inside the ProfilesProvider.
 */
export function ThreadOpenSignalHandler() {
  const { connection } = useProfiles();
  const router = useRouter();
  const pathname = usePathname();
  const realtime = connection?.client.realtime ?? null;
  useEffect(() => {
    if (!realtime) return;
    return realtime.onThreadOpen((signal) => {
      if (pathnameIsThread(pathname, signal.threadId)) return;
      router.push(threadHref(signal.threadId));
    });
  }, [realtime, router, pathname]);
  return null;
}

function pathnameIsThread(pathname: string, threadId: string): boolean {
  return (
    pathname === `/threads/${threadId}` ||
    pathname.endsWith(`/threads/${threadId}`)
  );
}
