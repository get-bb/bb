import { useSyncExternalStore } from "react";
import { recordTelemetryEvent } from "@/components/onboarding/onboarding-telemetry";
import { isInsideNativeShell } from "@/lib/native-shell/native-shell";

export type NotificationPermissionState =
  | NotificationPermission
  | "unsupported";

export type NotificationPromptSurface = "checklist" | "sidebar";

const listeners = new Set<() => void>();

function readNotificationPermission(): NotificationPermissionState {
  return typeof Notification === "undefined" ||
    !window.isSecureContext ||
    isInsideNativeShell()
    ? "unsupported"
    : Notification.permission;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener("focus", notify);
    document.addEventListener("visibilitychange", notify);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("focus", notify);
      document.removeEventListener("visibilitychange", notify);
    }
  };
}

export async function requestNotificationPermission(
  surface: NotificationPromptSurface,
): Promise<NotificationPermission> {
  const result = await Notification.requestPermission().catch(
    () => Notification.permission,
  );
  notify();
  recordTelemetryEvent({
    name:
      result === "granted"
        ? "notification_prompt_accepted"
        : result === "denied"
          ? "notification_prompt_denied"
          : "notification_prompt_dismissed",
    properties: { surface },
  });
  return result;
}

export function useNotificationPermission(): NotificationPermissionState {
  return useSyncExternalStore(
    subscribe,
    readNotificationPermission,
    () => "unsupported",
  );
}
