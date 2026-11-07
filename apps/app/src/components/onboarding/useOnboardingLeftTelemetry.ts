import { useEffect, useRef } from "react";
import type { OnboardingStepId } from "./onboarding-model";
import {
  recordTelemetryEvent,
  type OnboardingEntry,
} from "./onboarding-telemetry";

interface UseOnboardingLeftTelemetryArgs {
  entry: OnboardingEntry;
  step: OnboardingStepId;
  finishedRef: { readonly current: boolean };
}

export function useOnboardingLeftTelemetry({
  entry,
  step,
  finishedRef,
}: UseOnboardingLeftTelemetryArgs): void {
  const stepRef = useRef(step);
  const leftRef = useRef(false);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);
  useEffect(() => {
    const onPageHide = () => {
      if (finishedRef.current || leftRef.current) return;
      leftRef.current = true;
      recordTelemetryEvent(
        {
          name: "onboarding_left",
          properties: { step: stepRef.current, entry },
        },
        { keepalive: true },
      );
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [entry, finishedRef]);
}
