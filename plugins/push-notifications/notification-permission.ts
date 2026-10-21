import { useEffect, useState } from "react";
import { notificationPermission } from "./client.js";

export function useNotificationPermission() {
  const [permission, setPermission] = useState(notificationPermission);
  useEffect(() => {
    const refresh = () => setPermission(notificationPermission());
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    let permissionStatus: PermissionStatus | null = null;
    let disposed = false;
    void navigator.permissions
      ?.query({ name: "notifications" })
      .then((status) => {
        if (disposed) return;
        permissionStatus = status;
        status.addEventListener("change", refresh);
        refresh();
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      permissionStatus?.removeEventListener("change", refresh);
    };
  }, []);
  return [permission, setPermission] as const;
}
