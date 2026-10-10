import { useCallback, useEffect, useState } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { SidebarNudge } from "@bb/shared-ui/sidebar-nudge";
import { PUSH_NOTIFICATIONS_PLUGIN_ID } from "@/components/onboarding/onboarding-model";
import { recordTelemetryEvent } from "@/components/onboarding/onboarding-telemetry";
import { listSidebarNavigationThreads } from "@/hooks/cache-owners/query-cache";
import { usePluginList } from "@/hooks/queries/plugin-settings-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import {
  requestNotificationPermission,
  useNotificationPermission,
} from "@/hooks/useNotificationPermission";
import { withLocalStorage } from "@/lib/browser-storage";

type PromptState = "shown" | "answered";

const PROMPT_STATE_STORAGE_KEY = "bb.sidebar.notificationPrompt";

function readPromptState(): PromptState | null {
  const stored = withLocalStorage(
    (storage) => storage.getItem(PROMPT_STATE_STORAGE_KEY),
    null,
  );
  return stored === "shown" || stored === "answered" ? stored : null;
}

function usePromptState() {
  const [promptState, setState] = useState(readPromptState);
  const setPromptState = useCallback((next: PromptState) => {
    withLocalStorage(
      (storage) => storage.setItem(PROMPT_STATE_STORAGE_KEY, next),
      undefined,
    );
    setState(next);
  }, []);
  return [promptState, setPromptState] as const;
}

export interface SidebarNotificationsPromptState {
  visible: boolean;
  turnOn: () => void;
  notNow: () => void;
}

export function useSidebarNotificationsPrompt(): SidebarNotificationsPromptState {
  const permission = useNotificationPermission();
  const [promptState, setPromptState] = usePromptState();
  const pushEnabled =
    usePluginList({ enabled: true }).data?.plugins.some(
      (plugin) => plugin.id === PUSH_NOTIFICATIONS_PLUGIN_ID && plugin.enabled,
    ) ?? false;
  const navigation = useSidebarNavigation().data;
  const threadRunning =
    navigation !== undefined &&
    listSidebarNavigationThreads(navigation).some(
      (thread) => thread.status === "starting" || thread.status === "active",
    );
  const eligible =
    pushEnabled && permission === "default" && promptState !== "answered";
  const visible = eligible && (promptState === "shown" || threadRunning);

  useEffect(() => {
    if (!visible || promptState === "shown") return;
    setPromptState("shown");
    recordTelemetryEvent({
      name: "notification_prompt_shown",
      properties: { surface: "sidebar" },
    });
  }, [promptState, setPromptState, visible]);

  return {
    visible,
    turnOn: () => {
      setPromptState("answered");
      void requestNotificationPermission("sidebar");
    },
    notNow: () => {
      setPromptState("answered");
      recordTelemetryEvent({
        name: "notification_prompt_dismissed",
        properties: { surface: "sidebar" },
      });
    },
  };
}

export function SidebarNotificationsCard({
  prompt,
}: {
  prompt: SidebarNotificationsPromptState;
}) {
  if (!prompt.visible) return null;
  return (
    <SidebarNudge
      testId="sidebar-notifications-prompt"
      icon={<Icon aria-hidden name="BellDot" className="size-4" />}
      action={{ label: "Notify me", onAction: prompt.turnOn }}
      onDismiss={prompt.notNow}
      dismissLabel="Not now"
    >
      Get a notification when this agent finishes or asks you a question, even
      in another tab.
    </SidebarNudge>
  );
}
