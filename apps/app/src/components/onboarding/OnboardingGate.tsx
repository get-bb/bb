import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { useUpdateGeneralSettings } from "@/hooks/mutations/settings-mutations";
import {
  useSetupGuideAssignment,
  useSystemConfig,
} from "@/hooks/queries/system-queries";
import type { SetupGuide } from "./onboarding-model";

const OnboardingFlow = lazy(() =>
  import("./OnboardingFlow").then((module) => ({
    default: module.OnboardingFlow,
  })),
);

const ONBOARDING_SEEN_STORAGE_KEY = "bb.onboarding.seen";

const CONTROL_SETUP_GUIDE: SetupGuide = {
  variant: "control",
  featuredPluginEntryIds: null,
};

function readOnboardingSeen(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_SEEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberOnboardingSeen(): void {
  try {
    window.localStorage.setItem(ONBOARDING_SEEN_STORAGE_KEY, "1");
  } catch {
    return;
  }
}

export function OnboardingGate({ children }: { children: ReactNode }) {
  const configQuery = useSystemConfig();
  const updateSettings = useUpdateGeneralSettings();
  const [firstRunClosed, setFirstRunClosed] = useState(false);
  const [seenBefore] = useState(readOnboardingSeen);

  const settings = configQuery.data?.generalSettings;
  const completedAt = settings?.onboardingCompletedAt;
  const setupGuideQuery = useSetupGuideAssignment({
    enabled: completedAt === null,
  });
  useEffect(() => {
    if (typeof completedAt === "string") rememberOnboardingSeen();
  }, [completedAt]);

  if (
    firstRunClosed &&
    typeof completedAt === "string" &&
    !updateSettings.isPending
  ) {
    setFirstRunClosed(false);
  }

  if (settings === undefined) {
    return seenBefore || configQuery.isError || configQuery.failureCount > 0
      ? children
      : null;
  }

  const firstRun = settings.onboardingCompletedAt === null && !firstRunClosed;
  if (!firstRun) return children;
  if (setupGuideQuery.isPending) return null;
  const setupGuide = setupGuideQuery.data ?? CONTROL_SETUP_GUIDE;

  return (
    <TooltipProvider delayDuration={300} disableHoverableContent>
      <div className="flex h-dvh w-full flex-col bg-background pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[var(--bb-safe-area-bottom,env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)]">
        <Suspense fallback={null}>
          <OnboardingFlow
            initialStep="agent"
            setupGuide={setupGuide}
            entry={seenBefore ? "replay" : "first_run"}
            onClose={() => {
              setFirstRunClosed(true);
              updateSettings.mutate(
                {
                  ...settings,
                  onboardingCompletedAt: new Date().toISOString(),
                },
                { onError: () => setFirstRunClosed(false) },
              );
            }}
          />
        </Suspense>
      </div>
    </TooltipProvider>
  );
}
