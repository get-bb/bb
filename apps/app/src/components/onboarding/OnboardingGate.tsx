import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { useUpdateGeneralSettings } from "@/hooks/mutations/settings-mutations";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useSetupGuideRequest } from "./setup-guide-request";

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
  const [firstRunClosed, setFirstRunClosed] = useState(false);
  const [seenBefore] = useState(readOnboardingSeen);
  const [requestedStep, setRequestedStep] = useSetupGuideRequest();

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
  if (!firstRun) {
    if (requestedStep === null) return children;
    return (
      <>
        {children}
        <TooltipProvider delayDuration={300} disableHoverableContent>
          <div className="fixed inset-0 z-50 flex h-dvh w-full flex-col bg-background">
            <Suspense fallback={null}>
              <OnboardingFlow
                initialStep={requestedStep}
                onClose={() => setRequestedStep(null)}
              />
            </Suspense>
          </div>
        </TooltipProvider>
      </>
    );
  }

  return (
    <TooltipProvider delayDuration={300} disableHoverableContent>
      <div className="flex h-dvh w-full flex-col bg-background pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[var(--bb-safe-area-bottom,env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)]">
        <Suspense fallback={null}>
          <OnboardingFlow
            initialStep="agent"
            entry={seenBefore ? "replay" : "first_run"}
            onClose={() => {
              setFirstRunClosed(true);
              updateSettings.mutate({
                ...settings,
                onboardingCompletedAt: new Date().toISOString(),
              });
            }}
          />
        </Suspense>
      </div>
    </TooltipProvider>
  );
}
