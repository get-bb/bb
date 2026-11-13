// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { BbHttpError } from "@bb/sdk/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordTelemetryEvent } from "./onboarding-telemetry";
import { useLoadTelemetry, type StepLoadRecords } from "./useLoadTelemetry";

vi.mock("./onboarding-telemetry", () => ({ recordTelemetryEvent: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

interface QueryState {
  isError: boolean;
  error: unknown;
}

interface StepState {
  query: QueryState;
  loaded: boolean;
  timedOut: boolean;
}

const ok: QueryState = { isError: false, error: null };
const unavailable: QueryState = {
  isError: true,
  error: new BbHttpError({
    body: null,
    code: "host_unavailable",
    message: "Host is not connected",
    status: 502,
  }),
};
const loading: StepState = { query: ok, loaded: false, timedOut: false };

function openStep(
  records: StepLoadRecords,
  step: "agent" | "plugins",
  initial: StepState,
  noHost = false,
) {
  return renderHook(
    (state: StepState) =>
      useLoadTelemetry({
        entry: "first_run",
        step,
        records,
        noHost,
        ...state,
      }),
    { initialProps: initial },
  );
}

function recorded() {
  return vi
    .mocked(recordTelemetryEvent)
    .mock.calls.map(([event]) => event.properties);
}

function failed(step: string, failureReason: string) {
  return {
    entry: "first_run",
    step,
    operation: "load",
    outcome: "failed",
    failure_reason: failureReason,
  };
}

describe("load telemetry", () => {
  it.each(["agent", "plugins"] as const)(
    "records the %s step's first load failure once per guide run, even after reopening",
    (step) => {
      const records: StepLoadRecords = new Map();
      const first = openStep(records, step, loading);
      first.rerender({ ...loading, query: unavailable });
      first.rerender(loading);
      first.rerender({ ...loading, query: unavailable });
      first.unmount();
      openStep(records, step, { ...loading, query: unavailable }).unmount();

      expect(recorded()).toEqual([failed(step, "host_unavailable")]);
    },
  );

  it("records a missing computer instead of the query state", () => {
    openStep(new Map(), "agent", loading, true);
    expect(recorded()).toEqual([failed("agent", "no_host")]);
  });

  it("records a timeout once, not again when Retry times out or errors", () => {
    const view = openStep(new Map(), "agent", loading);
    view.rerender({ ...loading, timedOut: true });
    view.rerender({ ...loading, query: unavailable, timedOut: true });
    view.rerender(loading);
    view.rerender({ ...loading, timedOut: true });

    expect(recorded()).toEqual([failed("agent", "timed_out")]);
  });

  it("records one load success per step per guide run, timed from when the step first opened", () => {
    vi.useFakeTimers();
    const records: StepLoadRecords = new Map();
    const firstVisit = openStep(records, "agent", loading);
    vi.advanceTimersByTime(1_000);
    firstVisit.unmount();
    vi.advanceTimersByTime(2_000);
    const secondVisit = openStep(records, "agent", loading);
    vi.advanceTimersByTime(500);
    secondVisit.rerender({ ...loading, loaded: true });
    secondVisit.unmount();
    openStep(records, "agent", { ...loading, loaded: true }).unmount();
    openStep(records, "plugins", { ...loading, loaded: true }).unmount();

    expect(recorded()).toEqual([
      {
        entry: "first_run",
        step: "agent",
        operation: "load",
        outcome: "succeeded",
        duration_ms: 3_500,
      },
      {
        entry: "first_run",
        step: "plugins",
        operation: "load",
        outcome: "succeeded",
        duration_ms: 0,
      },
    ]);
  });

  it("records no failure when a refetch fails after the data loaded", () => {
    const view = openStep(new Map(), "agent", loading);
    view.rerender({ ...loading, loaded: true });
    view.rerender({ ...loading, query: unavailable, loaded: true });

    expect(recorded()).toEqual([
      expect.objectContaining({ step: "agent", outcome: "succeeded" }),
    ]);
  });

  it("records a failure and a later success in the same run", () => {
    const view = openStep(new Map(), "plugins", loading);
    view.rerender({ ...loading, query: unavailable });
    view.rerender({ ...loading, loaded: true });

    expect(recorded()).toEqual([
      failed("plugins", "host_unavailable"),
      expect.objectContaining({ step: "plugins", outcome: "succeeded" }),
    ]);
  });
});
