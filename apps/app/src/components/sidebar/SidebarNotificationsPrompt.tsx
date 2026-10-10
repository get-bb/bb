import { useCallback, useEffect, useId, useState } from "react";
import { Icon } from "@bb/shared-ui/icon";
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

const CARD_SURFACE_CLASS =
  "relative rounded-lg bg-card shadow-xs dark:bg-sidebar-accent/50 dark:shadow-none";
const CARD_CONTROL_CLASS =
  "flex size-6 cursor-pointer items-center justify-center rounded-md text-subtle-foreground transition-colors hover:bg-state-hover hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring motion-reduce:transition-none";

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
  const labelId = useId();
  if (!prompt.visible) return null;
  return (
    <section
      aria-labelledby={labelId}
      data-testid="sidebar-notifications-prompt"
      className={`${CARD_SURFACE_CLASS} px-3 pb-2.5 pt-2.5`}
    >
      <p
        id={labelId}
        className="pr-6 text-sm font-medium leading-snug text-foreground"
      >
        Get notified when this agent needs you
      </p>
      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
        bb tells you when it finishes or asks you a question, even in another
        tab.
      </p>
      <button
        type="button"
        onClick={prompt.turnOn}
        className="mt-1.5 inline-flex cursor-pointer items-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
      >
        Notify me
        <Icon aria-hidden name="ChevronRight" className="size-3" />
      </button>
      <button
        type="button"
        aria-label="Not now"
        onClick={prompt.notNow}
        className={`absolute right-1.5 top-1.5 ${CARD_CONTROL_CLASS}`}
      >
        <Icon aria-hidden name="X" className="size-3.5" />
      </button>
    </section>
  );
}
