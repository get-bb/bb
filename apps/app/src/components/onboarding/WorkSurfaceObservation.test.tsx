// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
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
const getContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sdk", () => ({
  sdk: { system: { experimental_onboardingContext: getContext } },
}));
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
      surface="first_task"
      identity="same-local-draft"
      enabled={true}
      hasDraft={hasDraft}
      readiness={readiness}
    >
      <div data-app-composer="">Composer</div>
    </WorkSurfaceObservation>
  );
}

beforeEach(() => {
  capture.mockClear();
  getContext.mockReset().mockResolvedValue({
    design_revision: "baseline",
    recommendation_revision: "baseline",
    assignment: null,
  });
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
  vi.unstubAllGlobals();
});

describe("visible work measurement", () => {
  it("keeps composing and leaves comparison coverage missing when context fails", async () => {
    getContext.mockRejectedValueOnce(new Error("offline"));
    const view = render(<Observation />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(view.getByText("Composer")).toBeTruthy();
    expect(
      capture.mock.calls.some(
        ([event]) => event.name === "onboarding_comparison",
      ),
    ).toBe(false);
  });

  it("records server-reviewed first-task and continuation comparison classes only while visible", async () => {
    const view = render(<Observation />);
    expect(
      capture.mock.calls.some(
        ([event]) => event.name === "onboarding_comparison",
      ),
    ).toBe(false);
    await act(async () => {
      await Promise.resolve();
    });
    const comparisons = () =>
      capture.mock.calls
        .map(([event]) => event)
        .filter((event) => event.name === "onboarding_comparison");
    expect(comparisons()).toHaveLength(1);
    expect(comparisons()[0].properties).toMatchObject({
      stage: "first_task",
      experiment_key: null,
      experiment_revision: null,
      variant: null,
      design_revision: "baseline",
      recommendation_revision: "baseline",
    });
    fireEvent.resize(window);
    expect(comparisons()).toHaveLength(1);
    vi.stubGlobal("innerWidth", 500);
    vi.stubGlobal("innerHeight", 600);
    fireEvent.resize(window);
    expect(comparisons()).toHaveLength(2);
    expect(comparisons()[1].properties).toMatchObject({
      width_class: "compact",
      height_class: "short",
    });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    vi.stubGlobal("innerWidth", 1300);
    fireEvent.resize(window);
    expect(comparisons()).toHaveLength(2);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    view.rerender(
      <WorkSurfaceObservation
        surface="continuation"
        identity="continued"
        enabled
        hasDraft={false}
        readiness={ready}
      >
        <div data-app-composer="">Composer</div>
      </WorkSurfaceObservation>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(comparisons().at(-1)).toMatchObject({
      properties: { stage: "continuation", width_class: "wide" },
    });
  });

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
        content_revision: null,
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
