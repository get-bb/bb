import { useEffect, useRef } from "react";
import type { SystemProviderState } from "@bb/server-contract";
import { agentStateTelemetryProperties } from "./onboarding-model";
import {
  recordTelemetryEvent,
  type OnboardingEntry,
} from "./onboarding-telemetry";

export function useAgentStateTelemetry({
  entry,
  states,
  isError,
}: {
  entry: OnboardingEntry;
  states: readonly SystemProviderState[] | undefined;
  isError: boolean;
}): void {
  const reportedKey = useRef<string | null>(null);
  useEffect(() => {
    if (states === undefined && !isError) return;
    const properties = agentStateTelemetryProperties(
      entry,
      isError ? undefined : states,
    );
    const key = JSON.stringify(properties);
    if (reportedKey.current === key) return;
    reportedKey.current = key;
    recordTelemetryEvent({ name: "onboarding_agent_state", properties });
  }, [entry, isError, states]);
}
