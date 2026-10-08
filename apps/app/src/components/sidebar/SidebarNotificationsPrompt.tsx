import { useCallback, useEffect, useState } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { PUSH_NOTIFICATIONS_PLUGIN_ID } from "@/components/onboarding/onboarding-model";
import { recordTelemetryEvent } from "@/components/onboarding/onboarding-telemetry";
import { SidebarMenuItem } from "@/components/ui/sidebar.js";
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

const PROMPT_LABEL = "Get notified when an agent needs you";

const CHIP_CLASS = cn(
  "flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-sidebar-border px-2",
  "text-xs font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
);

export function SidebarNotificationsPrompt() {
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

  if (!visible) return null;
  return (
    <SidebarMenuItem className="flex min-w-0 items-center">
      <div className={cn(CHIP_CLASS, "gap-0 pr-0.5")}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={PROMPT_LABEL}
              data-testid="sidebar-notifications-prompt"
              className="flex items-center gap-1.5 pr-1"
              onClick={() => {
                setPromptState("answered");
                void requestNotificationPermission("sidebar");
              }}
            >
              <Icon name="BellDot" className="size-3 text-muted-foreground" />
              Notify me
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{PROMPT_LABEL}</TooltipContent>
        </Tooltip>
        <button
          type="button"
          aria-label="Not now"
          className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:text-sidebar-foreground"
          onClick={() => {
            setPromptState("answered");
            recordTelemetryEvent({
              name: "notification_prompt_dismissed",
              properties: { surface: "sidebar" },
            });
          }}
        >
          <Icon name="X" aria-hidden className="size-3" />
        </button>
      </div>
    </SidebarMenuItem>
  );
}
