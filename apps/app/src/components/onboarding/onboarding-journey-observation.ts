import type {
  RecordTelemetryEventRequest,
  SystemProviderState,
} from "@bb/server-contract";
import { useEffect, useRef } from "react";
import type { AgentSetupState, OnboardingStepId } from "./onboarding-model";

export function createVisibleTransitionObserver() {
  let previous: string | null = null;
  return (value: string, visible: boolean) => {
    if (!visible || previous === value) return null;
    const trigger = previous === null ? "step_visible" : "state_changed";
    previous = value;
    return trigger;
  };
}

export function useVisibleObservation<T extends HTMLElement>(
  observe: () => void,
) {
  const element = useRef<T>(null);
  const callback = useRef(observe);
  const intersecting = useRef(false);
  useEffect(() => {
    callback.current = observe;
    if (intersecting.current && document.visibilityState === "visible")
      observe();
  });
  useEffect(() => {
    const node = element.current;
    if (node === null) return;
    const notify = () => {
      if (intersecting.current && document.visibilityState === "visible")
        callback.current();
    };
    const observer = new IntersectionObserver((entries) => {
      intersecting.current = entries.some(
        (entry) => entry.isIntersecting && entry.intersectionRatio > 0,
      );
      notify();
    });
    observer.observe(node);
    document.addEventListener("visibilitychange", notify);
    window.addEventListener("resize", notify);
    return () => {
      observer.disconnect();
      intersecting.current = false;
      document.removeEventListener("visibilitychange", notify);
      window.removeEventListener("resize", notify);
    };
  }, []);
  return element;
}

export function agentDiagnostic(
  state: AgentSetupState,
): Pick<
  Extract<
    RecordTelemetryEventRequest,
    { name: "onboarding_agent_diagnostic" }
  >["properties"],
  "state" | "action_available"
> {
  switch (state.status) {
    case "signIn":
      return { state: "sign_in", action_available: state.canSignIn };
    case "signingIn":
      return { state: "signing_in", action_available: null };
    case "installFailed":
      return {
        state: "install_failed",
        action_available: state.canInstall,
      };
    case "install":
    case "update":
      return { state: state.status, action_available: state.canInstall };
    default:
      return { state: state.status, action_available: null };
  }
}

export function aggregateAgentReadiness(
  states: readonly Pick<SystemProviderState, "status">[] | undefined,
  failed: boolean,
): boolean | null {
  if (failed || states === undefined) return null;
  if (states.some((state) => state.status === "ready")) return true;
  return states.some((state) => state.status === "unknown") ? null : false;
}

export function onboardingNavigation(
  source: "first_run" | "replay",
  current_step: OnboardingStepId,
  action:
    | "continue"
    | "skip_step"
    | "skip_setup"
    | "back"
    | "select_step"
    | "leave",
  destination_step: OnboardingStepId | null,
  agentNotReady = false,
): Extract<
  RecordTelemetryEventRequest,
  { name: "onboarding_navigation" }
>["properties"] {
  const reason = agentNotReady
    ? "agent_not_ready"
    : action === "skip_step" || action === "skip_setup"
      ? "explicit_skip"
      : action === "leave"
        ? "navigation_away"
        : "none";
  return { source, current_step, action, destination_step, reason };
}
