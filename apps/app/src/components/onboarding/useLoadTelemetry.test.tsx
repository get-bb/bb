// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { BbHttpError } from "@bb/sdk/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OnboardingStepId } from "./onboarding-model";
import { recordTelemetryEvent } from "./onboarding-telemetry";
import { useLoadTelemetry } from "./useLoadTelemetry";

vi.mock("./onboarding-telemetry", () => ({ recordTelemetryEvent: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

interface QueryState {
  isError: boolean;
  error: unknown;
}

const loaded: QueryState = { isError: false, error: null };
const unavailable: QueryState = {
  isError: true,
  error: new BbHttpError({
    body: null,
    code: "host_unavailable",
    message: "Host is not connected",
    status: 502,
  }),
};

function recorded() {
  return vi
    .mocked(recordTelemetryEvent)
    .mock.calls.map(([event]) => event.properties);
}

describe("load telemetry", () => {
  it.each(["agent", "plugins"] as const)(
    "records the %s step's load failure once per guide, even after reopening the step",
    (step) => {
      const reportedFailures = new Set<OnboardingStepId>();
      const render = () =>
        renderHook(
          (query: QueryState) =>
            useLoadTelemetry({
              entry: "replay",
              step,
              reportedFailures,
              hostWaitFailure: null,
              query,
              loaded: false,
              timedOut: false,
            }),
          { initialProps: loaded },
        );
      const view = render();
      view.rerender(unavailable);
      view.rerender(loaded);
      view.rerender(unavailable);
      view.unmount();
      render().rerender(unavailable);

      const failure = {
        entry: "replay",
        step,
        operation: "load",
        outcome: "failed",
        failure_reason: "host_unavailable",
      };
      expect(recorded()).toEqual([failure]);
    },
  );

  it("records a computer that never became ready instead of the query state", () => {
    renderHook(() =>
      useLoadTelemetry({
        entry: "first_run",
        step: "agent",
        reportedFailures: new Set(),
        hostWaitFailure: "no_host",
        query: loaded,
        loaded: false,
        timedOut: false,
      }),
    );
    expect(recorded()).toEqual([
      {
        entry: "first_run",
        step: "agent",
        operation: "load",
        outcome: "failed",
        failure_reason: "no_host",
      },
    ]);
  });

  it("records a load that timed out once, not again when it then errors or retries", () => {
    const reportedFailures = new Set<OnboardingStepId>();
    const view = renderHook(
      (props: { query: QueryState; timedOut: boolean }) =>
        useLoadTelemetry({
          entry: "first_run",
          step: "agent",
          reportedFailures,
          hostWaitFailure: null,
          query: props.query,
          loaded: false,
          timedOut: props.timedOut,
        }),
      { initialProps: { query: loaded, timedOut: false } },
    );
    view.rerender({ query: loaded, timedOut: true });
    view.rerender({ query: loaded, timedOut: true });
    view.rerender({ query: unavailable, timedOut: true });
    view.rerender({ query: loaded, timedOut: false });
    view.rerender({ query: loaded, timedOut: true });

    const timedOut = {
      entry: "first_run",
      step: "agent",
      operation: "load",
      outcome: "failed",
      failure_reason: "timed_out",
    };
    expect(recorded()).toEqual([timedOut]);
  });

  it("records the first successful load once with how long it took", () => {
    vi.useFakeTimers();
    const view = renderHook(
      (loadedNow: boolean) =>
        useLoadTelemetry({
          entry: "first_run",
          step: "agent",
          reportedFailures: new Set(),
          hostWaitFailure: null,
          query: loaded,
          loaded: loadedNow,
          timedOut: false,
        }),
      { initialProps: false },
    );
    vi.advanceTimersByTime(4_200);
    view.rerender(true);
    view.rerender(false);
    view.rerender(true);
    vi.useRealTimers();

    expect(recorded()).toEqual([
      {
        entry: "first_run",
        step: "agent",
        operation: "load",
        outcome: "succeeded",
        duration_ms: 4_200,
      },
    ]);
  });
});
