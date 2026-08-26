import * as QuickActions from "expo-quick-actions";
import { useQuickActionCallback } from "expo-quick-actions/hooks";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { settingsSectionHref } from "@/screens/shell/hrefs";

/**
 * Home Screen quick actions (long-press the app icon).
 *
 * There is exactly one, and it exists for one reason: it is the entry to the
 * device settings screen that never depends on the page. When the WebView
 * shell renders a broken or blank page, the in-page link and the app's own
 * navigation are both gone, and this is still there. Render once, high in the
 * tree.
 */
const DEVICE_SETTINGS_ACTION_ID = "device-settings";

export function QuickActionsHandler() {
  const router = useRouter();

  useEffect(() => {
    // Best-effort: an unsupported device (or a simulator without the native
    // module) must not break the app shell over a shortcut menu.
    QuickActions.setItems([
      {
        id: DEVICE_SETTINGS_ACTION_ID,
        title: "Device settings",
        subtitle: "Servers, haptics, and the web interface",
        icon: "symbol:gearshape",
      },
    ]).catch(() => undefined);
  }, []);

  useQuickActionCallback((action) => {
    if (action.id !== DEVICE_SETTINGS_ACTION_ID) return;
    router.navigate(settingsSectionHref("device"));
  });

  return null;
}
