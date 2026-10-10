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

const ART_INK = "color-mix(in oklch, var(--ink) 82%, var(--canvas))";
const ART_LINE = {
  stroke: "currentColor",
  strokeWidth: 1.1,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  fill: "none",
} as const;

function NotificationArt() {
  return (
    <svg
      aria-hidden
      focusable="false"
      data-testid="sidebar-notifications-art"
      viewBox="0 0 48 48"
      className="size-10 shrink-0"
      style={{ color: ART_INK }}
    >
      <rect
        {...ART_LINE}
        x={13}
        y={5}
        width={22}
        height={38}
        rx={4.5}
        fill="currentColor"
        fillOpacity={0.1}
      />
      <line
        {...ART_LINE}
        strokeOpacity={0.4}
        x1={21.5}
        y1={9}
        x2={26.5}
        y2={9}
      />
      <g style={{ color: "var(--timeline-accent)" }}>
        <rect
          {...ART_LINE}
          x={6}
          y={16}
          width={30}
          height={11}
          rx={3}
          fill="var(--canvas)"
        />
        <rect
          x={6}
          y={16}
          width={30}
          height={11}
          rx={3}
          fill="currentColor"
          fillOpacity={0.18}
        />
        <circle cx={11.5} cy={21.5} r={2} fill="currentColor" />
        <line {...ART_LINE} x1={16} y1={19.5} x2={30} y2={19.5} />
        <line
          {...ART_LINE}
          strokeOpacity={0.5}
          x1={16}
          y1={23.5}
          x2={26}
          y2={23.5}
        />
      </g>
      <line {...ART_LINE} strokeOpacity={0.4} x1={18} y1={33} x2={30} y2={33} />
      <line {...ART_LINE} strokeOpacity={0.4} x1={18} y1={37} x2={26} y2={37} />
    </svg>
  );
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
      className={`${CARD_SURFACE_CLASS} px-3 pb-3 pt-3`}
    >
      <div className="flex min-w-0 items-start gap-3 pr-5">
        <NotificationArt />
        <p
          id={labelId}
          className="min-w-0 flex-1 pt-0.5 text-sm font-medium leading-snug text-foreground"
        >
          Get notified when this agent needs you
        </p>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        bb tells you when it finishes or asks you a question, even in another
        tab.
      </p>
      <button
        type="button"
        onClick={prompt.turnOn}
        className="mt-2.5 inline-flex cursor-pointer items-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
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
