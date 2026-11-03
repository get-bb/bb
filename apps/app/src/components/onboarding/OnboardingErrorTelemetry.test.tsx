// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import type { OnboardingStepId } from "./onboarding-model";
import { recordTelemetryEvent } from "./onboarding-telemetry";
import {
  OnboardingErrorTelemetry,
  useOnboardingErrorStep,
} from "./OnboardingErrorTelemetry";

vi.mock("./onboarding-telemetry", () => ({ recordTelemetryEvent: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function Guide({
  step,
  crash = false,
}: {
  step: OnboardingStepId;
  crash?: boolean;
}) {
  useOnboardingErrorStep(step);
  if (crash) throw new Error("secret /Users/me/project");
  return <p>guide on {step}</p>;
}

function renderGuide(step: OnboardingStepId) {
  const view = render(
    <AppErrorBoundary>
      <OnboardingErrorTelemetry entry="first_run" initialStep="agent">
        <Guide step={step} />
      </OnboardingErrorTelemetry>
    </AppErrorBoundary>,
  );
  return {
    ...view,
    goTo(next: OnboardingStepId, crash = false) {
      view.rerender(
        <AppErrorBoundary>
          <OnboardingErrorTelemetry entry="first_run" initialStep="agent">
            <Guide step={next} crash={crash} />
          </OnboardingErrorTelemetry>
        </AppErrorBoundary>,
      );
    },
  };
}

function throwUncaught() {
  act(() => {
    window.dispatchEvent(
      new ErrorEvent("error", { message: "secret /Users/me/project" }),
    );
  });
}

function rejectUnhandled() {
  act(() => {
    window.dispatchEvent(new Event("unhandledrejection"));
  });
}

function reportedErrors() {
  return vi.mocked(recordTelemetryEvent).mock.calls.map(([event]) => event);
}

describe("onboarding error telemetry", () => {
  it("reports a guide crash with its step and leaves the app's crash screen unchanged", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = renderGuide("agent");
    view.goTo("projects");
    view.goTo("projects", true);

    expect(reportedErrors()).toEqual([
      {
        name: "onboarding_error",
        properties: { step: "projects", entry: "first_run", kind: "render" },
      },
    ]);
    expect(view.container.textContent).toContain("bb hit an error and stopped");
  });

  it("reports each kind once per step", () => {
    const view = renderGuide("agent");
    throwUncaught();
    throwUncaught();
    rejectUnhandled();
    rejectUnhandled();
    view.goTo("plugins");
    throwUncaught();

    expect(reportedErrors()).toEqual([
      {
        name: "onboarding_error",
        properties: { step: "agent", entry: "first_run", kind: "uncaught" },
      },
      {
        name: "onboarding_error",
        properties: {
          step: "agent",
          entry: "first_run",
          kind: "unhandled_rejection",
        },
      },
      {
        name: "onboarding_error",
        properties: { step: "plugins", entry: "first_run", kind: "uncaught" },
      },
    ]);
  });

  it("stops after a few reports per guide", () => {
    const view = renderGuide("agent");
    for (const step of ["agent", "projects", "plugins", "devices"] as const) {
      view.goTo(step);
      throwUncaught();
      rejectUnhandled();
    }

    expect(recordTelemetryEvent).toHaveBeenCalledTimes(5);
  });

  it("stays silent once the guide closes", () => {
    const view = renderGuide("agent");
    view.unmount();
    throwUncaught();
    rejectUnhandled();

    expect(recordTelemetryEvent).not.toHaveBeenCalled();
  });
});
