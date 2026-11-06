// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { BbHttpError } from "@bb/sdk/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordTelemetryEvent } from "./onboarding-telemetry";
import { useLoadFailureTelemetry } from "./useLoadFailureTelemetry";

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

describe("load failure telemetry", () => {
  it.each(["agent", "plugins"] as const)(
    "records each time the %s step's data starts failing to load",
    (step) => {
      const view = renderHook(
        (query: QueryState) =>
          useLoadFailureTelemetry({
            entry: "replay",
            step,
            noHost: false,
            query,
            timedOut: false,
          }),
        { initialProps: loaded },
      );
      view.rerender(unavailable);
      view.rerender({ ...unavailable });
      view.rerender(loaded);
      view.rerender(unavailable);

      const failure = {
        entry: "replay",
        step,
        operation: "load",
        outcome: "failed",
        failure_reason: "host_unavailable",
      };
      expect(recorded()).toEqual([failure, failure]);
    },
  );

  it("records a missing computer instead of the query state", () => {
    renderHook(() =>
      useLoadFailureTelemetry({
        entry: "first_run",
        step: "agent",
        noHost: true,
        query: loaded,
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

  it("records a load that timed out once per attempt, not again when it then errors", () => {
    const view = renderHook(
      (props: { query: QueryState; timedOut: boolean }) =>
        useLoadFailureTelemetry({
          entry: "first_run",
          step: "agent",
          noHost: false,
          query: props.query,
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
    expect(recorded()).toEqual([timedOut, timedOut]);
  });
});
