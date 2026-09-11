import { useContext, useMemo, type ReactNode } from "react";
import { matchPath } from "react-router-dom";
import { toast } from "sonner";
import { RouteNavigationContext } from "@/components/ui/app-route-anchor";
import { dismissNotification } from "@/lib/notifications/notification-store";

export function NotificationNavigationProvider({
  children,
  notificationId,
  toastId,
}: {
  children: ReactNode;
  notificationId: string | null;
  toastId: string | number | null;
}) {
  const navigation = useContext(RouteNavigationContext);
  const value = useMemo(() => {
    if (navigation === null) return null;
    const dismissForThread = (path: string) => {
      const pathname = path.split(/[?#]/)[0] ?? path;
      if (
        !matchPath("/threads/:threadId", pathname) &&
        !matchPath("/projects/:projectId/threads/:threadId", pathname)
      ) {
        return;
      }
      if (toastId !== null) toast.dismiss(toastId);
      if (notificationId !== null) dismissNotification(notificationId);
    };
    return {
      navigate: (...args: Parameters<typeof navigation.navigate>) => {
        navigation.navigate(...args);
        dismissForThread(args[0]);
      },
      openInSplit: (path: string) => {
        const opened = navigation.openInSplit(path);
        if (opened) dismissForThread(path);
        return opened;
      },
    };
  }, [navigation, notificationId, toastId]);

  return (
    <RouteNavigationContext.Provider value={value}>
      {children}
    </RouteNavigationContext.Provider>
  );
}
