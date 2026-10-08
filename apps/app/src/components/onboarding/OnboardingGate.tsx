import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { useAtom } from "jotai";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { useUpdateGeneralSettings } from "@/hooks/mutations/settings-mutations";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { onboardingReopenStepAtom } from "./onboarding-state";

const OnboardingFlow = lazy(() =>
  import("./OnboardingFlow").then((module) => ({
    default: module.OnboardingFlow,
  })),
);

const ONBOARDING_SEEN_STORAGE_KEY = "bb.onboarding.seen";

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
  const [reopenStep, setReopenStep] = useAtom(onboardingReopenStepAtom);
  const [firstRunClosed, setFirstRunClosed] = useState(false);
  const [seenBefore] = useState(readOnboardingSeen);

  const settings = configQuery.data?.generalSettings;
  const completedAt = settings?.onboardingCompletedAt;
  useEffect(() => {
    if (typeof completedAt === "string") rememberOnboardingSeen();
  }, [completedAt]);

  if (firstRunClosed && typeof completedAt === "string") {
    setFirstRunClosed(false);
  }

  if (settings === undefined) {
    return seenBefore || configQuery.isError || configQuery.failureCount > 0
      ? children
      : null;
  }

  const firstRun = settings.onboardingCompletedAt === null && !firstRunClosed;
  if (!firstRun && reopenStep === null) return children;

  return (
    <TooltipProvider delayDuration={300} disableHoverableContent>
      <div className="flex h-dvh w-full flex-col bg-background">
        <Suspense fallback={null}>
          <OnboardingFlow
            key={reopenStep ?? "first-run"}
            initialStep={reopenStep ?? "agent"}
            entry={firstRun ? "first_run" : "checklist"}
            onClose={() => {
              if (firstRun) {
                setFirstRunClosed(true);
                updateSettings.mutate({
                  ...settings,
                  onboardingCompletedAt: new Date().toISOString(),
                  setupChecklistVisible: true,
                });
              }
              setReopenStep(null);
            }}
          />
        </Suspense>
      </div>
    </TooltipProvider>
  );
}
