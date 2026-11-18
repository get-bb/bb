import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { ScreenPaintSignal } from "@/components/ScreenPaintSignal";
import { useUpdateGeneralSettings } from "@/hooks/mutations/settings-mutations";
import { usePrimaryHost } from "@/hooks/queries/host-queries";
import {
  useHostProviderCliStatus,
  useSystemConfig,
} from "@/hooks/queries/system-queries";
import { operationFailureReason } from "./onboarding-model";
import { recordTelemetryEvent } from "./onboarding-telemetry";
import { OnboardingErrorTelemetry } from "./OnboardingErrorTelemetry";

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

  const settings = configQuery.data?.generalSettings;
  const completedAt = settings?.onboardingCompletedAt;
  const prefetchInstallInfo = completedAt === null;
  const primaryHost = usePrimaryHost({ enabled: prefetchInstallInfo });
  useHostProviderCliStatus({
    hostId: primaryHost?.id ?? null,
    enabled: prefetchInstallInfo,
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
  if (!firstRun && !firstRunClosed) return children;
  const entry = seenBefore ? "replay" : "first_run";

  return (
    <>
      {firstRunClosed ? children : null}
      <TooltipProvider delayDuration={300} disableHoverableContent>
        <div
          hidden={firstRunClosed}
          className="flex h-dvh w-full flex-col bg-background pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[var(--bb-safe-area-bottom,env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)]"
        >
          <OnboardingErrorTelemetry
            entry={entry}
            initialStep="agent"
            closing={firstRunClosed}
          >
            <Suspense fallback={null}>
              <OnboardingFlow
                initialStep="agent"
                entry={entry}
                closing={firstRunClosed}
                onClose={(lastStep) => {
                  setFirstRunClosed(true);
                  updateSettings.mutate(
                    {
                      ...settings,
                      onboardingCompletedAt: new Date().toISOString(),
                    },
                    {
                      onError: (error) => {
                        recordTelemetryEvent({
                          name: "onboarding_operation",
                          properties: {
                            entry,
                            step: lastStep,
                            operation: "finish",
                            outcome: "failed",
                            failure_reason: operationFailureReason(error),
                          },
                        });
                        setFirstRunClosed(false);
                      },
                    },
                  );
                }}
              />
              <ScreenPaintSignal />
            </Suspense>
          </OnboardingErrorTelemetry>
        </div>
      </TooltipProvider>
    </>
  );
}
