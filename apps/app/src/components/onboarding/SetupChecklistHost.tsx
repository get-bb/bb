import { useCallback, useEffect, useRef, useState } from "react";
import { useSetAtom } from "jotai";
import {
  setupChecklistItemIdSchema,
  type SetupChecklistItemId,
} from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { ProviderRequirementBanner } from "@/components/promptbox/banner/ProviderRequirementBanner";
import { listSidebarNavigationThreads } from "@/hooks/cache-owners/query-cache";
import { useUpdateGeneralSettings } from "@/hooks/mutations/settings-mutations";
import { useHosts, usePrimaryHost } from "@/hooks/queries/host-queries";
import { usePluginList } from "@/hooks/queries/plugin-settings-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import {
  useSystemConfig,
  useSystemProviderStates,
} from "@/hooks/queries/system-queries";
import { isInsideNativeShell } from "@/lib/native-shell/native-shell";
import {
  ONBOARDING_PLUGINS,
  PUSH_NOTIFICATIONS_PLUGIN_ID,
  connectAccessUrl,
  hasNoUsableAgent,
  hasReadyAgent,
} from "./onboarding-model";
import { onboardingReopenStepAtom } from "./onboarding-state";
import { recordTelemetryEvent } from "./onboarding-telemetry";

export interface SetupChecklistItem {
  id: SetupChecklistItemId;
  title: string;
  detail: string;
  done: boolean;
  optional: boolean;
  actionLabel: string;
}

const COMPLETED_ITEMS_STORAGE_KEY = "bb.setupChecklist.completedItems";

type NotificationPermissionState = NotificationPermission | "unsupported";

function readNotificationPermission(): NotificationPermissionState {
  return typeof Notification === "undefined" ||
    !window.isSecureContext ||
    isInsideNativeShell()
    ? "unsupported"
    : Notification.permission;
}

function useNotificationPermission() {
  const [permission, setPermission] = useState(readNotificationPermission);
  useEffect(() => {
    const refresh = () => setPermission(readNotificationPermission());
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  const request = useCallback(() => {
    void Notification.requestPermission()
      .then((result) => {
        setPermission(result);
        recordTelemetryEvent({
          name:
            result === "granted"
              ? "notification_prompt_accepted"
              : result === "denied"
                ? "notification_prompt_denied"
                : "notification_prompt_dismissed",
          properties: { surface: "checklist" },
        });
      })
      .catch(() => setPermission(readNotificationPermission()));
  }, []);
  return { permission, request };
}

function readCompletedItems(): Set<string> | null {
  try {
    const raw = window.localStorage.getItem(COMPLETED_ITEMS_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((id) => typeof id === "string"))
      : null;
  } catch {
    return null;
  }
}

function writeCompletedItems(ids: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(
      COMPLETED_ITEMS_STORAGE_KEY,
      JSON.stringify([...ids]),
    );
  } catch {
    return;
  }
}

function useChecklistCompletionTelemetry(
  items: readonly SetupChecklistItem[] | null,
): void {
  const progress =
    items === null
      ? null
      : items
          .filter((item) => item.done)
          .map(
            (item) => `${item.id}:${item.optional ? "optional" : "required"}`,
          )
          .join(",");
  useEffect(() => {
    if (progress === null) return;
    const stored = readCompletedItems();
    const headStart = stored === null;
    const seen = stored ?? new Set<string>();
    let changed = headStart;
    for (const entry of progress === "" ? [] : progress.split(",")) {
      const [rawId, kind] = entry.split(":");
      const parsed = setupChecklistItemIdSchema.safeParse(rawId);
      if (!parsed.success || seen.has(parsed.data)) continue;
      const id = parsed.data;
      seen.add(id);
      changed = true;
      recordTelemetryEvent({
        name: "setup_checklist_item_completed",
        properties: {
          item: id,
          optional: kind === "optional",
          head_start: headStart,
        },
      });
    }
    if (changed) writeCompletedItems(seen);
  }, [progress]);
}

interface UseSetupChecklistArgs {
  onStartThread: () => void;
}

interface SetupChecklistState {
  items: SetupChecklistItem[] | null;
  agentMissing: boolean;
  setupComplete: boolean;
  act: (id: SetupChecklistItemId) => void;
  dismiss: () => void;
}

export function useSetupChecklist({
  onStartThread,
}: UseSetupChecklistArgs): SetupChecklistState {
  const configQuery = useSystemConfig();
  const updateSettings = useUpdateGeneralSettings();
  const setReopenStep = useSetAtom(onboardingReopenStepAtom);
  const primaryHost = usePrimaryHost();
  const hostId = primaryHost?.id ?? null;
  const settings = configQuery.data?.generalSettings;
  const onboarded =
    settings !== undefined && settings.onboardingCompletedAt !== null;
  const visible = onboarded && settings.setupChecklistVisible;

  const statesQuery = useSystemProviderStates({
    enabled: visible && hostId !== null,
    poll: false,
    ...(hostId === null ? {} : { hostId }),
  });
  const navigationQuery = useSidebarNavigation({ enabled: visible });
  const pluginsQuery = usePluginList({ enabled: visible });
  const hostsQuery = useHosts({ enabled: visible });
  const notifications = useNotificationPermission();

  const states = statesQuery.data?.providers;
  const agentReady = hasReadyAgent(states);
  const agentMissing = visible && hasNoUsableAgent(states);
  const { mutate: updateSettingsMutate } = updateSettings;
  const hide = useCallback(() => {
    if (settings === undefined) return;
    updateSettingsMutate({ ...settings, setupChecklistVisible: false });
  }, [settings, updateSettingsMutate]);

  const navigation = navigationQuery.data;
  const projectCount = navigation?.projects.length;
  const threadCount =
    navigation === undefined
      ? undefined
      : listSidebarNavigationThreads(navigation).length;
  const installedPlugins = pluginsQuery.data?.plugins;
  const enabledPluginCount =
    installedPlugins === undefined
      ? undefined
      : ONBOARDING_PLUGINS.filter(({ pluginId }) =>
          installedPlugins.some(
            (plugin) => plugin.id === pluginId && plugin.enabled,
          ),
        ).length;
  const pushNotificationsEnabled =
    installedPlugins?.some(
      (plugin) => plugin.id === PUSH_NOTIFICATIONS_PLUGIN_ID && plugin.enabled,
    ) ?? false;
  const connect = connectAccessUrl(configQuery.data?.serverAccess);
  const machineCount = hostsQuery.data?.length ?? 0;
  const devicesDone = connect.status === "on" || machineCount > 1;
  const showNotifications =
    pushNotificationsEnabled &&
    (notifications.permission === "default" ||
      notifications.permission === "granted");

  const allItems: SetupChecklistItem[] | null =
    !visible ||
    states === undefined ||
    projectCount === undefined ||
    threadCount === undefined ||
    enabledPluginCount === undefined
      ? null
      : [
          {
            id: "agent",
            title: "Connect a coding agent",
            detail: agentReady
              ? "Ready on this computer"
              : "Needed before a thread can start",
            done: agentReady,
            optional: false,
            actionLabel: "Set up",
          },
          {
            id: "projects",
            title: "Add your projects",
            detail:
              projectCount > 0
                ? `${projectCount} added`
                : "Import the repos you've used recently",
            done: projectCount > 0,
            optional: false,
            actionLabel: "Add",
          },
          {
            id: "thread",
            title: "Start your first thread",
            detail:
              threadCount > 0
                ? "Your threads live in the sidebar"
                : "Ask your agent what bb can do",
            done: threadCount > 0,
            optional: false,
            actionLabel: "Start",
          },
          {
            id: "plugins",
            title: "Pick plugins",
            detail:
              enabledPluginCount > 0
                ? `${enabledPluginCount} turned on`
                : "Browser automation, workflows, and more. Off until you want them.",
            done: enabledPluginCount > 0,
            optional: true,
            actionLabel: "Browse",
          },
          {
            id: "devices",
            title: "Use bb from anywhere",
            detail:
              connect.status === "on"
                ? connect.url
                : "Check on agents from your phone, with a push when one needs you",
            done: devicesDone,
            optional: true,
            actionLabel: "Set up",
          },
          ...(showNotifications
            ? [
                {
                  id: "notifications" as const,
                  title: "Turn on notifications",
                  detail:
                    notifications.permission === "granted"
                      ? "On for this device"
                      : "Know when an agent finishes or needs your answer",
                  done: notifications.permission === "granted",
                  optional: true,
                  actionLabel: "Turn on",
                },
              ]
            : []),
        ];
  useChecklistCompletionTelemetry(allItems);

  const everythingDone =
    allItems !== null && allItems.every((item) => item.done);
  const clearedRef = useRef(false);
  useEffect(() => {
    if (!everythingDone || clearedRef.current) return;
    clearedRef.current = true;
    hide();
  }, [everythingDone, hide]);

  const act = (id: SetupChecklistItemId) => {
    switch (id) {
      case "thread":
        onStartThread();
        return;
      case "notifications":
        notifications.request();
        return;
      default:
        setReopenStep(id);
    }
  };
  const dismiss = () => {
    if (allItems !== null) {
      const required = allItems.filter((item) => !item.optional);
      const optional = allItems.filter((item) => item.optional);
      recordTelemetryEvent({
        name: "setup_checklist_dismissed",
        properties: {
          required_done: required.filter((item) => item.done).length,
          required_total: required.length,
          optional_done: optional.filter((item) => item.done).length,
          optional_total: optional.length,
        },
      });
    }
    hide();
  };

  return {
    items: everythingDone ? null : allItems,
    agentMissing,
    setupComplete: onboarded && (!visible || everythingDone),
    act,
    dismiss,
  };
}

export function hasSetupChecklistBanner(
  checklist: SetupChecklistState,
): boolean {
  return checklist.agentMissing || checklist.items !== null;
}

export function SetupChecklistBanner({
  checklist,
}: {
  checklist: SetupChecklistState;
}) {
  if (checklist.agentMissing) {
    return (
      <ProviderRequirementBanner
        title="No agent is ready on this computer"
        description="Threads can't start until an agent is installed and signed in."
        action={
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0 px-3"
            onClick={() => checklist.act("agent")}
          >
            Connect an agent
          </Button>
        }
      />
    );
  }
  if (checklist.items === null) return null;
  const required = checklist.items.filter((item) => !item.optional);
  const remainingRequired = required.filter((item) => !item.done);
  const next =
    remainingRequired[0] ?? checklist.items.find((item) => !item.done);
  if (next === undefined) return null;
  return (
    <PromptStackCard ariaLabel="Finish setting up bb">
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground">
            {next.optional ? `Optional: ${next.title}` : "Finish setting up bb"}
          </p>
          <p className="mt-0.5 truncate text-xs text-subtle-foreground">
            {next.optional
              ? next.detail
              : `${required.length - remainingRequired.length} of ${required.length} done · next: ${next.title.toLowerCase()}`}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 shrink-0 px-3"
          onClick={() => checklist.act(next.id)}
        >
          {next.optional ? next.actionLabel : "Continue"}
        </Button>
        <button
          type="button"
          aria-label="Dismiss setup checklist"
          onClick={checklist.dismiss}
          className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
        >
          <Icon name="X" aria-hidden className="size-4" />
        </button>
      </div>
    </PromptStackCard>
  );
}
