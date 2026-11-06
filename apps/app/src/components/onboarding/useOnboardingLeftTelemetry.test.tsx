// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OnboardingStepId } from "./onboarding-model";
import { recordTelemetryEvent } from "./onboarding-telemetry";
import { useOnboardingLeftTelemetry } from "./useOnboardingLeftTelemetry";

vi.mock("./onboarding-telemetry", () => ({ recordTelemetryEvent: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderLeftTelemetry(finishedRef = { current: false }) {
  return renderHook(
    (step: OnboardingStepId) =>
      useOnboardingLeftTelemetry({ entry: "first_run", step, finishedRef }),
    { initialProps: "agent" },
  );
}

function hidePage() {
  window.dispatchEvent(new Event("pagehide"));
}

describe("onboarding left telemetry", () => {
  it("reports the current step once as a keepalive request when the page goes away", () => {
    const view = renderLeftTelemetry();
    view.rerender("plugins");
    hidePage();
    hidePage();

    expect(recordTelemetryEvent).toHaveBeenCalledExactlyOnceWith(
      {
        name: "onboarding_left",
        properties: { step: "plugins", entry: "first_run" },
      },
      { keepalive: true },
    );
  });

  it("ignores tab switches", () => {
    renderLeftTelemetry();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    Reflect.deleteProperty(document, "visibilityState");

    expect(recordTelemetryEvent).not.toHaveBeenCalled();
  });

  it("stays silent after the guide finished", () => {
    const finishedRef = { current: false };
    renderLeftTelemetry(finishedRef);
    finishedRef.current = true;
    hidePage();

    expect(recordTelemetryEvent).not.toHaveBeenCalled();
  });

  it("stops listening once the guide closes", () => {
    const view = renderLeftTelemetry();
    view.unmount();
    hidePage();

    expect(recordTelemetryEvent).not.toHaveBeenCalled();
  });
});
