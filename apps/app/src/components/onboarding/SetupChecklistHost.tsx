import { useCallback, useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { ProviderRequirementBanner } from "@/components/promptbox/banner/ProviderRequirementBanner";
import { useUpdateGeneralSettings } from "@/hooks/mutations/settings-mutations";
import { useHosts, usePrimaryHost } from "@/hooks/queries/host-queries";
import { usePluginList } from "@/hooks/queries/plugin-settings-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import {
  useSystemConfig,
  useSystemProviderStates,
} from "@/hooks/queries/system-queries";
import {
  NoAgentNotice,
  SetupChecklist,
  type SetupChecklistItem,
} from "./SetupChecklistViews";
import {
  ONBOARDING_PLUGINS,
  connectAccessUrl,
  hasNoUsableAgent,
  hasReadyAgent,
  type OnboardingStepId,
} from "./onboarding-model";
import { onboardingReopenStepAtom } from "./onboarding-state";

interface SetupChecklistState {
  items: SetupChecklistItem[] | null;
  agentMissing: boolean;
  open: (step: OnboardingStepId) => void;
  dismiss: () => void;
}

export function useSetupChecklist(): SetupChecklistState {
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

  const states = statesQuery.data?.providers;
  const agentReady = hasReadyAgent(states);
  const agentMissing = visible && hasNoUsableAgent(states);
  const open = (step: OnboardingStepId) => setReopenStep(step);
  const { mutate: updateSettingsMutate } = updateSettings;
  const dismiss = useCallback(() => {
    if (settings === undefined) return;
    updateSettingsMutate({ ...settings, setupChecklistVisible: false });
  }, [settings, updateSettingsMutate]);

  const projectCount = navigationQuery.data?.projects.length;
  const installedPlugins = pluginsQuery.data?.plugins;
  const enabledPluginCount =
    installedPlugins === undefined
      ? undefined
      : ONBOARDING_PLUGINS.filter(({ pluginId }) =>
          installedPlugins.some(
            (plugin) => plugin.id === pluginId && plugin.enabled,
          ),
        ).length;
  const connect = connectAccessUrl(configQuery.data?.serverAccess);
  const machineCount = hostsQuery.data?.length ?? 0;
  const devicesDone = connect.status === "on" || machineCount > 1;
  const everythingDone =
    visible &&
    agentReady &&
    projectCount !== undefined &&
    projectCount > 0 &&
    enabledPluginCount !== undefined &&
    enabledPluginCount > 0 &&
    devicesDone;
  const clearedRef = useRef(false);
  useEffect(() => {
    if (!everythingDone || clearedRef.current) return;
    clearedRef.current = true;
    dismiss();
  }, [dismiss, everythingDone]);

  if (
    !visible ||
    states === undefined ||
    projectCount === undefined ||
    enabledPluginCount === undefined
  ) {
    return { items: null, agentMissing, open, dismiss };
  }

  const items: SetupChecklistItem[] = [
    {
      id: "agent",
      title: "Connect a coding agent",
      detail: agentReady
        ? "Ready on this computer"
        : "Needed before a thread can start",
      done: agentReady,
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
      actionLabel: "Review",
    },
    {
      id: "plugins",
      title: "Pick some plugins",
      detail:
        enabledPluginCount > 0
          ? `${enabledPluginCount} turned on`
          : "Browser automation, workflows, and more",
      done: enabledPluginCount > 0,
      actionLabel: "Browse",
    },
    {
      id: "devices",
      title: "Use bb from anywhere",
      detail:
        connect.status === "on"
          ? connect.url
          : "Phone, browser, other machines",
      done: devicesDone,
      actionLabel: "Set up",
    },
  ];
  return {
    items: items.every((item) => item.done) ? null : items,
    agentMissing,
    open,
    dismiss,
  };
}

export function SetupChecklistCard({
  checklist,
}: {
  checklist: SetupChecklistState;
}) {
  if (!checklist.agentMissing && checklist.items === null) return null;
  return (
    <div className="flex w-full flex-col items-center gap-4">
      {checklist.agentMissing ? (
        <NoAgentNotice onSetUp={() => checklist.open("agent")} />
      ) : null}
      {checklist.items === null ? null : (
        <SetupChecklist
          items={checklist.items}
          onOpen={checklist.open}
          onDismiss={checklist.dismiss}
        />
      )}
    </div>
  );
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
            onClick={() => checklist.open("agent")}
          >
            Connect an agent
          </Button>
        }
      />
    );
  }
  if (checklist.items === null) return null;
  const remaining = checklist.items.filter((item) => !item.done);
  const next = remaining[0];
  if (next === undefined) return null;
  return (
    <PromptStackCard ariaLabel="Finish setting up bb">
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground">
            Finish setting up bb
          </p>
          <p className="mt-0.5 truncate text-xs text-subtle-foreground">
            {checklist.items.length - remaining.length} of{" "}
            {checklist.items.length} done · next: {next.title.toLowerCase()}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 shrink-0 px-3"
          onClick={() => checklist.open(next.id)}
        >
          Continue
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
