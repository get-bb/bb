// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkSurfaceObservation,
  type NewThreadReadiness,
} from "./WorkSurfaceObservation";
import {
  recordOnboardingWorkEntry,
  takeOnboardingWorkEntry,
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
  return (
    <WorkSurfaceObservation
      identity="same-local-draft"
      hasDraft={hasDraft}
      readiness={readiness}
    >
      <div data-app-composer="">Composer</div>
    </WorkSurfaceObservation>
  );
}

beforeEach(() => {
  capture.mockClear();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(10, 10, 300, 100),
  );
});

afterEach(async () => {
  cleanup();
  await Promise.resolve();
  takeOnboardingWorkEntry();
  vi.restoreAllMocks();
});

describe("visible work measurement", () => {
  it("deduplicates strict effects, rerenders and simultaneous views of the same draft", () => {
    const view = render(
      <StrictMode>
        <Observation />
        <Observation />
      </StrictMode>,
    );
    view.rerender(
      <StrictMode>
        <Observation />
        <Observation />
      </StrictMode>,
    );
    expect(capture.mock.calls.map(([event]) => event.name)).toEqual([
      "onboarding_work_surface",
      "new_thread_blocker",
    ]);
  });

  it("retains a shown blocker through loading and empty drafts without declaring resolution", () => {
    const view = render(<Observation />);
    view.rerender(
      <Observation readiness={{ status: "pending", message: "Loading" }} />,
    );
    view.rerender(<Observation readiness={ready} hasDraft={false} />);
    view.rerender(<Observation />);
    expect(capture).toHaveBeenCalledTimes(2);
    view.rerender(<Observation readiness={ready} />);
    expect(capture).toHaveBeenLastCalledWith({
      name: "new_thread_blocker",
      properties: { state: "cleared", reason: "sign_in", source: "other" },
    });
    view.rerender(<Observation readiness={ready} />);
    expect(capture).toHaveBeenCalledTimes(3);
  });

  it("does not treat a newly higher-priority blocker as proof the previous blocker resolved", () => {
    const view = render(<Observation />);
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
      capture.mock.calls.filter(
        ([event]) => event.properties.state === "cleared",
      ),
    ).toHaveLength(0);
    view.rerender(<Observation readiness={ready} />);
    expect(
      capture.mock.calls.filter(
        ([event]) => event.properties.state === "cleared",
      ),
    ).toHaveLength(2);
  });

  it("waits for visible geometry and consumes the explicit guide handoff once", () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(
      new DOMRect(),
    );
    recordOnboardingWorkEntry("skipped", "first_run");
    render(<Observation />);
    expect(capture).not.toHaveBeenCalled();
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(
      new DOMRect(10, 10, 300, 100),
    );
    fireEvent.resize(window);
    expect(capture).toHaveBeenNthCalledWith(1, {
      name: "onboarding_work_surface",
      properties: {
        surface: "first_task",
        action: "displayed",
        entry: "skipped_guide",
      },
    });
    expect(capture).toHaveBeenNthCalledWith(2, {
      name: "new_thread_blocker",
      properties: { state: "shown", reason: "sign_in", source: "first_run" },
    });
    expect(takeOnboardingWorkEntry()).toEqual({
      entry: "other",
      source: "other",
    });
  });

  it("does not emit background observations or count tab visibility changes as reopening", () => {
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    const view = render(<Observation />);
    expect(capture).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    fireEvent(document, new Event("visibilitychange"));
    visibility.mockReturnValue("hidden");
    view.rerender(<Observation readiness={ready} />);
    fireEvent(document, new Event("visibilitychange"));
    expect(capture).toHaveBeenCalledTimes(2);
    visibility.mockReturnValue("visible");
    fireEvent(document, new Event("visibilitychange"));
    expect(capture).toHaveBeenCalledTimes(3);
    expect(
      capture.mock.calls.filter(
        ([event]) => event.name === "onboarding_work_surface",
      ),
    ).toHaveLength(1);
  });

  it("waits for a composer inside a hidden ancestor without consuming the guide handoff", async () => {
    recordOnboardingWorkEntry("completed", "replay");
    const view = render(
      <div hidden>
        <Observation />
      </div>,
    );
    expect(capture).not.toHaveBeenCalled();
    view.rerender(
      <div>
        <Observation />
      </div>,
    );
    await waitFor(() => expect(capture).toHaveBeenCalledTimes(2));
    expect(capture).toHaveBeenNthCalledWith(1, {
      name: "onboarding_work_surface",
      properties: {
        surface: "first_task",
        action: "displayed",
        entry: "completed_guide",
      },
    });
    expect(capture).toHaveBeenNthCalledWith(2, {
      name: "new_thread_blocker",
      properties: { state: "shown", reason: "sign_in", source: "replay" },
    });
  });

  it("records a deliberate remount as another display without clearing on unmount", async () => {
    const view = render(<Observation />);
    view.unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(capture).toHaveBeenCalledTimes(2);
    render(<Observation />);
    expect(
      capture.mock.calls.filter(
        ([event]) => event.name === "onboarding_work_surface",
      ),
    ).toHaveLength(2);
    expect(
      capture.mock.calls.filter(
        ([event]) => event.properties.state === "cleared",
      ),
    ).toHaveLength(0);
  });
});
