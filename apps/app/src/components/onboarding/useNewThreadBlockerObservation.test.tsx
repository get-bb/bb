// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useNewThreadBlockerObservation,
  type NewThreadReadiness,
} from "./useNewThreadBlockerObservation";
import {
  recordOnboardingWorkSource,
  takeOnboardingWorkSource,
} from "./onboarding-work-context";

const capture = vi.hoisted(() => vi.fn());
vi.mock("./onboarding-telemetry", () => ({ recordTelemetryEvent: capture }));
const blocked: NewThreadReadiness = {
  status: "blocked",
  reason: "sign_in",
  message: "Sign in",
};
const ready: NewThreadReadiness = { status: "ready" };
function Observation({
  readiness = blocked,
  hasDraft = true,
}: {
  readiness?: NewThreadReadiness;
  hasDraft?: boolean;
}) {
  useNewThreadBlockerObservation(hasDraft, readiness);
  return null;
}
beforeEach(() => capture.mockClear());
afterEach(() => {
  cleanup();
  takeOnboardingWorkSource();
});

describe("draft blockers", () => {
  it("emits no events for empty composers, preserving the guide source until there is a draft", () => {
    recordOnboardingWorkSource("first_run");
    const view = render(<Observation hasDraft={false} />);
    expect(capture).not.toHaveBeenCalled();
    view.rerender(<Observation />);
    expect(capture).toHaveBeenCalledExactlyOnceWith({
      name: "new_thread_blocker",
      properties: {
        state: "shown",
        reason: "sign_in",
        surface: "homepage",
        entry: "first_run",
      },
    });
    expect(takeOnboardingWorkSource()).toBe("other");
  });
  it("deduplicates strict effects and rerenders without counting another first task", () => {
    const view = render(
      <StrictMode>
        <Observation />
      </StrictMode>,
    );
    view.rerender(
      <StrictMode>
        <Observation />
      </StrictMode>,
    );
    expect(capture).toHaveBeenCalledTimes(1);
    view.unmount();
    render(<Observation />);
    expect(capture.mock.calls.map(([event]) => event.name)).toEqual([
      "new_thread_blocker",
      "new_thread_blocker",
    ]);
  });
  it("keeps blockers unresolved through loading, empty drafts and higher-priority blockers until ready", () => {
    const view = render(<Observation />);
    view.rerender(
      <Observation readiness={{ status: "pending", message: "Loading" }} />,
    );
    view.rerender(<Observation hasDraft={false} readiness={ready} />);
    expect(capture).toHaveBeenCalledTimes(1);
    view.rerender(
      <Observation
        readiness={{
          status: "blocked",
          reason: "provider_selection",
          message: "Select",
        }}
      />,
    );
    expect(
      capture.mock.calls.every(([event]) => event.properties.state === "shown"),
    ).toBe(true);
    view.rerender(<Observation readiness={ready} />);
    expect(
      capture.mock.calls
        .filter(([event]) => event.properties.state === "cleared")
        .map(([event]) => event.properties.reason),
    ).toEqual(["sign_in", "provider_selection"]);
    view.rerender(<Observation readiness={ready} />);
    expect(capture).toHaveBeenCalledTimes(4);
  });
});
