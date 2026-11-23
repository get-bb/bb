import { usePathname, useRouter } from "expo-router";
import { useEffect } from "react";
import { getThreadLocationPath } from "@bb/client-core";
import { webViewShellHref } from "@/screens/shell/hrefs";
import { useProfiles } from "./ProfilesProvider";

export function ThreadOpenSignalHandler() {
  const { connection } = useProfiles();
  const router = useRouter();
  const pathname = usePathname();
  const realtime = connection?.client.realtime ?? null;
  useEffect(() => {
    if (!realtime) return;
    return realtime.onThreadOpen((signal) => {
      if (pathnameIsThread(pathname, signal.threadId)) return;
      router.push(
        webViewShellHref({
          path: getThreadLocationPath({
            threadId: signal.threadId,
            projectId: signal.projectId,
          }),
        }),
      );
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
